// Bereiche (Panes): was jeder zeigt, Layout, Speichern der Szenen.

import { api } from "../api";
import { joinFlow, normalizeScene, splitFlow } from "../flow";
import { findNode, flowSceneIds } from "../tree";
import type { GetState, SetState } from ".";
import { cacheSceneStats } from "./project";

export type SaveState = "saved" | "dirty" | "saving" | "conflict";
export type PaneId = "leftTop" | "leftBottom" | "rightTop" | "rightBottom";
/** Recherche-Inhalte, die in einem Pane angezeigt werden können. */
export type PaneResearchKind = "characters" | "locations";

export const PANE_IDS: PaneId[] = ["leftTop", "leftBottom", "rightTop", "rightBottom"];

export type LayoutMode = "single" | "cols" | "leftSplit" | "rightSplit" | "grid";

export const LAYOUT_MODES: LayoutMode[] = ["single", "cols", "leftSplit", "rightSplit", "grid"];

export const PANES_FOR_MODE: Record<LayoutMode, PaneId[]> = {
  single: ["leftTop"],
  cols: ["leftTop", "rightTop"],
  leftSplit: ["leftTop", "leftBottom", "rightTop"],
  rightSplit: ["leftTop", "rightTop", "rightBottom"],
  grid: PANE_IDS,
};

/** Was ein Bereich zeigt — genau eines davon. */
export type PaneView =
  | { kind: "empty" }
  | {
      kind: "scene";
      /** Ausgewählte Szene; im Fluss die zuletzt angesprungene. */
      sceneId: string;
      /** Szenen des Flusses in Reihenfolge (leer = einzelnes Dokument). */
      flowIds: string[];
      /** Zuletzt geladener bzw. gespeicherter Stand je Szene des Flusses. */
      flowSaved: Record<string, string>;
    }
  /** Corkboard eines Kapitels. */
  | { kind: "corkboard"; chapterId: string }
  /** Person/Ort; `id` null = Liste ohne Auswahl. */
  | { kind: "research"; researchKind: PaneResearchKind; id: string | null };

/** Liegt über der Ansicht, ohne sie zu ersetzen: Ausblenden kehrt zu ihr
 *  zurück, ungespeicherter Text bleibt im Store. */
export type PaneOverlay =
  | { kind: "timeline" }
  | { kind: "trash" }
  | { kind: "mindboard"; id: string }
  | null;

export interface Pane {
  view: PaneView;
  overlay: PaneOverlay;
  /** Erhöht sich, wenn im Fluss zu `sceneId` gescrollt werden soll. */
  focusCounter: number;
  /** Markdown der Szene(n) — aktuellster Stand aus dem Editor. */
  content: string;
  saveState: SaveState;
  /** Erhöht sich, wenn Inhalt von außen neu geladen wurde → Editor remountet. */
  loadCounter: number;
}

type SceneView = Extract<PaneView, { kind: "scene" }>;

/** Die Szenenansicht eines Bereichs, sonst null. */
export function sceneView(pane: Pane): SceneView | null {
  return pane.view.kind === "scene" ? pane.view : null;
}

/** true, wenn der Bereich die Szene zeigt — allein oder als Teil des Flusses. */
export function showsScene(pane: Pane, id: string): boolean {
  const v = sceneView(pane);
  if (!v) return false;
  return v.flowIds.length ? v.flowIds.includes(id) : v.sceneId === id;
}

/** true, wenn der Bereich diese Person / diesen Ort zeigt. */
export function showsResearch(pane: Pane, kind: PaneResearchKind, id: string): boolean {
  return pane.view.kind === "research" && pane.view.researchKind === kind && pane.view.id === id;
}

/** true, wenn über dem Bereich dieses Mindboard liegt. */
export function showsMindboard(pane: Pane, id: string): boolean {
  return pane.overlay?.kind === "mindboard" && pane.overlay.id === id;
}

/** Gleiche Auflage (Art und, beim Mindboard, dasselbe Board)? */
function sameOverlay(a: PaneOverlay, b: PaneOverlay): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "mindboard" && b.kind === "mindboard") return a.id === b.id;
  return a.kind === b.kind;
}

