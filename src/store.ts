import { create } from "zustand";
import { api, sceneRelPath } from "./api";
import { clearPlanTagAvatars } from "./components/planTagInfo";
import {
  applySettings,
  defaultSettings,
  mergeSettings,
  type AppSettings,
} from "./settings";
import {
  computeStats,
  loadNormVariant,
  plainTextFromMarkdown,
  saveNormVariant,
  type NormVariant,
  type TextStats,
} from "./stats";
import { joinFlow, normalizeScene, splitFlow } from "./flow";
import { collectSceneIds, findNode, flowSceneIds } from "./tree";
import type { NodeKind, ProjectInfo } from "./types";

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

/** Auswählbares Ziel für Planungs-Tags (Person, Ort). */
export interface PlanIndexEntry {
  id: string;
  name: string;
  /** Person/Ort mit hinterlegtem Bild — für die Vorschau beim Überfahren. */
  hasImage: boolean;
}

export type PlanIndex = Record<PaneResearchKind, PlanIndexEntry[]>;

const emptyPlanIndex = (): PlanIndex => ({ characters: [], locations: [] });

export interface Pane {
  /** Ausgewählte Szene; im Fluss die zuletzt angesprungene. */
  sceneId: string | null;
  /** Szenen des Flusses in Reihenfolge (leer = einzelnes Dokument). */
  flowIds: string[];
  /** Zuletzt geladener bzw. gespeicherter Stand je Szene des Flusses. */
  flowSaved: Record<string, string>;
  /** Erhöht sich, wenn im Fluss zu `sceneId` gescrollt werden soll. */
  focusCounter: number;
  /** Kapitel-ID, wenn dieser Pane das Corkboard eines Kapitels zeigt (statt Editor). */
  corkboardId: string | null;
  /** Recherche-Inhalt (Person/Ort) statt Editor. */
  researchKind: PaneResearchKind | null;
  /** Ausgewähltes Recherche-Item dieses Panes. */
  researchId: string | null;
  /** Zeigt den Zeitstrahl über dem sonstigen Inhalt dieses Panes.
   *  Bewusst kein Ersatz für sceneId/corkboardId: Ausschalten kehrt zurück. */
  timeline: boolean;
  /** Zeigt ein Mindboard über dem sonstigen Inhalt — wie der Zeitstrahl eine
   *  Auflage; beide schließen sich gegenseitig aus. */
  mindboardId: string | null;
  /** Zeigt den Papierkorb — wie der Zeitstrahl eine Auflage, kein Ersatz. */
  trash: boolean;
  /** Markdown — aktuellster Stand aus dem Editor. */
  content: string;
  saveState: SaveState;
  /** Erhöht sich, wenn Inhalt von außen neu geladen wurde → Editor remountet. */
  loadCounter: number;
}

/** Ansichten mit eigenem, verzögertem Speichern (Mindboards) melden sich
 *  hier an, damit `flushAll` vor Schließen und Sicherungspunkten auch ihre
 *  offenen Änderungen schreibt. */
export const extraFlushers = new Set<() => Promise<void>>();

const AUTOSAVE_MS = 2000;
const RECENTS_KEY = "distelfink.recents";
const COLLAPSED_KEY = "distelfink.collapsed";
const TYPEWRITER_KEY = "distelfink.typewriter";
const FLOW_KEY = "distelfink.flowMode";

const emptyPane = (): Pane => ({
  sceneId: null,
  flowIds: [],
  flowSaved: {},
  focusCounter: 0,
  corkboardId: null,
  researchKind: null,
  researchId: null,
  timeline: false,
  mindboardId: null,
  trash: false,
  content: "",
  saveState: "saved",
  loadCounter: 0,
});

const emptyPanes = (): Record<PaneId, Pane> =>
  Object.fromEntries(PANE_IDS.map((id) => [id, emptyPane()])) as Record<PaneId, Pane>;

