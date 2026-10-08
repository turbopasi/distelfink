// Mindboard: Geometrie (Linienenden, Ausrichten) und Datenoperationen
// (Verbinden/Trennen, Löschen, Duplizieren, Verlauf).
import { describe, expect, it } from "vitest";
import type { Mindboard } from "../../types";
import { align, borderPoint, edgeLine } from "./geometry";
import { cloneNodes, History, removeItems, toggleConnections } from "./model";

describe("Geometrie", () => {
  it("lässt Linien am Rand enden, nicht in der Mitte", () => {
    expect(borderPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 20 })).toEqual({
      x: 100,
      y: 20,
    });
  });

  it("verbindet übereinander liegende Notizen senkrecht", () => {
    const line = edgeLine({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 100, w: 100, h: 40 }, 0);
    expect(line).toEqual({ a: { x: 50, y: 40 }, b: { x: 50, y: 100 } });
  });

  it("zeichnet keine Linie zwischen überlappenden Notizen", () => {
    expect(edgeLine({ x: 0, y: 0, w: 100, h: 40 }, { x: 50, y: 10, w: 100, h: 40 })).toBeNull();
  });

  it("richtet linksbündig aus", () => {
    const rects = [
      { x: 10, y: 0, w: 50, h: 20 },
      { x: 40, y: 50, w: 80, h: 20 },
    ];
    expect(align(rects, "left")).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 50 },
    ]);
  });

  it("stapelt nach Höhe, mit Abstand", () => {
    const rects = [
      { x: 30, y: 100, w: 50, h: 20 },
      { x: 0, y: 0, w: 50, h: 30 },
    ];
    expect(align(rects, "stack", 10)).toEqual([
      { x: 0, y: 40 },
      { x: 0, y: 0 },
    ]);
  });

  it("verteilt mit gleichen Lücken", () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 15, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
    ];
    expect(align(rects, "distribute-h").map((p) => p.x)).toEqual([0, 45, 90]);
  });
});

const board = (): Mindboard => ({
  id: "b",
  name: "Test",
  nodes: [
    { id: "a", kind: "text", x: 0, y: 0, text: "A" },
    { id: "b", kind: "text", x: 200, y: 0, text: "B" },
    { id: "c", kind: "text", x: 400, y: 0, text: "C" },
  ],
  edges: [],
  shapes: [],
});

describe("Datenoperationen", () => {
  it("verbindet beim Ablegen und trennt beim zweiten Mal", () => {
    const once = toggleConnections(board(), ["a"], "b", "none");
    expect(once.edges).toHaveLength(1);
    expect(toggleConnections(once, ["a"], "b", "none").edges).toHaveLength(0);
  });

  it("ergänzt bei mehreren Quellen nur fehlende Verbindungen", () => {
    const one = toggleConnections(board(), ["a"], "c", "end");
    const both = toggleConnections(one, ["a", "b"], "c", "end");
    expect(both.edges).toHaveLength(2);
    expect(both.edges.every((e) => e.to === "c" && e.arrow === "end")).toBe(true);
  });

  it("nimmt beim Löschen die Verbindungen mit", () => {
    const linked = toggleConnections(board(), ["a", "b"], "c", "none");
    const after = removeItems(linked, ["c"], []);
    expect(after.nodes).toHaveLength(2);
    expect(after.edges).toHaveLength(0);
  });

  it("übernimmt beim Duplizieren nur innere Verbindungen, mit neuen IDs", () => {
    const b = toggleConnections(toggleConnections(board(), ["a"], "b", "none"), ["b"], "c", "none");
    const { board: next, ids } = cloneNodes(b, b.nodes.slice(0, 2), b.edges, { x: 10, y: 10 });
    expect(next.nodes).toHaveLength(5);
    expect(next.edges).toHaveLength(3);
    const copy = next.edges[2];
    expect(ids).toContain(copy.from);
    expect(ids).toContain(copy.to);
  });

  it("Verlauf: rückgängig, wiederholen, neue Änderung verwirft Wiederholen", () => {
    const h = new History<number>(2);
    h.push(1);
    h.push(2);
    h.push(3); // 1 fällt über das Limit heraus
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeNull();
    expect(h.redo(2)).toBe(3);
    h.push(3);
    expect(h.canRedo).toBe(false);
  });
});
