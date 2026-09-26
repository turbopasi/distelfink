// Headless-Test fürs Mindboard: Geometrie (Linienenden, Ausrichten) und
// Datenoperationen (Verbinden/Trennen, Löschen, Verlauf).
// Aufruf: npx tsx scripts/mindboard.test.mts
import assert from "node:assert/strict";
import { align, borderPoint, edgeLine } from "../src/components/mindboard/geometry";
import {
  History,
  cloneNodes,
  removeItems,
  toggleConnections,
} from "../src/components/mindboard/model";
import type { Mindboard } from "../src/types";

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`JA    ${name}`);
  } catch (e) {
    failed++;
    console.log(`NEIN  ${name}\n      ${(e as Error).message}`);
  }
}

check("Linie endet am Rand, nicht in der Mitte", () => {
  const p = borderPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 20 });
  assert.deepEqual(p, { x: 100, y: 20 });
});

check("Linie zwischen übereinander liegenden Notizen", () => {
  const line = edgeLine({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 100, w: 100, h: 40 }, 0);
  assert.deepEqual(line, { a: { x: 50, y: 40 }, b: { x: 50, y: 100 } });
});

check("Überlappende Notizen bekommen keine Linie", () => {
  assert.equal(edgeLine({ x: 0, y: 0, w: 100, h: 40 }, { x: 50, y: 10, w: 100, h: 40 }), null);
});

check("Linksbündig ausrichten", () => {
  const pts = align(
    [
      { x: 10, y: 0, w: 50, h: 20 },
      { x: 40, y: 50, w: 80, h: 20 },
    ],
    "left",
  );
  assert.deepEqual(pts, [
    { x: 10, y: 0 },
    { x: 10, y: 50 },
  ]);
});

check("Stapeln folgt der Höhe, mit Abstand", () => {
  const pts = align(
    [
      { x: 30, y: 100, w: 50, h: 20 },
      { x: 0, y: 0, w: 50, h: 30 },
    ],
    "stack",
    10,
  );
  assert.deepEqual(pts, [
    { x: 0, y: 40 },
    { x: 0, y: 0 },
  ]);
});

check("Verteilen lässt gleiche Lücken", () => {
  const pts = align(
    [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 15, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
    ],
    "distribute-h",
  );
  assert.deepEqual(
    pts.map((p) => p.x),
    [0, 45, 90],
  );
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

check("Ablegen verbindet, zweites Ablegen trennt", () => {
  const once = toggleConnections(board(), ["a"], "b", "none");
  assert.equal(once.edges.length, 1);
  const twice = toggleConnections(once, ["a"], "b", "none");
  assert.equal(twice.edges.length, 0);
});

check("Mehrere Quellen: fehlende Verbindungen werden ergänzt", () => {
  const one = toggleConnections(board(), ["a"], "c", "end");
  const both = toggleConnections(one, ["a", "b"], "c", "end");
  assert.equal(both.edges.length, 2);
  assert.ok(both.edges.every((e) => e.to === "c" && e.arrow === "end"));
});

check("Löschen nimmt Verbindungen mit", () => {
  const linked = toggleConnections(board(), ["a", "b"], "c", "none");
  const after = removeItems(linked, ["c"], []);
  assert.equal(after.nodes.length, 2);
  assert.equal(after.edges.length, 0);
});

check("Duplizieren übernimmt nur innere Verbindungen, mit neuen IDs", () => {
  const b = toggleConnections(toggleConnections(board(), ["a"], "b", "none"), ["b"], "c", "none");
  const { board: next, ids } = cloneNodes(b, b.nodes.slice(0, 2), b.edges, { x: 10, y: 10 });
  assert.equal(next.nodes.length, 5);
  assert.equal(next.edges.length, 3);
  const copyEdge = next.edges[2];
  assert.ok(ids.includes(copyEdge.from) && ids.includes(copyEdge.to));
});

check("Verlauf: rückgängig, wiederholen, neue Änderung verwirft Wiederholen", () => {
  const h = new History<number>(2);
  h.push(1);
  h.push(2);
  h.push(3); // 1 fällt über das Limit heraus
  assert.equal(h.undo(4), 3);
  assert.equal(h.undo(3), 2);
  assert.equal(h.undo(2), null);
  assert.equal(h.redo(2), 3);
  h.push(3);
  assert.equal(h.canRedo, false);
});

if (failed) {
  console.log(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Prüfungen bestanden.");
