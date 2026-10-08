// Dialoge, Fehlermeldung und Refresh-Signale für Listen.

import type { GetState, SetState } from ".";

export interface UiSlice {
  error: string | null;
  clearError: () => void;
  quickNavOpen: boolean;
  setQuickNavOpen: (open: boolean) => void;
  /** Szene, deren Verlauf gerade angezeigt wird (null = Modal geschlossen). */
  historyFor: string | null;
  setHistoryFor: (sceneId: string | null) => void;
  /** Export-Dialog (Phase 6). */
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Zähler als Refresh-Signal für die Mindboard-Liste. */
  mindboardVersion: number;
  touchMindboards: () => void;
  /** Zähler als Refresh-Signal für den offenen Papierkorb. */
  trashVersion: number;
  touchTrash: () => void;
  /** Zähler als Refresh-Signal nach Anlegen/Speichern/Löschen von Recherche-Daten. */
  researchVersion: number;
  touchResearch: () => void;
}

export function createUiSlice(set: SetState, get: GetState): UiSlice {
  return {
    error: null,
    clearError: () => set({ error: null }),

    quickNavOpen: false,
    setQuickNavOpen: (open) => set({ quickNavOpen: open }),

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

    settingsOpen: false,
    setSettingsOpen: (open) => set({ settingsOpen: open }),

    mindboardVersion: 0,
    touchMindboards: () => set((s) => ({ mindboardVersion: s.mindboardVersion + 1 })),

    trashVersion: 0,
    touchTrash: () => set((s) => ({ trashVersion: s.trashVersion + 1 })),

    researchVersion: 0,
    touchResearch: () => {
      set((s) => ({ researchVersion: s.researchVersion + 1 }));
      void get().refreshPlanIndex();
    },
  };
}
