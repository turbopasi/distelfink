// Rechenregeln des Zeitstrahls, ohne React: Wo ist Platz, wohin darf eine
// Auswahl rücken, wie weit eine Kante wachsen, und wo rastet etwas ein.
// Alles in Rastereinheiten; Pixel kommen nur beim Magneten ins Spiel, weil
// „nah dran" vom Zoom abhängt.

import type { TimelineEvent } from "../../types";

/** Länge eines neu angelegten Ereignisses. */
export const DEFAULT_LENGTH = 4;

/** So nah (in Pixeln) muss eine Kante an einer anderen sein, damit sie
 *  einrastet. */
export const MAGNET_PX = 8;

export function end(ev: TimelineEvent) {
  return ev.start + ev.length;
}

/** Ist `[start, start + length)` im Strang frei? Ereignisse in `ignore`
 *  zählen nicht — sie sind es, die gerade bewegt werden. */
export function isFree(
  events: TimelineEvent[],
  trackId: string,
  start: number,
  length: number,
  ignore: ReadonlySet<string> = new Set(),
) {
  return !events.some(
    (e) =>
      e.trackId === trackId && !ignore.has(e.id) && e.start < start + length && start < end(e),
  );
}

/** Die Auswahl um `dx` Einheiten und `dTrack` Stränge versetzt — oder null,
 *  wenn ein Ziel belegt ist oder es den Strang nicht gibt. Die Ereignisse der
 *  Auswahl stehen sich dabei nicht im Weg: sie rücken alle gleich weit. */
export function moveGroup(
  events: TimelineEvent[],
  trackIds: string[],
  ids: ReadonlySet<string>,
  dx: number,
  dTrack: number,
): TimelineEvent[] | null {
  const moved = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (!ids.has(e.id)) continue;
    const trackId = trackIds[trackIds.indexOf(e.trackId) + dTrack];
    if (trackId === undefined) return null;
    const next = { ...e, trackId, start: e.start + dx };
    if (!isFree(events, trackId, next.start, next.length, ids)) return null;
    moved.set(e.id, next);
  }
  return events.map((e) => moved.get(e.id) ?? e);
}

/** Neue Lage eines Ereignisses, dessen linke oder rechte Kante nach `to`
 *  gezogen wird. Die Kante hält am Nachbarn an — beim Größenändern wird
 *  nichts übersprungen — und das Ereignis bleibt mindestens eine Einheit lang. */
export function resizeTo(
  events: TimelineEvent[],
  ev: TimelineEvent,
  edge: "left" | "right",
  to: number,
): { start: number; length: number } {
  const others = events.filter((e) => e.trackId === ev.trackId && e.id !== ev.id);
  if (edge === "right") {
    const limit = Math.min(
      ...others.filter((e) => e.start >= end(ev)).map((e) => e.start),
      Infinity,
    );
    const newEnd = Math.max(ev.start + 1, Math.min(to, limit));
    return { start: ev.start, length: newEnd - ev.start };
  }
  const limit = Math.max(...others.filter((e) => end(e) <= ev.start).map(end), -Infinity);
  const newStart = Math.min(end(ev) - 1, Math.max(to, limit));
  return { start: newStart, length: end(ev) - newStart };
}

/** Wie lang darf ein neues Ereignis ab `start` werden, ohne etwas zu
 *  überdecken? 0 heißt: dort ist kein Platz. */
export function roomAt(events: TimelineEvent[], trackId: string, start: number, wanted: number) {
  if (!isFree(events, trackId, start, 1)) return 0;
  const next = Math.min(
    ...events.filter((e) => e.trackId === trackId && e.start > start).map((e) => e.start),
    Infinity,
  );
  return Math.min(wanted, next - start);
}

/** Alle Kanten (Anfänge und Enden) der Ereignisse außerhalb von `ignore` —
 *  die Stellen, an denen der Magnet zieht. */
export function edgesOf(events: TimelineEvent[], ignore: ReadonlySet<string>) {
  const edges = new Set<number>();
  for (const e of events) {
    if (ignore.has(e.id)) continue;
    edges.add(e.start);
    edges.add(end(e));
  }
  return [...edges];
}

/** Die nächste Kante, die höchstens MAGNET_PX entfernt ist, sonst null. */
function nearestEdge(raw: number, edges: number[], pxPerUnit: number) {
  let best: number | null = null;
  for (const edge of edges) {
    const d = Math.abs(edge - raw) * pxPerUnit;
    if (d <= MAGNET_PX && (best === null || d < Math.abs(best - raw) * pxPerUnit)) best = edge;
  }
  return best;
}

/** Eine einzelne Kante einrasten: zuerst am Magneten, sonst aufs Raster.
 *  `guide` ist die Stelle der Hilfslinie, wenn die Kante auf einer fremden
 *  Kante sitzt. */
export function snapEdge(raw: number, edges: number[], pxPerUnit: number, magnet: boolean) {
  const hit = magnet ? nearestEdge(raw, edges, pxPerUnit) : null;
  const value = hit ?? Math.round(raw);
  return { value, guide: edges.includes(value) ? value : null };
}

/** Einen ganzen Balken einrasten: Anfang oder Ende, je nachdem, welche Kante
 *  näher an einer fremden liegt. Ohne Treffer zählt das Raster. */
export function snapSpan(
  rawStart: number,
  length: number,
  edges: number[],
  pxPerUnit: number,
  magnet: boolean,
) {
  if (magnet) {
    const atStart = nearestEdge(rawStart, edges, pxPerUnit);
    const atEnd = nearestEdge(rawStart + length, edges, pxPerUnit);
    const dStart = atStart === null ? Infinity : Math.abs(atStart - rawStart);
    const dEnd = atEnd === null ? Infinity : Math.abs(atEnd - (rawStart + length));
    if (atStart !== null && dStart <= dEnd) return { start: atStart, guide: atStart };
    if (atEnd !== null) return { start: atEnd - length, guide: atEnd };
  }
  const start = Math.round(rawStart);
  const guide = edges.includes(start)
    ? start
    : edges.includes(start + length)
      ? start + length
      : null;
  return { start, guide };
}
