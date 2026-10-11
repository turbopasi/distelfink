// Zeitstrahl: freie Plätze, Verschieben (auch als Gruppe und über Stränge),
// Größenändern bis zum Nachbarn und Einrasten.
import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types";
import { edgesOf, isFree, moveGroup, resizeTo, roomAt, snapEdge, snapSpan } from "./model";

function ev(id: string, trackId: string, start: number, length: number): TimelineEvent {
  return { id, title: id, trackId, start, length };
}

const TRACKS = ["a", "b"];

/** a: [0,4) [6,8)   b: [2,5) */
const EVENTS = [ev("a1", "a", 0, 4), ev("a2", "a", 6, 2), ev("b1", "b", 2, 3)];

function spans(events: TimelineEvent[] | null) {
  return events?.map((e) => `${e.id}:${e.trackId}@${e.start}+${e.length}`);
}

describe("freie Plätze", () => {
  it("erkennt Überlappung nur im selben Strang", () => {
    expect(isFree(EVENTS, "a", 4, 2)).toBe(true);
    expect(isFree(EVENTS, "a", 3, 2)).toBe(false);
    expect(isFree(EVENTS, "b", 0, 2)).toBe(true);
  });

  it("lässt bewegte Ereignisse außen vor", () => {
    expect(isFree(EVENTS, "a", 2, 3, new Set(["a1"]))).toBe(true);
  });

  it("kürzt ein neues Ereignis bis zum Nachbarn", () => {
    expect(roomAt(EVENTS, "a", 4, 4)).toBe(2);
    expect(roomAt(EVENTS, "a", 10, 4)).toBe(4);
    expect(roomAt(EVENTS, "a", 1, 4)).toBe(0);
  });
});

describe("Verschieben", () => {
  it("rückt in eine freie Stelle", () => {
    expect(spans(moveGroup(EVENTS, TRACKS, new Set(["a2"]), 2, 0))).toContain("a2:a@8+2");
  });

  it("verweigert eine belegte Stelle", () => {
    expect(moveGroup(EVENTS, TRACKS, new Set(["a2"]), -3, 0)).toBeNull();
  });

  it("springt über ein Hindernis, wenn dahinter Platz ist", () => {
    // a1 hinter a2: der Weg führt durch a2, das Ziel ist frei.
    expect(spans(moveGroup(EVENTS, TRACKS, new Set(["a1"]), 8, 0))).toContain("a1:a@8+4");
  });

  it("wechselt den Strang", () => {
    expect(spans(moveGroup(EVENTS, TRACKS, new Set(["a2"]), 0, 1))).toContain("a2:b@6+2");
    expect(moveGroup(EVENTS, TRACKS, new Set(["a1"]), 0, 1)).toBeNull();
    expect(moveGroup(EVENTS, TRACKS, new Set(["a1"]), 0, -1)).toBeNull();
  });

  it("bewegt eine Gruppe, deren Teile sich gegenseitig nicht blockieren", () => {
    const moved = moveGroup(EVENTS, TRACKS, new Set(["a1", "a2"]), 2, 0);
    expect(spans(moved)).toEqual(["a1:a@2+4", "a2:a@8+2", "b1:b@2+3"]);
  });

  it("bewegt eine Gruppe nur, wenn alle Ziele frei sind", () => {
    // a2 käme in b auf [6,8) — frei; a1 auf [0,4) in b — stößt an b1.
    expect(moveGroup(EVENTS, TRACKS, new Set(["a1", "a2"]), 0, 1)).toBeNull();
  });
});

describe("Größe ändern", () => {
  it("hält rechts am Nachbarn an", () => {
    expect(resizeTo(EVENTS, EVENTS[0], "right", 9)).toEqual({ start: 0, length: 6 });
  });

  it("hält links am Nachbarn an", () => {
    expect(resizeTo(EVENTS, EVENTS[1], "left", 1)).toEqual({ start: 4, length: 4 });
  });

  it("wächst frei, wo nichts im Weg ist", () => {
    expect(resizeTo(EVENTS, EVENTS[0], "left", -5)).toEqual({ start: -5, length: 9 });
    expect(resizeTo(EVENTS, EVENTS[1], "right", 20)).toEqual({ start: 6, length: 14 });
  });

  it("bleibt mindestens eine Einheit lang", () => {
    expect(resizeTo(EVENTS, EVENTS[0], "right", -3)).toEqual({ start: 0, length: 1 });
    expect(resizeTo(EVENTS, EVENTS[0], "left", 10)).toEqual({ start: 3, length: 1 });
  });
});

describe("Einrasten", () => {
  const edges = edgesOf(EVENTS, new Set(["a2"]));

  it("sammelt die Kanten der übrigen Ereignisse", () => {
    expect(edges.sort((x, y) => x - y)).toEqual([0, 2, 4, 5]);
  });

  it("rundet ohne Magnet aufs Raster", () => {
    expect(snapEdge(6.4, edges, 20, false)).toEqual({ value: 6, guide: null });
  });

  it("zieht eine nahe Kante an und zeigt die Hilfslinie", () => {
    // 5.3 Einheiten liegen bei 20 px je Einheit 6 px neben der Kante 5.
    expect(snapEdge(5.3, edges, 20, true)).toEqual({ value: 5, guide: 5 });
    expect(snapEdge(5.6, edges, 20, true)).toEqual({ value: 6, guide: null });
  });

  it("rastet einen Balken an der näheren seiner beiden Kanten ein", () => {
    // Ende bei 4.8 + 2 = 6.8 — nichts in der Nähe; Anfang 4.8 liegt 4 px vor 5.
    expect(snapSpan(4.8, 2, edges, 20, true)).toEqual({ start: 5, guide: 5 });
    // Anfang 2.6 liegt 12 px hinter 2 — zu weit; das Ende 4.6 liegt 8 px vor 5.
    expect(snapSpan(2.6, 2, edges, 20, true)).toEqual({ start: 3, guide: 5 });
  });

  it("zeigt die Hilfslinie auch, wenn das Raster genau auf eine Kante trifft", () => {
    expect(snapSpan(2.1, 2, edges, 20, false)).toEqual({ start: 2, guide: 2 });
  });
});
