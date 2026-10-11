// Die Fläche des Zeitstrahls: oben das Lineal, links die Köpfe der Stränge,
// daneben je Strang eine Bahn mit den Balken. Ziehen verschiebt (auch in
// andere Stränge), die Ränder eines Balkens ändern seine Länge, ein Rahmen
// über freier Fläche markiert mehrere. Während einer Geste zeigt die Fläche
// nur eine Vorschau; gespeichert wird einmal beim Loslassen.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import type { TimelineEvent, TimelineTrack } from "../../types";
import { ContextMenu, openBelow, useContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { colorSubmenu } from "../NodeActions";
import { EventBar } from "./EventBar";
import {
  DEFAULT_LENGTH,
  edgesOf,
  end,
  moveGroup,
  resizeTo,
  roomAt,
  snapEdge,
  snapSpan,
} from "./model";

/** Breite der Kopfspalte, Höhe des Lineals und einer Bahn — in Pixeln. Die
 *  Fläche rechnet mit ihnen, darum stehen sie hier und nicht im CSS. */
const HEADER_W = 208;
const RULER_H = 28;
const LANE_H = 84;

/** Freie Einheiten vor dem ersten und hinter dem letzten Ereignis — Platz zum
 *  Anlegen und zum Hinziehen. */
const PAD_BEFORE = 4;
const PAD_AFTER = 24;

/** Ab so vielen Pixeln Bewegung wird aus einem Klick ein Ziehen. */
const DRAG_THRESHOLD = 3;

/** Beschriftungen des Lineals: der kleinste Schritt, bei dem zwei Zahlen
 *  mindestens so weit auseinanderstehen. */
const LABEL_MIN_PX = 56;
const LABEL_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

type Drag =
  | {
      kind: "move";
      ids: Set<string>;
      /** Der angefasste Balken: er bestimmt das Einrasten der ganzen Gruppe. */
      grab: TimelineEvent;
      x0: number;
      y0: number;
      base: TimelineEvent[];
      edges: number[];
      moved: boolean;
      /** Ohne Bewegung losgelassen und ohne Umschalt/Strg: dann bleibt nur
       *  dieser Balken markiert. */
      click: boolean;
      /** Letzter gültiger Stand — bei einem belegten Ziel bleibt er stehen. */
      result: TimelineEvent[] | null;
    }
  | {
      kind: "resize";
      edge: "left" | "right";
      ev: TimelineEvent;
      x0: number;
      base: TimelineEvent[];
      edges: number[];
      result: TimelineEvent[] | null;
    }
  | { kind: "box"; x0: number; y0: number; base: string[] };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function TimelineBoard({
  tracks,
  events,
  selected,
  ppu,
  onZoom,
  onSelect,
  onEvents,
  onTracks,
  onPatchEvent,
  onAddEvent,
  onDeleteEvents,
  onDeleteTrack,
}: {
  tracks: TimelineTrack[];
  events: TimelineEvent[];
  selected: string[];
  /** Pixel je Rastereinheit. */
  ppu: number;
  onZoom: (factor: number) => void;
  onSelect: (ids: string[]) => void;
  onEvents: (next: TimelineEvent[]) => void;
  onTracks: (next: TimelineTrack[]) => void;
  onPatchEvent: (id: string, patch: Partial<TimelineEvent>) => void;
  onAddEvent: (trackId: string, start: number, length: number) => void;
  onDeleteEvents: (ids: string[]) => void;
  onDeleteTrack: (track: TimelineTrack) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<TimelineEvent[] | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Die Balken, die gerade gezogen werden — sie liegen obenauf. */
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const [viewW, setViewW] = useState(0);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu();

  const trackIds = tracks.map((t) => t.id);
  const shown = preview ?? events;

  // Die Achse beginnt etwas vor dem frühesten Ereignis (spätestens bei 0) und
  // reicht über das letzte hinaus, mindestens aber über die ganze Breite.
  // Gerechnet wird mit dem gespeicherten Stand, nicht mit der Vorschau — sonst
  // liefe die Fläche beim Ziehen unter dem Zeiger weg.
  const origin = Math.min(0, ...events.map((e) => e.start)) - PAD_BEFORE;
  const last = Math.max(0, ...events.map(end)) + PAD_AFTER;
  const units = Math.max(last - origin, Math.ceil((viewW - HEADER_W) / ppu));
  const step = LABEL_STEPS.find((s) => s * ppu >= LABEL_MIN_PX) ?? 1000;

  // Rückt die Achse nach links (ein Ereignis vor allen anderen) oder ändert
  // sich der Zoom, bleibt die Stelle unter dem Zeiger bzw. in der Mitte stehen.
  const prevAxis = useRef({ origin, ppu });
  const zoomAnchor = useRef<{ unit: number; x: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevAxis.current;
    if (!el || (prev.origin === origin && prev.ppu === ppu)) return;
    const x = (el.clientWidth - HEADER_W) / 2;
    const anchor = zoomAnchor.current ?? { unit: (el.scrollLeft + x) / prev.ppu + prev.origin, x };
    el.scrollLeft = (anchor.unit - origin) * ppu - anchor.x;
    zoomAnchor.current = null;
    prevAxis.current = { origin, ppu };
  }, [origin, ppu]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewW(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Strg+Mausrad zoomt um den Zeiger. React meldet wheel nur passiv — zum
  // Verhindern des Seiten-Zooms braucht es einen eigenen Listener.
  const axisRef = useRef({ origin, ppu, onZoom });
  useLayoutEffect(() => {
    axisRef.current = { origin, ppu, onZoom };
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { origin, ppu, onZoom } = axisRef.current;
      const x = e.clientX - el.getBoundingClientRect().left - HEADER_W;
      zoomAnchor.current = { unit: (el.scrollLeft + x) / ppu + origin, x };
      onZoom(e.deltaY < 0 ? 1.25 : 1 / 1.25);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Zeigerposition auf der Fläche: x ab Beginn der Achse, y ab der ersten Bahn. */
  function pos(clientX: number, clientY: number) {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: clientX - r.left + el.scrollLeft - HEADER_W,
      y: clientY - r.top + el.scrollTop - RULER_H,
    };
  }

  const unitAt = (x: number) => x / ppu + origin;
  const laneAt = (y: number) => Math.floor(y / LANE_H);
  const xOf = (unit: number) => (unit - origin) * ppu;

  const focusBoard = () => scrollRef.current?.focus({ preventScroll: true });

  /** Neues Ereignis an der Stelle unter dem Zeiger — gekürzt, wenn der
   *  Nachbar näher ist, und gar nicht, wenn die Stelle belegt ist. */
  function roomUnder(trackId: string, clientX: number) {
    const start = Math.floor(unitAt(pos(clientX, 0).x));
    return { start, length: roomAt(events, trackId, start, DEFAULT_LENGTH) };
  }

  function createAt(trackId: string, clientX: number) {
    const { start, length } = roomUnder(trackId, clientX);
    if (length > 0) onAddEvent(trackId, start, length);
  }

  function appendTo(trackId: string) {
    const start = Math.max(0, ...events.filter((e) => e.trackId === trackId).map(end));
    onAddEvent(trackId, start, DEFAULT_LENGTH);
  }

  function moveTrack(index: number, dir: -1 | 1) {
    const next = [...tracks];
    const [moved] = next.splice(index, 1);
    next.splice(index + dir, 0, moved);
    onTracks(next);
  }

  // ------------------------------------------------------------------ Gesten

  function onBarPointerDown(e: PointerEvent, ev: TimelineEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    focusBoard();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = selected;
    if (additive) {
      ids = ids.includes(ev.id) ? ids.filter((id) => id !== ev.id) : [...ids, ev.id];
      onSelect(ids);
      if (!ids.includes(ev.id)) return;
    } else if (!ids.includes(ev.id)) {
      ids = [ev.id];
      onSelect(ids);
    }
    const p = pos(e.clientX, e.clientY);
    const moving = new Set(ids);
    // Eingefangen wird erst beim Ziehen — sonst käme der Doppelklick auf den
    // Titel nicht mehr beim Balken an.
    drag.current = {
      kind: "move",
      ids: moving,
      grab: ev,
      x0: p.x,
      y0: p.y,
      base: events,
      edges: edgesOf(events, moving),
      moved: false,
      click: !additive,
      result: null,
    };
  }

  function onResizeStart(e: PointerEvent, ev: TimelineEvent, edge: "left" | "right") {
    if (e.button !== 0) return;
    e.stopPropagation();
    focusBoard();
    if (selected.length !== 1 || selected[0] !== ev.id) onSelect([ev.id]);
    drag.current = {
      kind: "resize",
      edge,
      ev,
      x0: pos(e.clientX, e.clientY).x,
      base: events,
      edges: edgesOf(events, new Set([ev.id])),
      result: null,
    };
    scrollRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tl-track-head, .tl-ruler")) return;
    focusBoard();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) onSelect([]);
    const p = pos(e.clientX, e.clientY);
    drag.current = { kind: "box", x0: p.x, y0: p.y, base: additive ? selected : [] };
    scrollRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const p = pos(e.clientX, e.clientY);
    const magnet = !e.altKey;

    if (d.kind === "box") {
      const rect = {
        x: Math.min(d.x0, p.x),
        y: Math.min(d.y0, p.y),
        w: Math.abs(p.x - d.x0),
        h: Math.abs(p.y - d.y0),
      };
      setBox(rect);
      const hits = events
        .filter((ev) => {
          const top = trackIds.indexOf(ev.trackId) * LANE_H;
          return (
            xOf(ev.start) < rect.x + rect.w &&
            rect.x < xOf(end(ev)) &&
            top < rect.y + rect.h &&
            rect.y < top + LANE_H
          );
        })
        .map((ev) => ev.id);
      onSelect([...new Set([...d.base, ...hits])]);
      return;
    }

    if (d.kind === "move") {
      if (!d.moved) {
        if (Math.hypot(p.x - d.x0, p.y - d.y0) < DRAG_THRESHOLD) return;
        d.moved = true;
        setDragging(d.ids);
        scrollRef.current?.setPointerCapture(e.pointerId);
      }
      const snapped = snapSpan(
        d.grab.start + (p.x - d.x0) / ppu,
        d.grab.length,
        d.edges,
        ppu,
        magnet,
      );
      const moved = moveGroup(
        d.base,
        trackIds,
        d.ids,
        snapped.start - d.grab.start,
        laneAt(p.y) - laneAt(d.y0),
      );
      // Belegt oder kein Strang dort: der letzte gültige Stand bleibt. Wird
      // hinter einem Hindernis Platz frei, springt die Auswahl dorthin.
      if (moved) {
        d.result = moved;
        setPreview(moved);
        setGuide(snapped.guide);
      }
      return;
    }

    const from = d.edge === "left" ? d.ev.start : end(d.ev);
    const snapped = snapEdge(from + (p.x - d.x0) / ppu, d.edges, ppu, magnet);
    const span = resizeTo(d.base, d.ev, d.edge, snapped.value);
    const result = d.base.map((ev) => (ev.id === d.ev.id ? { ...ev, ...span } : ev));
    d.result = result;
    setPreview(result);
    const edgeNow = d.edge === "left" ? span.start : span.start + span.length;
    setGuide(snapped.guide === edgeNow ? edgeNow : null);
  }

  function finish(commit: boolean) {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    setGuide(null);
    setBox(null);
    setDragging(null);
    if (!d || !commit) return;
    if (d.kind === "move" && !d.moved) {
      if (d.click && selected.length > 1) onSelect([d.grab.id]);
      return;
    }
    if (d.kind !== "box" && d.result) onEvents(d.result);
  }

  /** Doppelklick auf freie Fläche legt dort ein Ereignis an. Er kommt bei der
   *  Fläche an, nicht bei der Bahn — der Rahmen hat den Zeiger eingefangen. */
  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".tl-bar, .tl-track-head, .tl-ruler")) return;
    const p = pos(e.clientX, e.clientY);
    const track = tracks[laneAt(p.y)];
    if (p.x >= 0 && p.y >= 0 && track) createAt(track.id, e.clientX);
  }

  // ---------------------------------------------------------------- Tastatur

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
      e.preventDefault();
      onDeleteEvents(selected);
    } else if (e.key === "Escape") {
      onSelect([]);
    } else if ((e.key === "Enter" || e.key === "F2") && selected.length === 1) {
      e.preventDefault();
      setEditing(selected[0]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelect(events.map((ev) => ev.id));
    } else if (arrows[e.key] && selected.length) {
      e.preventDefault();
      const [dx, dTrack] = arrows[e.key];
      const moved = moveGroup(events, trackIds, new Set(selected), dx, dTrack);
      if (moved) onEvents(moved);
    }
  }

  // ------------------------------------------------------------------- Menüs

  function barMenu(ev: TimelineEvent): ContextMenuItem[] {
    const ids = selected.includes(ev.id) ? selected : [ev.id];
    return [
      { label: "Umbenennen", icon: "pencil", onSelect: () => setEditing(ev.id) },
      { kind: "separator" },
      {
        label: ids.length === 1 ? "Ereignis löschen" : `${ids.length} Ereignisse löschen`,
        icon: "trash-2",
        danger: true,
        onSelect: () => onDeleteEvents(ids),
      },
    ];
  }

  function trackMenu(track: TimelineTrack, index: number): ContextMenuItem[] {
    return [
      colorSubmenu(track.color, (color) =>
        onTracks(tracks.map((t) => (t.id === track.id ? { ...t, color } : t))),
      ),
      { kind: "separator" },
      {
        label: "Nach oben",
        icon: "arrow-up",
        disabled: index === 0,
        onSelect: () => moveTrack(index, -1),
      },
      {
        label: "Nach unten",
        icon: "arrow-down",
        disabled: index === tracks.length - 1,
        onSelect: () => moveTrack(index, 1),
      },
      { kind: "separator" },
      {
        label: "Strang löschen",
        icon: "trash-2",
        danger: true,
        // Ein Zeitstrahl ohne Strang wäre kein Zeitstrahl mehr.
        disabled: tracks.length === 1,
        onSelect: () => onDeleteTrack(track),
      },
    ];
  }

  // ------------------------------------------------------------------ Bild

  const ticks: number[] = [];
  for (let u = Math.ceil(origin / step) * step; u < origin + units; u += step) ticks.push(u);
  // Die kräftigen Linien der Bahnen stehen dort, wo das Lineal beschriftet ist.
  const gridShift = (((-origin % step) + step) % step) * ppu;

  return (
    <div
      className="tl-scroll"
      ref={scrollRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={
        {
          "--tl-header-w": `${HEADER_W}px`,
          "--tl-ruler-h": `${RULER_H}px`,
          "--tl-lane-h": `${LANE_H}px`,
          "--tl-unit": `${ppu}px`,
          "--tl-major": `${step * ppu}px`,
          "--tl-grid-shift": `${gridShift}px`,
        } as CSSProperties
      }
    >
      <div className="tl-canvas" style={{ width: HEADER_W + units * ppu }}>
        <div className="tl-ruler">
          <div className="tl-ruler-corner" />
          <div className="tl-ruler-scale">
            {ticks.map((u) => (
              <span key={u} className="tl-tick" style={{ left: xOf(u) }}>
                {u}
              </span>
            ))}
          </div>
        </div>
        {tracks.map((track, i) => (
          <div
            key={track.id}
            className="tl-lane"
            style={{ "--track": track.color || "var(--accent)" } as CSSProperties}
          >
            <TrackHead
              track={track}
              onRename={(name) =>
                onTracks(tracks.map((t) => (t.id === track.id ? { ...t, name } : t)))
              }
              onAdd={() => appendTo(track.id)}
              onMenu={(e) => openBelow(e, trackMenu(track, i), openAt)}
            />
            <div
              className={`tl-lane-body ${ppu >= 12 ? "fine" : ""}`}
              onContextMenu={(e) => {
                const room = roomUnder(track.id, e.clientX);
                openMenu(e, [
                  {
                    label: "Ereignis anlegen",
                    icon: "plus",
                    disabled: room.length === 0,
                    onSelect: () => onAddEvent(track.id, room.start, room.length),
                  },
                ]);
              }}
            >
              {shown
                .filter((ev) => ev.trackId === track.id)
                .map((ev) => (
                  <EventBar
                    key={ev.id}
                    event={ev}
                    left={xOf(ev.start)}
                    width={ev.length * ppu}
                    selected={selected.includes(ev.id)}
                    dragging={dragging?.has(ev.id) ?? false}
                    editing={editing === ev.id}
                    onPointerDown={(e) => onBarPointerDown(e, ev)}
                    onResizeStart={(e, edge) => onResizeStart(e, ev, edge)}
                    onEdit={() => setEditing(ev.id)}
                    onEditDone={(title) => {
                      setEditing(null);
                      focusBoard();
                      if (title && title !== ev.title) onPatchEvent(ev.id, { title });
                    }}
                    onContextMenu={(e) => {
                      if (!selected.includes(ev.id)) onSelect([ev.id]);
                      openMenu(e, barMenu(ev));
                    }}
                    onLink={(patch) => onPatchEvent(ev.id, patch)}
                  />
                ))}
            </div>
          </div>
        ))}
        {guide !== null && (
          <div
            className="tl-guide"
            style={{ left: HEADER_W + xOf(guide), height: tracks.length * LANE_H }}
          />
        )}
        {box && (
          <div
            className="tl-box"
            style={{ left: HEADER_W + box.x, top: RULER_H + box.y, width: box.w, height: box.h }}
          />
        )}
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}

function TrackHead({
  track,
  onRename,
  onAdd,
  onMenu,
}: {
  track: TimelineTrack;
  onRename: (name: string) => void;
  onAdd: () => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
  const [name, setName] = useState(track.name);

  return (
    <div className="tl-track-head">
      <span className="color-dot" style={{ background: track.color || "var(--accent)" }} />
      <input
        className="tl-track-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (!trimmed) setName(track.name);
          else if (trimmed !== track.name) onRename(trimmed);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="tl-track-actions">
        <button title="Ereignis am Ende anlegen" onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
        <button title="Strang" onClick={onMenu}>
          <Icon name="ellipsis" size={14} />
        </button>
      </span>
    </div>
  );
}
