// Zentraler Zustand der App, aufgeteilt in Slices:
//   panes    — was die Bereiche zeigen, Layout, Speichern der Szenen
//   project  — offenes Projekt, Binder, Zählungen, Planungsindex, Verlauf
//   settings — Einstellungen und Ansichtsvorlieben
//   ui       — Dialoge, Fehlermeldung, Refresh-Signale
// Die Slices sprechen sich über `get()` an; der Store ist einer.

import { create, type StoreApi } from "zustand";
import { attachContentSource, createPaneSlice, type PaneId, type PaneSlice } from "./panes";
import { createProjectSlice, type ProjectSlice } from "./project";
import { createSettingsSlice, type SettingsSlice } from "./settings";
import { createUiSlice, type UiSlice } from "./ui";

export type Store = PaneSlice & ProjectSlice & SettingsSlice & UiSlice;
export type SetState = StoreApi<Store>["setState"];
export type GetState = StoreApi<Store>["getState"];

export const useStore = create<Store>()((set, get) => ({
  ...createPaneSlice(set, get),
  ...createProjectSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createUiSlice(set, get),
}));

/** Meldet den Editor eines Bereichs als Quelle seines Inhalts an: der Store
 *  holt sich das Markdown erst beim Speichern. Die zurückgegebene Funktion
 *  meldet ihn wieder ab und übernimmt dabei ungespeicherte Änderungen nach
 *  `pane.content` — so gehen sie nicht verloren, wenn der Editor verschwindet,
 *  bevor gespeichert wurde. */
export function registerContentSource(paneId: PaneId, source: () => string): () => void {
  return attachContentSource(useStore.getState, useStore.setState, paneId, source);
}

export {
  hasOpenConflict,
  LAYOUT_MODES,
  PANE_IDS,
  PANES_FOR_MODE,
  sceneView,
  showsMindboard,
  showsResearch,
  showsScene,
  type LayoutMode,
  type Pane,
  type PaneId,
  type PaneOverlay,
  type PaneResearchKind,
  type PaneView,
  type SaveState,
} from "./panes";
export { loadRecents, type PlanIndex, type PlanIndexEntry } from "./project";
