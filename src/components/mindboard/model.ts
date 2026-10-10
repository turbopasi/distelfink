// Datenoperationen und Verlauf fürs Mindboard. Alles unveränderlich: jede
// Operation liefert ein neues Board, damit der Verlauf nur alte Stände
// aufheben muss.

import { newId } from "../../ids";
import type { MindArrow, MindEdge, MindNode, Mindboard } from "../../types";

/** Verbindung zwischen zwei Notizen, egal in welcher Richtung. */
export function findEdge(board: Mindboard, a: string, b: string): MindEdge | undefined {
  return board.edges.find(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  );
}

/** Verbindet jede Quelle mit dem Ziel — oder trennt, wenn alle Quellen schon
 *  mit ihm verbunden sind. So wirkt dasselbe Ablegen einmal hin, einmal zurück. */
export function toggleConnections(
  board: Mindboard,
  sources: string[],
  target: string,
  arrow: MindArrow,
): Mindboard {
  const from = sources.filter((s) => s !== target);
  if (!from.length) return board;
  const allLinked = from.every((s) => findEdge(board, s, target));
  if (allLinked) {
    return {
      ...board,
      edges: board.edges.filter(
        (e) =>
          !from.some(
            (s) => (e.from === s && e.to === target) || (e.from === target && e.to === s),
          ),
      ),
    };
  }
  const added: MindEdge[] = from
    .filter((s) => !findEdge(board, s, target))
    .map((s) => ({ id: newId("e"), from: s, to: target, arrow }));
  return { ...board, edges: [...board.edges, ...added] };
}

/** Entfernt Notizen, Formen und eine Verbindung samt allem, was daran hängt. */
export function removeItems(
  board: Mindboard,
  nodeIds: string[],
  shapeIds: string[],
  edgeId: string | null = null,
): Mindboard {
  const gone = new Set(nodeIds);
  const shapesGone = new Set(shapeIds);
  return {
    ...board,
    nodes: board.nodes.filter((n) => !gone.has(n.id)),
    shapes: board.shapes.filter((s) => !shapesGone.has(s.id)),
    edges: board.edges.filter(
      (e) => e.id !== edgeId && !gone.has(e.from) && !gone.has(e.to),
    ),
  };
}

export function patchNodes(
  board: Mindboard,
  ids: string[],
  patch: Partial<MindNode> | ((n: MindNode) => Partial<MindNode>),
): Mindboard {
  const set = new Set(ids);
  return {
    ...board,
    nodes: board.nodes.map((n) =>
      set.has(n.id) ? { ...n, ...(typeof patch === "function" ? patch(n) : patch) } : n,
    ),
  };
}

/** Kopiert Notizen (und die Verbindungen zwischen ihnen) mit neuen IDs,
 *  um `offset` versetzt. Liefert das neue Board und die neuen IDs. */
export function cloneNodes(
  board: Mindboard,
  nodes: MindNode[],
  edges: MindEdge[],
  offset: { x: number; y: number },
): { board: Mindboard; ids: string[] } {
  const map = new Map<string, string>();
  const copies = nodes.map((n) => {
    const id = newId("n");
    map.set(n.id, id);
    return { ...n, id, x: n.x + offset.x, y: n.y + offset.y };
  });
  const edgeCopies = edges
    .filter((e) => map.has(e.from) && map.has(e.to))
    .map((e) => ({ ...e, id: newId("e"), from: map.get(e.from)!, to: map.get(e.to)! }));
  return {
    board: {
      ...board,
      nodes: [...board.nodes, ...copies],
      edges: [...board.edges, ...edgeCopies],
    },
    ids: copies.map((c) => c.id),
  };
}

/** Rückgängig/Wiederholen als zwei Stapel alter Stände. */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private limit = 100) {}

  /** Merkt sich `previous` als Stand vor der nächsten Änderung. */
  push(previous: T) {
    this.undoStack.push(previous);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: T): T | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