/** Ansichten mit eigenem, verzögertem Speichern (Mindboards) melden sich
 *  hier an, damit `flushAll` vor Schließen und Sicherungspunkten auch ihre
 *  offenen Änderungen schreibt. */
export const extraFlushers = new Set<() => Promise<void>>();

const AUTOSAVE_MS = 2000;
const TYPEWRITER_KEY = "distelfink.typewriter";
const FLOW_KEY = "distelfink.flowMode";

export const emptyPane = (): Pane => ({
  view: { kind: "empty" },
  overlay: null,
  focusCounter: 0,
  content: "",
  saveState: "saved",
  loadCounter: 0,
});

export const emptyPanes = (): Record<PaneId, Pane> =>
  Object.fromEntries(PANE_IDS.map((id) => [id, emptyPane()])) as Record<PaneId, Pane>;

const autosaveTimers: Record<PaneId, ReturnType<typeof setTimeout> | null> = {
  leftTop: null,
  leftBottom: null,
  rightTop: null,
  rightBottom: null,
};

/** Liefert den aktuellen Editorinhalt eines Bereichs als Markdown. Der Editor
 *  meldet sich hier an; `pane.content` wird erst beim Speichern nachgezogen —
 *  das ganze Dokument bei jedem Tastendruck zu serialisieren, bremst lange
 *  Kapitel im Fluss spürbar aus. */
const contentSources: Record<PaneId, (() => string) | null> = {
  leftTop: null,
  leftBottom: null,
  rightTop: null,
  rightBottom: null,
};

/** Änderungen je Bereich — zeigt, ob während des Speicherns weitergetippt wurde. */
const editCounts: Record<PaneId, number> = {
  leftTop: 0,
  leftBottom: 0,
  rightTop: 0,
  rightBottom: 0,
};

/** Laufender Schreibvorgang je Bereich — `flushPane` wartet ihn ab. */
const savesInFlight: Record<PaneId, Promise<void> | null> = {
  leftTop: null,
  leftBottom: null,
  rightTop: null,
  rightBottom: null,
};

export interface PaneSlice {
  panes: Record<PaneId, Pane>;
  layoutMode: LayoutMode;
  activePane: PaneId;
  typewriter: boolean;
  /** Fluss-Modus: ein Bereich zeigt alle Szenen des Kapitels am Stück. */
  flowMode: boolean;

  selectScene: (id: string) => Promise<void>;
  /** Zeigt das Corkboard eines Kapitels im aktiven Pane. */
  selectChapter: (id: string) => Promise<void>;
  /** Blendet eine Auflage (Zeitstrahl, Papierkorb, Mindboard) in einem Pane
   *  ein oder mit `null` aus; die Ansicht darunter bleibt erhalten. Ist
   *  dieselbe Auflage schon in einem anderen Pane offen, wird nur der
   *  aktiviert — zweimal offen speicherten beide unabhängig und
   *  überschrieben sich gegenseitig. */
  setPaneOverlay: (paneId: PaneId, overlay: PaneOverlay) => Promise<void>;
  /** Der Editor eines Bereichs wurde geändert. Serialisiert wird erst beim
   *  Speichern (siehe `registerContentSource`), nicht bei jedem Tastendruck. */
  markDirty: (paneId: PaneId) => void;
  flushPane: (paneId: PaneId) => Promise<void>;
  flushAll: () => Promise<void>;
  resolveConflict: (paneId: PaneId, action: "overwrite" | "reload") => Promise<void>;
  setActivePane: (paneId: PaneId) => void;
  /** Wechselt das Split-Layout; schließende Panes werden vorher gespeichert. */
  setLayoutMode: (mode: LayoutMode) => Promise<void>;
  /** Schaltet der Reihe nach durch die Layout-Modi (Shortcut). */
  cycleLayout: () => Promise<void>;
  /** Öffnet Person/Ort in einem Pane (id = null → leere Auswahl). */
  openResearchInPane: (paneId: PaneId, kind: PaneResearchKind, id: string | null) => Promise<void>;
  setPaneResearchId: (paneId: PaneId, id: string | null) => void;
  /** Öffnet Person/Ort in einem anderen sichtbaren Pane (Klick auf einen
   *  Planungs-Tag im Text) — teilt notfalls das Layout auf. */
  openResearchNextTo: (paneId: PaneId, kind: PaneResearchKind, id: string) => Promise<void>;
  /** Wie `openResearchNextTo`, nur für eine Szene (Sprung aus einer Fundstelle). */
  openSceneNextTo: (paneId: PaneId, sceneId: string) => Promise<void>;
  toggleTypewriter: () => void;
  /** Schaltet den Fluss-Modus um und lädt die offenen Bereiche entsprechend neu. */
  toggleFlowMode: () => Promise<void>;
}

