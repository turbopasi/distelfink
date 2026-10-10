// Das offene Projekt: Lebenszyklus, Binder, Zählungen, Planungsindex, Verlauf.

import { api, sceneRelPath } from "../api";
import { clearPlanTagAvatars } from "../components/planTagInfo";
import { clearEntityImages } from "../components/EntityDoc";
import { clearImageCache } from "../imageCache";
import { computeStats, plainTextFromMarkdown, type TextStats } from "../stats";
import { collectSceneIds, findNode } from "../tree";
import type { NodeKind, ProjectInfo } from "../types";
import type { GetState, SetState } from ".";
import {
  emptyPane,
  emptyPanes,
  hasOpenConflict,
  paneOps,
  PANE_IDS,
  resetPaneSavers,
  sceneView,
  type PaneId,
  type PaneResearchKind,
} from "./panes";

/** Auswählbares Ziel für Planungs-Tags (Person, Ort). */
export interface PlanIndexEntry {
  id: string;
  name: string;
  /** Person/Ort mit hinterlegtem Bild — für die Vorschau beim Überfahren. */
  hasImage: boolean;
}

export type PlanIndex = Record<PaneResearchKind, PlanIndexEntry[]>;

const emptyPlanIndex = (): PlanIndex => ({ characters: [], locations: [] });

/** Schon gemeldete unlesbare Personen-/Ortsdateien — jede nur einmal pro Projekt. */
const reportedBrokenEntities = new Set<string>();

const RECENTS_KEY = "distelfink.recents";
const COLLAPSED_KEY = "distelfink.collapsed";

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

/** Zählung einer Szene aus ihrem Markdown übernehmen (ohne Dateizugriff). */
export function cacheSceneStats(set: SetState, sceneId: string, markdown: string) {
  set((s) => ({
    sceneStats: {
      ...s.sceneStats,
      [sceneId]: computeStats(plainTextFromMarkdown(markdown)),
    },
  }));
}

export interface ProjectSlice {
  project: ProjectInfo | null;
  /** Projektrelative Pfade, die extern (Dropbox, zweite Maschine, …) geändert wurden. */
  externalChanges: string[];

