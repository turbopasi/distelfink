// Gemeinsames fürs Ziehen und Ablegen quer durch die Oberfläche.
import type { DragEvent } from "react";

/** Ist das Ziehen wirklich hinausgegangen, oder nur auf ein Kindelement
 *  gewechselt? dragleave feuert bei jedem Kind, das der Zeiger betritt. */
export function leftFor(e: DragEvent) {
  return !e.currentTarget.contains(e.relatedTarget as Node | null);
}

// Verknüpfen per Ziehen: Dokumente aus dem Binder und Personen aus der
// Seitenleiste tragen je einen eigenen Datentyp. Beim Überfahren verrät der
// Browser nur die Datentypen, nicht den Inhalt — am Typ erkennt ein Ziel also,
// ob es etwas annehmen kann, und die ID merkt sich das Modul (DnD läuft nie
// parallel). Weil der Typ nur während des Ziehens existiert, stört eine
// liegengebliebene ID nicht, falls ein dragend einmal ausbleibt.

/** Dokument aus dem Binder. Ordner tragen den Typ nicht — sie lassen sich
 *  also gar nicht erst ablegen. */
export const SCENE_DRAG_TYPE = "application/x-distelfink-scene";

let draggedScene: string | null = null;

export function startSceneDrag(e: DragEvent, id: string) {
  draggedScene = id;
  e.dataTransfer.setData(SCENE_DRAG_TYPE, id);
}

/** Welches Dokument gerade über diesem Element hängt, sonst null. */
export function draggedSceneId(e: DragEvent): string | null {
  return e.dataTransfer.types.includes(SCENE_DRAG_TYPE) ? draggedScene : null;
}

/** Person aus der Seitenleiste. */
export const PERSON_DRAG_TYPE = "application/x-distelfink-person";

let draggedPerson: string | null = null;

export function startPersonDrag(e: DragEvent, id: string) {
  draggedPerson = id;
  e.dataTransfer.setData(PERSON_DRAG_TYPE, id);
  e.dataTransfer.setData("text/plain", id);
  e.dataTransfer.effectAllowed = "link";
}

/** Welche Person gerade über diesem Element hängt, sonst null. */
export function draggedPersonId(e: DragEvent): string | null {
  return e.dataTransfer.types.includes(PERSON_DRAG_TYPE) ? draggedPerson : null;
}