const autosaveTimers: Record<PaneId, ReturnType<typeof setTimeout> | null> = {
  leftTop: null,
  leftBottom: null,
  rightTop: null,
  rightBottom: null,
};

let settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushRecent(path: string) {
  const recents = [path, ...loadRecents().filter((p) => p !== path)].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
}

/** Zugeklappte Ordner, je Projekt gemerkt (Ansichtssache — gehört nicht in
 *  project.json, das über Projektordner hinweg geteilt wird). */
function loadCollapsedMap(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function loadCollapsed(root: string | null | undefined): string[] {
  return root ? (loadCollapsedMap()[root] ?? []) : [];
}

function saveCollapsed(root: string, ids: string[]) {
  const map = loadCollapsedMap();
  if (ids.length) map[root] = ids;
  else delete map[root];
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map));
}

interface Store {
  project: ProjectInfo | null;
  panes: Record<PaneId, Pane>;
  layoutMode: LayoutMode;
  activePane: PaneId;
  focusMode: boolean;
  typewriter: boolean;
  /** Fluss-Modus: ein Bereich zeigt alle Szenen des Kapitels am Stück. */
  flowMode: boolean;
  normVariant: NormVariant;
  /** Projektrelative Pfade, die extern (Dropbox, zweite Maschine, …) geändert wurden. */
  externalChanges: string[];
  error: string | null;