  createProject: (parentDir: string, name: string, author: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  /** „Speichern unter": legt eine Kopie an und arbeitet in der Kopie weiter. */
  saveProjectAs: (parentDir: string, name: string) => Promise<void>;
  closeProject: () => Promise<void>;
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
  /** Holt einen Eintrag aus dem Papierkorb zurück. */
  restoreFromTrash: (key: string) => Promise<void>;
  /** Alles Offene sichern, bevor die App endet (Fenster schließen, Update):
   *  Texte, Mindboards, Dokumente, Einstellungen und ein Sicherungspunkt.
   *  `reason` landet in der Beschreibung des Sicherungspunkts. */
  flushForExit: (reason: string) => Promise<void>;
  /** Personen/Orte für die Tag-Auswahl und die Hover-Vorschau. */
  planIndex: PlanIndex;
  refreshPlanIndex: () => Promise<void>;
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
  /** Erhöht sich bei „Projekt neu laden“: Ansichten mit eigenem Stand
   *  (Zeitstrahl, Mindboard, Personen/Orte) lesen dann neu (`useAutosave`). */
  reloadCount: number;
  /** Kurzes Feedback nach manuellem Sicherungspunkt (Titelleiste). */
  snapshotNotice: string | null;
  /** Sicherungspunkt über das ganze Projekt; ohne message automatisch (still). */
  takeSnapshot: (message?: string) => Promise<void>;
  restoreVersion: (sceneId: string, commitId: string) => Promise<void>;
}

export function createProjectSlice(set: SetState, get: GetState): ProjectSlice {
  const { replacePane, fail, openScene, resyncFlows } = paneOps(set, get);

  /** Verlässt das offene Projekt geordnet: alles Offene speichern und einen
   *  Sicherungspunkt setzen. false, wenn ein ungelöster Schreibkonflikt das
   *  verhindert — dessen lokale Änderungen gingen sonst stumm verloren. */
  const leaveProject = async (): Promise<boolean> => {
    if (!get().project) return true;
    if (hasOpenConflict(get())) {
      set({ error: "Bitte zuerst den Schreibkonflikt im betroffenen Bereich lösen." });
      return false;
    }
    await get().flushAll();
    await api.snapshot("Automatischer Sicherungspunkt (Projekt geschlossen)").catch(() => {});
    return true;
  };

  const resetView = (project: ProjectInfo | null) => {
    clearImageCache();
    clearEntityImages();
    reportedBrokenEntities.clear();
    resetPaneSavers();
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

  /** Szene bzw. Kapitel, auf die sich ein Bereich bezieht (null = keins). */
  const binderRef = (paneId: PaneId): string | null => {
    const view = get().panes[paneId].view;
    if (view.kind === "scene") return view.sceneId;
    if (view.kind === "corkboard") return view.chapterId;
    return null;
  };

  return {
    project: null,
    externalChanges: [],
    sceneStats: {},
    collapsedIds: [],
    reloadCount: 0,

    createProject: async (parentDir, name, author) => {
      try {
        if (!(await leaveProject())) return;
        const project = await api.createProject(parentDir, name, name, author);
        pushRecent(project.root);
        resetView(project);
      } catch (e) {
        fail(e);
      }
    },

    openProject: async (path) => {
      try {
        if (!(await leaveProject())) return;
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
      if (!(await leaveProject())) return;
      await api.closeProject().catch(() => {});
      resetView(null);
      set({ focusMode: false, historyFor: null, exportOpen: false });
    },

    updateNodeMeta: async (id, patch) => {
      try {
        set({ project: await api.updateNodeMeta(id, patch) });
      } catch (e) {
        fail(e);
      }
    },

    restoreFromTrash: async (key) => {
      try {
        set({ project: await api.restoreTrash(key) });
        get().touchTrash();
        // Der Eintrag kann eine Person, ein Ort oder ein Mindboard gewesen sein.
        get().touchResearch();
        get().touchMindboards();
        void get().refreshPlanIndex();
        await get().refreshSceneStats();
        await resyncFlows();
      } catch (e) {
        fail(e);
      }
    },

    flushForExit: async (reason) => {
      await get().flushSettings();
      if (!get().project) return;
      await get().flushAll();
      await api.snapshot(`Automatischer Sicherungspunkt (${reason})`).catch(() => {});
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
          list.entities.map((e) => ({ id: e.id, name: e.name, hasImage: !!e.image }));
        set({
          planIndex: {
            characters: fromEntities(characters),
            locations: fromEntities(locations),
          },
        });
        const broken = [...characters.broken, ...locations.broken].filter(
          (f) => !reportedBrokenEntities.has(f),
        );
        if (broken.length > 0) {
          broken.forEach((f) => reportedBrokenEntities.add(f));
          set({
            error: `Nicht lesbar und daher ausgeblendet: ${broken.join(", ")}. Die Datei ist beschädigt oder noch nicht fertig synchronisiert.`,
          });
        }
      } catch {
        // Der Index ist nur Komfort — ein Fehler darf den Editor nicht stören.
      }
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
          if (sceneView(get().panes[paneId])?.flowIds.length) continue; // übernimmt resyncFlows
          const ref = binderRef(paneId);
          if (ref && !findNode(project.meta.binder, ref)) {
            replacePane(paneId, emptyPane());
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
        clearEntityImages();
        set((s) => ({ project, externalChanges: [], reloadCount: s.reloadCount + 1 }));
        void get().refreshSceneStats();
        // Offene Szenen neu einlesen (außer bei ungelöstem Konflikt).
        for (const paneId of PANE_IDS) {
          const ref = binderRef(paneId);
          if (!ref) continue;
          const pane = get().panes[paneId];
          if (!findNode(project.meta.binder, ref)) {
            replacePane(paneId, emptyPane());
          } else if (pane.view.kind === "scene" && pane.saveState !== "conflict") {
            // Auch der Fluss wird über openScene neu aufgebaut (Kapitel kann
            // sich extern geändert haben).
            await openScene(paneId, pane.view.sceneId);
          }
        }
      } catch (e) {
        fail(e);
      }
    },

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
        cacheSceneStats(set, sceneId, content);
        for (const paneId of PANE_IDS) {
          const pane = get().panes[paneId];
          const v = sceneView(pane);
          if (!v) continue;
          if (v.flowIds.includes(sceneId)) {
            // Im Fluss steckt die Szene mitten im Dokument — komplett neu bauen.
            await openScene(paneId, v.sceneId);
          } else if (v.sceneId === sceneId) {
            replacePane(paneId, { content, loadCounter: pane.loadCounter + 1 });
          }
        }
        set({ historyFor: null });
      } catch (e) {
        fail(e);
      }
    },
  };
}
