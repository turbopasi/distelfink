// Reine Geometrie fürs Mindboard — ohne React und DOM, damit sie sich
// headless prüfen lässt (scripts/mindboard.test.mts).

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rechteck aus zwei beliebigen Eckpunkten (Auswahlrahmen). */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Umschließendes Rechteck; null bei leerer Liste. */
export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Wo die Strecke von der Mitte des Rechtecks nach `toward` seinen Rand
 *  verlässt, um `pad` nach außen gerückt. So enden Linien am Rand der Notiz
 *  statt in ihrer Mitte. */
export function borderPoint(r: Rect, toward: Point, pad = 0): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Linie zwischen zwei Notizen, von Rand zu Rand. null, wenn sich die
 *  Notizen überlappen (dann gäbe es nichts Sinnvolles zu zeichnen). */
export function edgeLine(a: Rect, b: Rect, pad = 4): { a: Point; b: Point } | null {
  if (intersects(a, b)) return null;
  return { a: borderPoint(a, center(b), pad), b: borderPoint(b, center(a), pad) };
}

export type AlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "stack"
  | "distribute-h"
  | "distribute-v";

/** Neue linke obere Ecken für `rects` (gleiche Reihenfolge).
 *  "stack" stapelt untereinander, linksbündig mit kleinem Abstand. */
export function align(rects: Rect[], mode: AlignMode, gap = 12): Point[] {
  const box = bounds(rects);
  if (!box) return [];
  switch (mode) {
    case "left":
      return rects.map((r) => ({ x: box.x, y: r.y }));
    case "center":
      return rects.map((r) => ({ x: box.x + box.w / 2 - r.w / 2, y: r.y }));
    case "right":
      return rects.map((r) => ({ x: box.x + box.w - r.w, y: r.y }));
    case "top":
      return rects.map((r) => ({ x: r.x, y: box.y }));
    case "middle":
      return rects.map((r) => ({ x: r.x, y: box.y + box.h / 2 - r.h / 2 }));
    case "bottom":
      return rects.map((r) => ({ x: r.x, y: box.y + box.h - r.h }));
    case "stack": {
      const order = rects.map((r, i) => ({ r, i })).sort((p, q) => p.r.y - q.r.y);
      const out: Point[] = new Array(rects.length);
      let y = box.y;
      for (const { r, i } of order) {
        out[i] = { x: box.x, y };
        y += r.h + gap;
      }
      return out;
    }
    case "distribute-h":
    case "distribute-v": {
      const horizontal = mode === "distribute-h";
      const order = rects
        .map((r, i) => ({ r, i }))
        .sort((p, q) => (horizontal ? p.r.x - q.r.x : p.r.y - q.r.y));
      const total = order.reduce((s, { r }) => s + (horizontal ? r.w : r.h), 0);
      const space = ((horizontal ? box.w : box.h) - total) / Math.max(order.length - 1, 1);
      const out: Point[] = new Array(rects.length);
      let pos = horizontal ? box.x : box.y;
      for (const { r, i } of order) {
        out[i] = horizontal ? { x: pos, y: r.y } : { x: r.x, y: pos };
        pos += (horizontal ? r.w : r.h) + space;
      }
      return out;
    }
  }
}