/** Hilfen rund um die Bereiche, die auch andere Teile des Stores brauchen. */
export function paneOps(set: SetState, get: GetState) {
  const patchPane = (paneId: PaneId, patch: Partial<Pane>) =>
    set((s) => ({ panes: { ...s.panes, [paneId]: { ...s.panes[paneId], ...patch } } }));

  const fail = (e: unknown) => set({ error: String(e) });

  /** Wechselt die Ansicht eines Bereichs auf etwas anderes als eine Szene. */
  const showView = (paneId: PaneId, view: Exclude<PaneView, SceneView>) =>
    patchPane(paneId, { view, overlay: null, content: "", saveState: "saved" });

  /** Öffnet eine Szene in einem Bereich — je nach Modus allein oder als Fluss
   *  aller Szenen ihres Kapitels. */
  const openScene = async (paneId: PaneId, id: string) => {
    const binder = get().project?.meta.binder ?? [];
    const flowIds = get().flowMode ? flowSceneIds(binder, id) : [];
    const pane = get().panes[paneId];
    const common = {
      overlay: null,
      saveState: "saved" as SaveState,
      loadCounter: pane.loadCounter + 1,
      focusCounter: pane.focusCounter + 1,
    };
    try {
      if (flowIds.length) {
        const parts = await Promise.all(
          flowIds.map(async (sceneId) => ({
            id: sceneId,
            content: normalizeScene(await api.readScene(sceneId)),
          })),
        );
        for (const part of parts) cacheSceneStats(set, part.id, part.content);
        patchPane(paneId, {
          ...common,
          content: joinFlow(parts),
          view: {
            kind: "scene",
            sceneId: id,
            flowIds,
            flowSaved: Object.fromEntries(parts.map((p) => [p.id, p.content])),
          },
        });
      } else {
        const content = await api.readScene(id);
        cacheSceneStats(set, id, content);
        patchPane(paneId, {
          ...common,
          content,
          view: { kind: "scene", sceneId: id, flowIds: [], flowSaved: {} },
        });
      }
    } catch (e) {
      fail(e);
    }
  };

  /** Nach Änderungen am Binder: offene Flüsse an die neue Struktur anpassen
   *  (neue/verschobene/gelöschte Szenen des Kapitels). */
  const resyncFlows = async () => {
    const binder = get().project?.meta.binder ?? [];
    for (const paneId of PANE_IDS) {
      const v = sceneView(get().panes[paneId]);
      if (!v?.flowIds.length) continue;
      const anchor = findNode(binder, v.sceneId)
        ? v.sceneId
        : (v.flowIds.find((id) => findNode(binder, id)) ?? null);
      if (!anchor) {
        patchPane(paneId, emptyPane());
        continue;
      }
      const ids = flowSceneIds(binder, anchor);
      const same =
        anchor === v.sceneId &&
        ids.length === v.flowIds.length &&
        ids.every((id, i) => id === v.flowIds[i]);
      if (same) continue;
      await get().flushPane(paneId);
      await openScene(paneId, anchor);
    }
  };

  return { patchPane, fail, showView, openScene, resyncFlows };
}

