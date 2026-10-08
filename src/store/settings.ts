// App-weite Einstellungen und Ansichtsvorlieben.

import { api } from "../api";
import { applySettings, defaultSettings, mergeSettings, type AppSettings } from "../settings";
import { loadNormVariant, saveNormVariant, type NormVariant } from "../stats";
import type { GetState, SetState } from ".";

let settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;

export interface SettingsSlice {
  /** App-weite Einstellungen (Phase 7): Theme, Editor, Layout, Kürzel. */
  settings: AppSettings;
  /** Lädt gespeicherte Einstellungen vom Backend und wendet sie an. */
  initSettings: () => Promise<void>;
  /** Wendet die Änderung sofort an und persistiert debounced. */
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Schreibt eine noch ausstehende Änderung sofort (vor dem Beenden). */
  flushSettings: () => Promise<void>;
  focusMode: boolean;
  toggleFocusMode: () => void;
  setFocusMode: (on: boolean) => void;
  normVariant: NormVariant;
  setNormVariant: (v: NormVariant) => void;
}

export function createSettingsSlice(set: SetState, get: GetState): SettingsSlice {
  return {
    settings: defaultSettings(),

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

    flushSettings: async () => {
      if (!settingsPersistTimer) return;
      clearTimeout(settingsPersistTimer);
      settingsPersistTimer = null;
      await api.saveSettings(get().settings).catch(() => {});
    },

    focusMode: false,
    toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    setFocusMode: (on) => set({ focusMode: on }),

    normVariant: loadNormVariant(),
    setNormVariant: (v) => {
      saveNormVariant(v);
      set({ normVariant: v });
    },
  };
}
