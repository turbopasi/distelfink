// Zuletzt gezeigter Ausschnitt je Mindboard — Ansichtssache wie die
// zugeklappten Binder-Ordner, gehört also nicht in die Projektdatei. Dort
// löste jedes Verschieben und Zoomen ein Speichern, einen Sync und eine
// Änderung im Verlauf aus, und zwei Rechner stritten sich um die Ansicht.

import type { MindView } from "../../types";

const KEY = "distelfink.mindboardViews";

function key(root: string, boardId: string) {
  return `${root}::${boardId}`;
}

function loadAll(): Record<string, MindView> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function loadView(root: string, boardId: string): MindView | null {
  return loadAll()[key(root, boardId)] ?? null;
}

export function storeView(root: string, boardId: string, view: MindView) {
  try {
    const all = loadAll();
    all[key(root, boardId)] = view;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Nur Komfort — ohne gemerkte Ansicht öffnet das Board eingepasst.
  }
}