  createProject: (parentDir: string, name: string, author: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  /** „Speichern unter": legt eine Kopie an und arbeitet in der Kopie weiter. */
  saveProjectAs: (parentDir: string, name: string) => Promise<void>;
  closeProject: () => Promise<void>;
  selectScene: (id: string) => Promise<void>;
  /** Zeigt das Corkboard eines Kapitels im aktiven Pane. */
  selectChapter: (id: string) => Promise<void>;
  updateNodeMeta: (
    id: string,
    patch: {
      synopsis?: string;
      status?: string;
      color?: string;
      tags?: string[];
      /** Kartenbild (rel. Pfad unter images/); "" entfernt es. */
      image?: string;
    },
  ) => Promise<void>;
  quickNavOpen: boolean;
  setQuickNavOpen: (open: boolean) => void;
  /** Blendet den Zeitstrahl in einem Pane ein/aus (Inhalt darunter bleibt erhalten). */
  setPaneTimeline: (paneId: PaneId, on: boolean) => Promise<void>;
  /** Blendet ein Mindboard in einem Pane ein (id) oder aus (null). */
  setPaneMindboard: (paneId: PaneId, id: string | null) => Promise<void>;
  /** Zähler als Refresh-Signal für die Mindboard-Liste. */
  mindboardVersion: number;
  touchMindboards: () => void;
  /** Ebenso für den Papierkorb. */
  setPaneTrash: (paneId: PaneId, on: boolean) => Promise<void>;
  /** Zähler als Refresh-Signal für den offenen Papierkorb. */
  trashVersion: number;
  touchTrash: () => void;
  /** Holt einen Eintrag aus dem Papierkorb zurück. */
  restoreFromTrash: (key: string) => Promise<void>;
  setContent: (paneId: PaneId, content: string) => void;
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
  openResearchNextTo: (
    paneId: PaneId,
    kind: PaneResearchKind,
    id: string,
  ) => Promise<void>;
  /** Wie `openResearchNextTo`, nur für eine Szene (Sprung aus einer Fundstelle). */
  openSceneNextTo: (paneId: PaneId, sceneId: string) => Promise<void>;
  /** Zähler als Refresh-Signal nach Anlegen/Speichern/Löschen von Recherche-Daten. */
  researchVersion: number;
  touchResearch: () => void;
  /** Personen/Orte für die Tag-Auswahl und die Hover-Vorschau. */
  planIndex: PlanIndex;
  refreshPlanIndex: () => Promise<void>;
  toggleFocusMode: () => void;
  setFocusMode: (on: boolean) => void;
  toggleTypewriter: () => void;
  /** Schaltet den Fluss-Modus um und lädt die offenen Bereiche entsprechend neu. */
  toggleFlowMode: () => Promise<void>;
  setNormVariant: (v: NormVariant) => void;
  /** Zählung je Szene (Stand der gespeicherten Dateien) — Basis für die
   *  Gesamtwerte des Manuskripts in der Statusleiste. */
  sceneStats: Record<string, TextStats>;
  /** Liest alle Szenen des Binders neu ein (beim Öffnen/Neuladen eines Projekts). */
  refreshSceneStats: () => Promise<void>;
  /** IDs der zugeklappten Ordner im Binder. */
  collapsedIds: string[];
  setCollapsed: (id: string, collapsed: boolean) => void;
  toggleCollapsed: (id: string) => void;
  createNode: (parentId: string | null, kind: NodeKind, title: string) => Promise<void>;
  renameNode: (id: string, title: string) => Promise<void>;
  /** Legt eine Kopie samt Unterbaum direkt hinter dem Original ab. */
  duplicateNode: (id: string) => Promise<void>;
  moveNode: (id: string, newParentId: string | null, index: number) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  checkExternalChanges: () => Promise<void>;
  reloadProject: () => Promise<void>;
  clearError: () => void;

  /** Szene, deren Verlauf gerade angezeigt wird (null = Modal geschlossen). */
  historyFor: string | null;
  setHistoryFor: (sceneId: string | null) => void;
  /** Export-Dialog (Phase 6). */
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;

  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  /** Kurzes Feedback nach manuellem Sicherungspunkt (Titelleiste). */
  snapshotNotice: string | null;
  /** Sicherungspunkt über das ganze Projekt; ohne message automatisch (still). */
  takeSnapshot: (message?: string) => Promise<void>;
  restoreVersion: (sceneId: string, commitId: string) => Promise<void>;

  /** App-weite Einstellungen (Phase 7): Theme, Editor, Layout, Kürzel. */
  settings: AppSettings;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Lädt gespeicherte Einstellungen vom Backend und wendet sie an. */
  initSettings: () => Promise<void>;
  /** Wendet die Änderung sofort an und persistiert debounced. */
  updateSettings: (patch: Partial<AppSettings>) => void;
}

export const useStore = create<Store>((set, get) => {
  const patchPane = (paneId: PaneId, patch: Partial<Pane>) =>
    set((s) => ({ panes: { ...s.panes, [paneId]: { ...s.panes[paneId], ...patch } } }));

  const scheduleAutosave = (paneId: PaneId) => {
    const t = autosaveTimers[paneId];
    if (t) clearTimeout(t);
    autosaveTimers[paneId] = setTimeout(() => void get().flushPane(paneId), AUTOSAVE_MS);
  };

  const fail = (e: unknown) => set({ error: String(e) });

  /** Zählung einer Szene aus ihrem Markdown übernehmen (ohne Dateizugriff). */
  const cacheSceneStats = (sceneId: string, markdown: string) =>
    set((s) => ({
      sceneStats: {
        ...s.sceneStats,
        [sceneId]: computeStats(plainTextFromMarkdown(markdown)),
      },
    }));

  /** Öffnet eine Szene in einem Bereich — je nach Modus allein oder als Fluss
   *  aller Szenen ihres Kapitels. */
  const openScene = async (paneId: PaneId, id: string) => {
    const binder = get().project?.meta.binder ?? [];
    const flowIds = get().flowMode ? flowSceneIds(binder, id) : [];
    const pane = get().panes[paneId];
    const common = {
      sceneId: id,
      corkboardId: null,
      researchKind: null,
      researchId: null,
      timeline: false,
      mindboardId: null,
      trash: false,
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
        for (const part of parts) cacheSceneStats(part.id, part.content);
        patchPane(paneId, {
          ...common,
          content: joinFlow(parts),
          flowIds,
          flowSaved: Object.fromEntries(parts.map((p) => [p.id, p.content])),
        });
      } else {
        const content = await api.readScene(id);
        cacheSceneStats(id, content);
        patchPane(paneId, { ...common, content, flowIds: [], flowSaved: {} });
      }
    } catch (e) {
      fail(e);
    }
  };

  /** Speichert einen Fluss: jede geänderte Szene wandert in ihre eigene Datei. */
  const flushFlow = async (paneId: PaneId) => {
    const pane = get().panes[paneId];
    const written = pane.content;
    const parts = splitFlow(written, pane.flowIds);
    if (!parts.length) {
      // Ohne Trenner ist nicht mehr zuzuordnen, wohin der Text gehört.
      patchPane(paneId, { saveState: "dirty" });
      set({ error: "Die Szenentrenner fehlen — bitte den Bereich neu laden." });
      return;
    }
    patchPane(paneId, { saveState: "saving" });
    const binder = get().project?.meta.binder ?? [];
    const saved = { ...pane.flowSaved };
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
        cacheSceneStats(part.id, part.content);
      }
    } catch (e) {
      patchPane(paneId, { flowSaved: saved, saveState: "dirty" });
      fail(e);
      return;
    }
    const now = get().panes[paneId];
    patchPane(paneId, {
      flowSaved: saved,
      saveState: conflict ? "conflict" : now.content === written ? "saved" : "dirty",
    });
  };

  /** Nach Änderungen am Binder: offene Flüsse an die neue Struktur anpassen
   *  (neue/verschobene/gelöschte Szenen des Kapitels). */
  const resyncFlows = async () => {
    const binder = get().project?.meta.binder ?? [];
    for (const paneId of PANE_IDS) {
      const pane = get().panes[paneId];
      if (!pane.flowIds.length) continue;
      const anchor =
        pane.sceneId && findNode(binder, pane.sceneId)
          ? pane.sceneId
          : (pane.flowIds.find((id) => findNode(binder, id)) ?? null);
      if (!anchor) {
        patchPane(paneId, emptyPane());
        continue;
      }
      const ids = flowSceneIds(binder, anchor);
      const same =
        anchor === pane.sceneId &&
        ids.length === pane.flowIds.length &&
        ids.every((id, i) => id === pane.flowIds[i]);
      if (same) continue;
      await get().flushPane(paneId);
      await openScene(paneId, anchor);
    }
  };

  /** Bereich für einen Sprung aus `paneId` heraus — bevorzugt einer, in dem
   *  gerade kein Text bearbeitet wird; im Einzel-Layout wird aufgeteilt. */
  const neighbourPane = async (paneId: PaneId): Promise<PaneId> => {
    const visible = PANES_FOR_MODE[get().layoutMode];
    const free = visible.find((p) => p !== paneId && !get().panes[p].sceneId);
    const other = free ?? visible.find((p) => p !== paneId);
    if (other) return other;
    await get().setLayoutMode("cols");
    return paneId === "rightTop" ? "leftTop" : "rightTop";
  };

  const resetView = (project: ProjectInfo | null) => {
    set({
      project,
      panes: emptyPanes(),
      layoutMode: "single",
      activePane: "leftTop" as PaneId,
      externalChanges: [],
      sceneStats: {},
      collapsedIds: loadCollapsed(project?.root),
    });
    void get().refreshPlanIndex();
    void get().refreshSceneStats();
  };

  return {
    project: null,
    panes: emptyPanes(),
    layoutMode: "single",
    activePane: "leftTop",
    focusMode: false,
    typewriter: localStorage.getItem(TYPEWRITER_KEY) === "1",
    flowMode: localStorage.getItem(FLOW_KEY) === "1",
    normVariant: loadNormVariant(),
    sceneStats: {},
    collapsedIds: [],
    externalChanges: [],
    error: null,

    createProject: async (parentDir, name, author) => {
      try {
        const project = await api.createProject(parentDir, name, name, author);
        pushRecent(project.root);
        resetView(project);
      } catch (e) {
        fail(e);
      }
    },

    openProject: async (path) => {
      try {
        const project = await api.openProject(path);
        pushRecent(project.root);
        resetView(project);
      } catch (e) {
        fail(e);
      }
    },

    saveProjectAs: async (parentDir, name) => {
      try {
        // Erst alles Offene rausschreiben — die Kopie entsteht von Platte.
        await get().flushAll();
        const project = await api.saveProjectAs(parentDir, name);
        pushRecent(project.root);
        resetView(project);
      } catch (e) {
        fail(e);
      }
    },

    closeProject: async () => {
      await get().flushAll();
      // Letzten Stand sichern, bevor das Projekt zugeht.
      await api.snapshot("Automatischer Sicherungspunkt (Projekt geschlossen)").catch(() => {});
      await api.closeProject().catch(() => {});
      resetView(null);
      set({ focusMode: false, historyFor: null, exportOpen: false });
    },

    selectScene: async (id) => {
      const paneId = get().activePane;
      const pane = get().panes[paneId];
      const shown = pane.flowIds.length ? pane.flowIds.includes(id) : pane.sceneId === id;
      if (shown && !pane.corkboardId && !pane.researchKind && !pane.trash) {
        // Schon offen: nur einen darüberliegenden Zeitstrahl wegblenden und im
        // Fluss zur gewählten Szene springen (kein Neuladen, kein Undo-Verlust).
        if (pane.timeline || pane.mindboardId) {
          patchPane(paneId, { timeline: false, mindboardId: null });
        }
        if (pane.flowIds.length) {
          patchPane(paneId, { sceneId: id, focusCounter: pane.focusCounter + 1 });
        }
        return;
      }
      await get().flushPane(paneId);
      await openScene(paneId, id);
    },

    selectChapter: async (id) => {
      const paneId = get().activePane;
      if (get().panes[paneId].corkboardId === id && !get().panes[paneId].trash) {
        if (get().panes[paneId].timeline || get().panes[paneId].mindboardId)
          patchPane(paneId, { timeline: false, mindboardId: null });
        return;
      }
      await get().flushPane(paneId);
      patchPane(paneId, {
        sceneId: null,
        flowIds: [],
        flowSaved: {},
        corkboardId: id,
        researchKind: null,
        researchId: null,
        timeline: false,
        mindboardId: null,
        trash: false,
        content: "",
        saveState: "saved",
      });
    },

    updateNodeMeta: async (id, patch) => {
      try {
        set({ project: await api.updateNodeMeta(id, patch) });
      } catch (e) {
        fail(e);
      }
    },

    quickNavOpen: false,
    setQuickNavOpen: (open) => set({ quickNavOpen: open }),

    setPaneTimeline: async (paneId, on) => {
      if (get().panes[paneId].timeline === on) {
        set({ activePane: paneId });
        return;
      }
      // Zweimal geöffnet würden beide Zeitstrahl-Panes unabhängig speichern
      // und sich gegenseitig überschreiben — stattdessen den offenen aktivieren.
      if (on) {
        const open = PANES_FOR_MODE[get().layoutMode].find((p) => get().panes[p].timeline);
        if (open) {
          set({ activePane: open });
          return;
        }
      }
      // Beim Verdecken des Editors offene Änderungen sichern.
      if (on) await get().flushPane(paneId);
      patchPane(paneId, on ? { timeline: true, mindboardId: null } : { timeline: false });
      set({ activePane: paneId });
    },

    setPaneMindboard: async (paneId, id) => {
      if (get().panes[paneId].mindboardId === id) {
        set({ activePane: paneId });
        return;
      }
      // Wie beim Zeitstrahl: zweimal offen würden beide Panes unabhängig
      // speichern und sich überschreiben — stattdessen den offenen aktivieren.
      if (id) {
        const open = PANES_FOR_MODE[get().layoutMode].find(
          (p) => get().panes[p].mindboardId === id,
        );
        if (open) {
          set({ activePane: open });
          return;
        }
        await get().flushPane(paneId);
      }
      patchPane(paneId, id ? { mindboardId: id, timeline: false } : { mindboardId: null });
      set({ activePane: paneId });
    },

    mindboardVersion: 0,
    touchMindboards: () => set((s) => ({ mindboardVersion: s.mindboardVersion + 1 })),

    setPaneTrash: async (paneId, on) => {
      if (get().panes[paneId].trash === on) {
        set({ activePane: paneId });
        return;
      }
      // Einmal reicht: ein zweiter Papierkorb zeigte dasselbe doppelt.
      if (on) {
        const open = PANES_FOR_MODE[get().layoutMode].find((p) => get().panes[p].trash);
        if (open) {
          set({ activePane: open });
          return;
        }
        await get().flushPane(paneId);
      }
      patchPane(paneId, { trash: on });
      set({ activePane: paneId });
    },

    trashVersion: 0,
    touchTrash: () => set((s) => ({ trashVersion: s.trashVersion + 1 })),

    restoreFromTrash: async (key) => {
      try {
        set({ project: await api.restoreTrash(key) });
        get().touchTrash();
        // Der Eintrag kann eine Person oder ein Ort gewesen sein.
        get().touchResearch();
        void get().refreshPlanIndex();
        await get().refreshSceneStats();
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    setContent: (paneId, content) => {
      patchPane(paneId, { content, saveState: "dirty" });
      scheduleAutosave(paneId);
    },

    flushPane: async (paneId) => {
      const pane = get().panes[paneId];
      if (pane.saveState !== "dirty") return;
      const t = autosaveTimers[paneId];
      if (t) clearTimeout(t);
      if (pane.flowIds.length) return flushFlow(paneId);
      if (!pane.sceneId) return;
      const written = pane.content;
      patchPane(paneId, { saveState: "saving" });
      try {
        const result = await api.writeScene(pane.sceneId, written);
        if (result.status === "conflict") {
          patchPane(paneId, { saveState: "conflict" });
        } else {
          cacheSceneStats(pane.sceneId, written);
          // Nur "saved", wenn währenddessen nicht weitergetippt wurde.
          const now = get().panes[paneId];
          patchPane(paneId, { saveState: now.content === written ? "saved" : "dirty" });
        }
      } catch (e) {
        patchPane(paneId, { saveState: "dirty" });
        fail(e);
      }
    },

    flushAll: async () => {
      for (const paneId of PANE_IDS) await get().flushPane(paneId);
      for (const flush of [...extraFlushers]) await flush();
    },

    resolveConflict: async (paneId, action) => {
      const pane = get().panes[paneId];
      if (!pane.sceneId) return;
      if (pane.flowIds.length) {
        try {
          if (action === "overwrite") {
            const saved = { ...pane.flowSaved };
            for (const part of splitFlow(pane.content, pane.flowIds)) {
              if (part.content === saved[part.id]) continue;
              await api.writeScene(part.id, part.content, true);
              saved[part.id] = part.content;
              cacheSceneStats(part.id, part.content);
            }
            patchPane(paneId, { flowSaved: saved, saveState: "saved" });
          } else {
            await openScene(paneId, pane.sceneId);
          }
        } catch (e) {
          fail(e);
        }
        return;
      }
      try {
        if (action === "overwrite") {
          await api.writeScene(pane.sceneId, pane.content, true);
          cacheSceneStats(pane.sceneId, pane.content);
          patchPane(paneId, { saveState: "saved" });
        } else {
          const content = await api.readScene(pane.sceneId);
          cacheSceneStats(pane.sceneId, content);
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
        const open = PANES_FOR_MODE[get().layoutMode].find(
          (p) => get().panes[p].researchKind === kind && get().panes[p].researchId === id,
        );
        if (open) {
          if (get().panes[open].timeline || get().panes[open].mindboardId)
            patchPane(open, { timeline: false, mindboardId: null });
          set({ activePane: open });
          return;
        }
      }
      await get().flushPane(paneId);
      patchPane(paneId, {
        sceneId: null,
        flowIds: [],
        flowSaved: {},
        corkboardId: null,
        researchKind: kind,
        researchId: id,
        timeline: false,
        mindboardId: null,
        trash: false,
        content: "",
        saveState: "saved",
      });
      set({ activePane: paneId });
    },

    setPaneResearchId: (paneId, id) => patchPane(paneId, { researchId: id }),

    openResearchNextTo: async (paneId, kind, id) => {
      const target = await neighbourPane(paneId);
      await get().openResearchInPane(target, kind, id);
    },

    openSceneNextTo: async (paneId, sceneId) => {
      const target = await neighbourPane(paneId);
      set({ activePane: target });
      await get().selectScene(sceneId);
    },

    researchVersion: 0,
    touchResearch: () => {
      set((s) => ({ researchVersion: s.researchVersion + 1 }));
      void get().refreshPlanIndex();
    },

    planIndex: emptyPlanIndex(),

    refreshPlanIndex: async () => {
      clearPlanTagAvatars();
      if (!get().project) {
        set({ planIndex: emptyPlanIndex() });
        return;
      }
      try {
        const [characters, locations] = await Promise.all([
          api.listEntities("characters"),
          api.listEntities("locations"),
        ]);
        const fromEntities = (list: typeof characters) =>
          list.map((e) => ({ id: e.id, name: e.name, hasImage: !!e.image }));
        set({
          planIndex: {
            characters: fromEntities(characters),
            locations: fromEntities(locations),
          },
        });
      } catch {
        // Der Index ist nur Komfort — ein Fehler darf den Editor nicht stören.
      }
    },

    toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    setFocusMode: (on) => set({ focusMode: on }),

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
        const sceneId = get().panes[paneId].sceneId;
        if (sceneId) await openScene(paneId, sceneId);
      }
    },

    setNormVariant: (v) => {
      saveNormVariant(v);
      set({ normVariant: v });
    },

    refreshSceneStats: async () => {
      const project = get().project;
      if (!project) {
        set({ sceneStats: {} });
        return;
      }
      const ids = collectSceneIds(project.meta.binder);
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, computeStats(plainTextFromMarkdown(await api.readScene(id)))] as const;
          } catch {
            // Eine unlesbare Szene zählt als leer — Gesamtwerte sind Komfort.
            return null;
          }
        }),
      );
      // Nur übernehmen, wenn dasselbe Projekt noch offen ist.
      if (get().project?.root !== project.root) return;
      set({
        sceneStats: Object.fromEntries(
          entries.filter((e): e is NonNullable<typeof e> => e !== null),
        ),
      });
    },

    createNode: async (parentId, kind, title) => {
      try {
        set({ project: await api.createNode(parentId, kind, title) });
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    renameNode: async (id, title) => {
      try {
        set({ project: await api.renameNode(id, title) });
      } catch (e) {
        fail(e);
      }
    },

    setCollapsed: (id, collapsed) => {
      const ids = collapsed
        ? [...new Set([...get().collapsedIds, id])]
        : get().collapsedIds.filter((x) => x !== id);
      const root = get().project?.root;
      if (root) saveCollapsed(root, ids);
      set({ collapsedIds: ids });
    },

    toggleCollapsed: (id) => get().setCollapsed(id, !get().collapsedIds.includes(id)),

    duplicateNode: async (id) => {
      try {
        set({ project: await api.duplicateNode(id) });
        // Die Kopie bringt Text mit — anders als eine frisch angelegte Szene.
        await get().refreshSceneStats();
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    moveNode: async (id, newParentId, index) => {
      try {
        set({ project: await api.moveNode(id, newParentId, index) });
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    deleteNode: async (id) => {
      try {
        const project = await api.deleteNode(id);
        set({ project });
        // Panes leeren, deren Szene/Kapitel es nicht mehr gibt.
        for (const paneId of PANE_IDS) {
          const pane = get().panes[paneId];
          if (pane.flowIds.length) continue; // übernimmt resyncFlows
          const ref = pane.sceneId ?? pane.corkboardId;
          if (ref && !findNode(project.meta.binder, ref)) {
            patchPane(paneId, emptyPane());
          }
        }
        get().touchTrash();
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    checkExternalChanges: async () => {
      if (!get().project) return;
      try {
        set({ externalChanges: await api.checkExternalChanges() });
      } catch {
        // still: Fokus-Check darf nie stören
      }
    },

    reloadProject: async () => {
      const root = get().project?.root;
      if (!root) return;
      await get().flushAll();
      try {
        const project = await api.openProject(root);
        set({ project, externalChanges: [] });
        void get().refreshSceneStats();
        // Offene Szenen neu einlesen (außer bei ungelöstem Konflikt).
        for (const paneId of PANE_IDS) {
          const pane = get().panes[paneId];
          if (pane.corkboardId && !findNode(project.meta.binder, pane.corkboardId)) {
            patchPane(paneId, emptyPane());
            continue;
          }
          if (!pane.sceneId) continue;
          if (!findNode(project.meta.binder, pane.sceneId)) {
            patchPane(paneId, emptyPane());
          } else if (pane.saveState !== "conflict") {
            // Auch der Fluss wird über openScene neu aufgebaut (Kapitel kann
            // sich extern geändert haben).
            await openScene(paneId, pane.sceneId);
          }
        }
      } catch (e) {
        fail(e);
      }
    },

    clearError: () => set({ error: null }),

    historyFor: null,
    setHistoryFor: (sceneId) => set({ historyFor: sceneId }),

    exportOpen: false,
    setExportOpen: (open) => {
      // Vor dem Export offene Änderungen auf Platte bringen.
      if (open) void get().flushAll();
      set({ exportOpen: open });
    },

    aboutOpen: false,
    setAboutOpen: (open) => set({ aboutOpen: open }),

    snapshotNotice: null,

    takeSnapshot: async (message) => {
      if (!get().project) return;
      await get().flushAll();
      try {
        const committed = await api.snapshot(message ?? null);
        if (message) {
          set({
            snapshotNotice: committed
              ? "✓ Sicherungspunkt gesetzt"
              : "Keine Änderungen seit dem letzten Sicherungspunkt",
          });
          setTimeout(() => set({ snapshotNotice: null }), 4000);
        }
      } catch (e) {
        // Automatische Sicherungen dürfen den Schreibfluss nicht stören.
        if (message) fail(e);
      }
    },

    restoreVersion: async (sceneId, commitId) => {
      await get().flushAll();
      try {
        const content = await api.restoreVersion(commitId, sceneRelPath(sceneId));
        cacheSceneStats(sceneId, content);
        for (const paneId of PANE_IDS) {
          const pane = get().panes[paneId];
          if (pane.flowIds.includes(sceneId)) {
            // Im Fluss steckt die Szene mitten im Dokument — komplett neu bauen.
            await openScene(paneId, pane.sceneId ?? sceneId);
          } else if (pane.sceneId === sceneId) {
            patchPane(paneId, {
              content,
              saveState: "saved",
              loadCounter: pane.loadCounter + 1,
            });
          }
        }
        set({ historyFor: null });
      } catch (e) {
        fail(e);
      }
    },

    settings: defaultSettings(),
    settingsOpen: false,
    setSettingsOpen: (open) => set({ settingsOpen: open }),

    initSettings: async () => {
      try {
        const settings = mergeSettings(await api.loadSettings());
        set({ settings });
        applySettings(settings);
      } catch {
        // Backend nicht erreichbar → mit Defaults weiterarbeiten.
        applySettings(get().settings);
      }
    },

    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      applySettings(settings);
      if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
      settingsPersistTimer = setTimeout(
        () => void api.saveSettings(get().settings).catch(() => {}),
        500,
      );
    },
  };
});