export function createPaneSlice(set: SetState, get: GetState): PaneSlice {
  const { patchPane, fail, showView, openScene } = paneOps(set, get);

  const scheduleAutosave = (paneId: PaneId) => {
    const t = autosaveTimers[paneId];
    if (t) clearTimeout(t);
    autosaveTimers[paneId] = setTimeout(() => void get().flushPane(paneId), AUTOSAVE_MS);
  };

  /** Zieht `pane.content` auf den Stand des Editors nach. */
  const syncContent = (paneId: PaneId) => {
    const source = contentSources[paneId];
    if (!source) return;
    const content = source();
    if (content !== get().panes[paneId].content) patchPane(paneId, { content });
  };

  /** Speichert die einzelne Szene eines Bereichs. */
  const flushSingle = async (paneId: PaneId, sceneId: string) => {
    syncContent(paneId);
    const written = get().panes[paneId].content;
    const edits = editCounts[paneId];
    patchPane(paneId, { saveState: "saving" });
    try {
      const result = await api.writeScene(sceneId, written);
      if (result.status === "conflict") {
        patchPane(paneId, { saveState: "conflict" });
      } else {
        cacheSceneStats(set, sceneId, written);
        // Nur "saved", wenn währenddessen nicht weitergetippt wurde.
        patchPane(paneId, { saveState: editCounts[paneId] === edits ? "saved" : "dirty" });
      }
    } catch (e) {
      patchPane(paneId, { saveState: "dirty" });
      fail(e);
    }
  };

  /** Übernimmt den gespeicherten Stand eines Flusses — nur, wenn der Bereich
   *  noch denselben Fluss zeigt (`flowIds` wird beim Laden neu angelegt). */
  const patchFlowSaved = (
    paneId: PaneId,
    flowIds: string[],
    flowSaved: Record<string, string>,
    saveState: SaveState,
  ) => {
    const v = sceneView(get().panes[paneId]);
    if (v?.flowIds !== flowIds) return;
    patchPane(paneId, { view: { ...v, flowSaved }, saveState });
  };

  /** Speichert einen Fluss: jede geänderte Szene wandert in ihre eigene Datei. */
  const flushFlow = async (paneId: PaneId, view: SceneView) => {
    syncContent(paneId);
    const written = get().panes[paneId].content;
    const edits = editCounts[paneId];
    const parts = splitFlow(written, view.flowIds);
    if (!parts.length) {
      // Ohne Trenner ist nicht mehr zuzuordnen, wohin der Text gehört.
      patchPane(paneId, { saveState: "dirty" });
      set({ error: "Die Szenentrenner fehlen — bitte den Bereich neu laden." });
      return;
    }
    patchPane(paneId, { saveState: "saving" });
    const binder = get().project?.meta.binder ?? [];
    const saved = { ...view.flowSaved };
    let conflict = false;
    try {
      for (const part of parts) {
        // Inzwischen gelöschte Szenen nicht wieder anlegen.
        if (part.content === saved[part.id] || !findNode(binder, part.id)) continue;
        const result = await api.writeScene(part.id, part.content);
        if (result.status === "conflict") {
          conflict = true;
          continue;
        }
        saved[part.id] = part.content;
        cacheSceneStats(set, part.id, part.content);
      }
    } catch (e) {
      patchFlowSaved(paneId, view.flowIds, saved, "dirty");
      fail(e);
      return;
    }
    patchFlowSaved(
      paneId,
      view.flowIds,
      saved,
      conflict ? "conflict" : editCounts[paneId] === edits ? "saved" : "dirty",
    );
  };

  /** Bereich für einen Sprung aus `paneId` heraus — bevorzugt einer, in dem
   *  gerade kein Text bearbeitet wird; im Einzel-Layout wird aufgeteilt. */
  const neighbourPane = async (paneId: PaneId): Promise<PaneId> => {
    const visible = PANES_FOR_MODE[get().layoutMode];
    const free = visible.find((p) => p !== paneId && get().panes[p].view.kind !== "scene");
    const other = free ?? visible.find((p) => p !== paneId);
    if (other) return other;
    await get().setLayoutMode("cols");
    return paneId === "rightTop" ? "leftTop" : "rightTop";
  };

  /** Hebt eine Auflage auf, damit die Ansicht darunter sichtbar wird. */
  const revealView = (paneId: PaneId) => {
    if (get().panes[paneId].overlay) patchPane(paneId, { overlay: null });
  };

  return {
    panes: emptyPanes(),
    layoutMode: "single",
    activePane: "leftTop",
    typewriter: localStorage.getItem(TYPEWRITER_KEY) === "1",
    flowMode: localStorage.getItem(FLOW_KEY) === "1",

    selectScene: async (id) => {
      const paneId = get().activePane;
      const pane = get().panes[paneId];
      const v = sceneView(pane);
      if (v && showsScene(pane, id)) {
        // Schon offen: nur die Auflage darüber wegblenden und im Fluss zur
        // gewählten Szene springen (kein Neuladen, kein Undo-Verlust).
        revealView(paneId);
        if (v.flowIds.length) {
          patchPane(paneId, { view: { ...v, sceneId: id }, focusCounter: pane.focusCounter + 1 });
        }
        return;
      }
      await get().flushPane(paneId);
      await openScene(paneId, id);
    },

    selectChapter: async (id) => {
      const paneId = get().activePane;
      const view = get().panes[paneId].view;
      if (view.kind === "corkboard" && view.chapterId === id) {
        revealView(paneId);
        return;
      }
      await get().flushPane(paneId);
      showView(paneId, { kind: "corkboard", chapterId: id });
    },

    setPaneOverlay: async (paneId, overlay) => {
      if (sameOverlay(get().panes[paneId].overlay, overlay)) {
        set({ activePane: paneId });
        return;
      }
      if (overlay) {
        const open = PANES_FOR_MODE[get().layoutMode].find((p) =>
          sameOverlay(get().panes[p].overlay, overlay),
        );
        if (open) {
          set({ activePane: open });
          return;
        }
        // Beim Verdecken des Editors offene Änderungen sichern.
        await get().flushPane(paneId);
      }
      patchPane(paneId, { overlay });
      set({ activePane: paneId });
    },

    markDirty: (paneId) => {
      editCounts[paneId]++;
      // Nur beim Wechsel ins Store schreiben — jeder Tastendruck ein Update
      // hieße jedes Mal ein neues Rendern aller Abonnenten. Ein offener
      // Konflikt bleibt stehen, bis er entschieden ist.
      const state = get().panes[paneId].saveState;
      if (state === "saved" || state === "saving") patchPane(paneId, { saveState: "dirty" });
      scheduleAutosave(paneId);
    },

    flushPane: async (paneId) => {
      // Läuft schon ein Speichern, erst dessen Ende abwarten: wer sonst hier
      // abbräche (Schließen, Projektwechsel, Update), ginge davon aus, dass
      // alles auf Platte ist, obwohl noch geschrieben wird oder inzwischen
      // weitergetippt wurde.
      while (savesInFlight[paneId]) await savesInFlight[paneId];
      const pane = get().panes[paneId];
      if (pane.saveState !== "dirty") return;
      const t = autosaveTimers[paneId];
      if (t) clearTimeout(t);
      const v = sceneView(pane);
      if (!v) return;
      const run = v.flowIds.length ? flushFlow(paneId, v) : flushSingle(paneId, v.sceneId);
      savesInFlight[paneId] = run;
      try {
        await run;
      } finally {
        savesInFlight[paneId] = null;
      }
    },

    flushAll: async () => {
      for (const paneId of PANE_IDS) await get().flushPane(paneId);
      for (const flush of [...extraFlushers]) await flush();
    },

    resolveConflict: async (paneId, action) => {
      syncContent(paneId);
      const pane = get().panes[paneId];
      const v = sceneView(pane);
      if (!v) return;
      if (v.flowIds.length) {
        try {
          if (action === "overwrite") {
            const saved = { ...v.flowSaved };
            for (const part of splitFlow(pane.content, v.flowIds)) {
              if (part.content === saved[part.id]) continue;
              await api.writeScene(part.id, part.content, true);
              saved[part.id] = part.content;
              cacheSceneStats(set, part.id, part.content);
            }
            patchFlowSaved(paneId, v.flowIds, saved, "saved");
          } else {
            await openScene(paneId, v.sceneId);
          }
        } catch (e) {
          fail(e);
        }
        return;
      }
      try {
        if (action === "overwrite") {
          await api.writeScene(v.sceneId, pane.content, true);
          cacheSceneStats(set, v.sceneId, pane.content);
          patchPane(paneId, { saveState: "saved" });
        } else {
          const content = await api.readScene(v.sceneId);
          cacheSceneStats(set, v.sceneId, content);
          patchPane(paneId, {
            content,
            saveState: "saved",
            loadCounter: pane.loadCounter + 1,
          });
        }
      } catch (e) {
        fail(e);
      }
    },

    setActivePane: (paneId) => {
      if (!PANES_FOR_MODE[get().layoutMode].includes(paneId)) return;
      set({ activePane: paneId });
    },

    setLayoutMode: async (mode) => {
      const visible = PANES_FOR_MODE[mode];
      const closing = PANES_FOR_MODE[get().layoutMode].filter((id) => !visible.includes(id));
      // Ungelöste Konflikte in schließenden Panes würden sonst stumm verworfen.
      if (closing.some((id) => get().panes[id].saveState === "conflict")) {
        set({ error: "Bitte zuerst den Schreibkonflikt im betroffenen Bereich lösen." });
        return;
      }
      for (const id of closing) await get().flushPane(id);
      set((s) => ({
        layoutMode: mode,
        activePane: visible.includes(s.activePane) ? s.activePane : "leftTop",
        panes: {
          ...s.panes,
          ...Object.fromEntries(closing.map((id) => [id, emptyPane()])),
        },
      }));
    },

    cycleLayout: async () => {
      const i = LAYOUT_MODES.indexOf(get().layoutMode);
      await get().setLayoutMode(LAYOUT_MODES[(i + 1) % LAYOUT_MODES.length]);
    },

    openResearchInPane: async (paneId, kind, id) => {
      // Denselben Eintrag doppelt zu öffnen provoziert Autosave-Konflikte —
      // stattdessen den Pane aktivieren, der sie schon zeigt.
      if (id) {
        const open = PANES_FOR_MODE[get().layoutMode].find((p) =>
          showsResearch(get().panes[p], kind, id),
        );
        if (open) {
          revealView(open);
          set({ activePane: open });
          return;
        }
      }
      await get().flushPane(paneId);
      showView(paneId, { kind: "research", researchKind: kind, id });
      set({ activePane: paneId });
    },

    setPaneResearchId: (paneId, id) => {
      const view = get().panes[paneId].view;
      if (view.kind === "research") patchPane(paneId, { view: { ...view, id } });
    },

    openResearchNextTo: async (paneId, kind, id) => {
      const target = await neighbourPane(paneId);
      await get().openResearchInPane(target, kind, id);
    },

    openSceneNextTo: async (paneId, sceneId) => {
      const target = await neighbourPane(paneId);
      set({ activePane: target });
      await get().selectScene(sceneId);
    },

    toggleTypewriter: () => {
      const next = !get().typewriter;
      localStorage.setItem(TYPEWRITER_KEY, next ? "1" : "0");
      set({ typewriter: next });
    },

    toggleFlowMode: async () => {
      await get().flushAll();
      const next = !get().flowMode;
      localStorage.setItem(FLOW_KEY, next ? "1" : "0");
      set({ flowMode: next });
      // Offene Szenen im neuen Modus neu aufbauen.
      for (const paneId of PANE_IDS) {
        const v = sceneView(get().panes[paneId]);
        if (v) await openScene(paneId, v.sceneId);
      }
    },
  };
}

/** Umsetzung von `registerContentSource` (siehe dort). */
export function attachContentSource(
  get: GetState,
  set: SetState,
  paneId: PaneId,
  source: () => string,
): () => void {
  contentSources[paneId] = source;
  const loadCounter = get().panes[paneId].loadCounter;
  return () => {
    if (contentSources[paneId] !== source) return;
    contentSources[paneId] = null;
    const pane = get().panes[paneId];
    // Nur, wenn der Bereich noch dasselbe Dokument zeigt: nach einem Neuladen
    // gehört `pane.content` schon dem neuen Stand.
    if (pane.loadCounter !== loadCounter || pane.saveState !== "dirty") return;
    try {
      const content = source();
      set((s) => ({ panes: { ...s.panes, [paneId]: { ...s.panes[paneId], content } } }));
    } catch (e) {
      console.error("Editorinhalt nicht übernommen:", e);
    }
  };
}
