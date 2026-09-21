// Zeitstrahl: mehrere Handlungsstränge auf einem gemeinsamen Raster aus Slots.
// Der Slot ist die Zeitangabe der Ansicht — gleicher Slot in zwei Strängen
// heißt „zur selben Zeit", ein ausgelassener Slot ist eine gewollte Lücke:
// dort passiert in diesem Strang nichts, während anderswo etwas geschieht.
// Ein Datum gibt es bewusst nicht, damit auch erfundene Kalender funktionieren;
// das Feld „Wann?" bleibt Freitext. Die Ansicht kippt zwischen Spalten (Zeit
// läuft nach unten) und Zeilen (nach rechts) — dasselbe Raster, transponiert.
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import { PersonLinks } from "./PersonLinks";
import { SceneLinks } from "./SceneLinks";
import {
  PERSON_DRAG_TYPE,
  SCENE_DRAG_TYPE,
  draggedPersonId,
  draggedSceneId,
  leftFor,
} from "./drag";
import {
  ContextMenu,
  openBelow,
  useContextMenu,
  type ContextMenuItem,
} from "./ContextMenu";
import { colorSubmenu } from "./NodeActions";
import {
  COLOR_PRESETS,
  type Timeline,
  type TimelineEvent,
  type TimelineOrientation,
  type TimelineTrack,
} from "../types";
import { Icon } from "./Icon";

// Das gerade gezogene Ereignis — wie im Korkbrett außerhalb von React: der
// Zustand gehört zur Mausgeste, nicht zum Bild.
let draggedEventId: string | null = null;

/** Eigener Datentyp fürs Ziehen von Ereignissen. Wandert eine Karte in einen
 *  anderen Strang, baut React sie neu auf, und ihr dragend kommt nie an —
 *  `draggedEventId` bliebe dann stehen. Am Datentyp erkennt ein Ziel dagegen
 *  sicher, ob gerade wirklich ein Ereignis gezogen wird. */
const EVENT_DRAG_TYPE = "application/x-distelfink-event";

/** Das Ereignis, das gerade über diesem Element hängt, sonst null. */
function draggedEvent(e: DragEvent): string | null {
  return e.dataTransfer.types.includes(EVENT_DRAG_TYPE) ? draggedEventId : null;
}

/** Fehlt der Slot (Dateien aus der Zeit vor dem Raster), zählt der erste. */
function slotOf(ev: TimelineEvent) {
  return ev.slot ?? 0;
}

/** Belegung des Rasters: Strang und Slot zeigen auf höchstens eine Karte. */
function byCell(events: TimelineEvent[]) {
  const cells = new Map<string, TimelineEvent>();
  for (const ev of events) cells.set(`${ev.trackId ?? ""}#${slotOf(ev)}`, ev);
  return cells;
}

export function TimelinePanel() {
  // Der Zeitstrahl gehört zum Projekt: beim Wechsel neu laden, sonst zeigt das
  // Panel die Ereignisse des vorigen Projekts.
  const projectRoot = useStore((s) => s.project?.root);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu();

  useEffect(() => {
    let cancelled = false;
    setTimeline(null);
    void api
      .loadTimeline()
      .then((tl) => !cancelled && setTimeline(tl))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  const tracks = timeline?.tracks ?? [];
  const events = useMemo(() => timeline?.events ?? [], [timeline?.events]);
  const cells = useMemo(() => byCell(events), [events]);
  // Eine Zeile mehr als belegt: hinten bleibt immer Platz zum Anlegen und
  // Ablegen, so wie früher der freie Raum unter den Karten.
  const slots = useMemo(
    () => events.reduce((max, ev) => Math.max(max, slotOf(ev) + 1), 0) + 1,
    [events],
  );

  if (timeline === null) return <div className="timeline" />;

  const orientation: TimelineOrientation =
    timeline.orientation === "rows" ? "rows" : "columns";

  function cellAt(trackId: string, slot: number) {
    return cells.get(`${trackId}#${slot}`);
  }

  async function persist(next: Timeline) {
    setTimeline(next);
    try {
      // Die Antwort trägt die vom Backend vergebenen IDs und Slots.
      setTimeline(await api.saveTimeline(next));
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  /** Ereignisse strangweise und darin nach Slot sortiert schreiben — das
   *  Backend liest die Slots eines Strangs in Array-Reihenfolge. */
  function persistEvents(next: TimelineEvent[], nextTracks = tracks) {
    const order = new Map(nextTracks.map((t, i) => [t.id, i]));
    const sorted = [...next].sort(
      (a, b) =>
        (order.get(a.trackId ?? "") ?? 0) - (order.get(b.trackId ?? "") ?? 0) ||
        slotOf(a) - slotOf(b),
    );
    void persist({ ...timeline!, tracks: nextTracks, events: sorted });
  }

  function addTrack() {
    const track: TimelineTrack = {
      id: "",
      name: `Strang ${tracks.length + 1}`,
      // Reihum durch die Palette, damit neue Stränge sich gleich unterscheiden.
      color: COLOR_PRESETS[tracks.length % COLOR_PRESETS.length],
    };
    void persist({ ...timeline!, tracks: [...tracks, track] });
  }

  function patchTrack(id: string, patch: Partial<TimelineTrack>) {
    void persist({
      ...timeline!,
      tracks: tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  function moveTrack(index: number, dir: -1 | 1) {
    const next = [...tracks];
    const [moved] = next.splice(index, 1);
    next.splice(index + dir, 0, moved);
    persistEvents(events, next);
  }

  async function deleteTrack(track: TimelineTrack) {
    const count = events.filter((e) => e.trackId === track.id).length;
    const yes = await ask(
      count === 0
        ? `Strang "${track.name}" löschen?`
        : `Strang "${track.name}" mit ${count} Ereignis${count === 1 ? "" : "sen"} löschen?`,
      { title: "Löschen", kind: "warning" },
    );
    if (!yes) return;
    persistEvents(
      events.filter((e) => e.trackId !== track.id),
      tracks.filter((t) => t.id !== track.id),
    );
  }

  function addEvent(trackId: string, slot: number) {
    persistEvents([
      ...events,
      {
        id: "",
        title: "Neues Ereignis",
        when: "",
        description: "",
        sceneIds: [],
        trackId,
        slot,
      },
    ]);
  }

  /** Neues Ereignis hinter der letzten Karte des Strangs. */
  function appendEvent(trackId: string) {
    const behind = events
      .filter((e) => e.trackId === trackId)
      .reduce((max, e) => Math.max(max, slotOf(e) + 1), 0);
    addEvent(trackId, behind);
  }

  function patchEvent(id: string, patch: Partial<TimelineEvent>) {
    persistEvents(events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function deleteEvent(id: string) {
    persistEvents(events.filter((e) => e.id !== id));
  }

  /** Kern aller Lücken: alles ab `from` um `by` verrücken — in einem Strang
   *  oder (bei `trackId === null`) über alle Stränge hinweg. */
  function shift(
    list: TimelineEvent[],
    trackId: string | null,
    from: number,
    by: 1 | -1,
  ) {
    return list.map((e) =>
      (trackId === null || e.trackId === trackId) && slotOf(e) >= from
        ? { ...e, slot: slotOf(e) + by }
        : e,
    );
  }

  /** Lücke vor `at`: rückt nur ein Strang weiter, verschiebt er sich sichtbar
   *  gegen die anderen — genau dafür sind Lücken da. Rücken alle gemeinsam,
   *  bleibt die Ausrichtung und es entsteht nur Luft im Raster. */
  function insertGap(trackId: string | null, at: number) {
    persistEvents(shift(events, trackId, at, 1));
  }

  /** Umkehrung: der leere Slot `at` verschwindet, alles danach rückt heran. */
  function removeGap(trackId: string | null, at: number) {
    persistEvents(shift(events, trackId, at + 1, -1));
  }

  /** Pfeiltasten: eine Karte einen Slot weiter. Ist der Nachbarslot frei,
   *  wandert die Karte in die Lücke; ist er belegt, tauschen die beiden — so
   *  bleibt das gewohnte Umsortieren, ohne Lücken zu verschlucken. */
  function moveEvent(ev: TimelineEvent, dir: -1 | 1) {
    const from = slotOf(ev);
    const to = from + dir;
    if (to < 0) return;
    const other = cellAt(ev.trackId ?? "", to);
    persistEvents(
      events.map((e) => {
        if (e.id === ev.id) return { ...e, slot: to };
        if (other && e.id === other.id) return { ...e, slot: from };
        return e;
      }),
    );
  }

  /** Ziehen auf eine Zelle. Ist sie belegt, wird weggeschoben: die dortige
   *  Karte und alle danach im Zielstrang rücken einen Slot weiter. Der alte
   *  Platz bleibt als Lücke stehen — es rutscht nichts hinter dem Rücken des
   *  Schreibenden zusammen. */
  function dropEvent(dragId: string, trackId: string, slot: number) {
    const source = events.find((e) => e.id === dragId);
    if (!source || (source.trackId === trackId && slotOf(source) === slot)) return;
    const pushed = cellAt(trackId, slot) ? shift(events, trackId, slot, 1) : events;
    persistEvents(pushed.map((e) => (e.id === dragId ? { ...e, trackId, slot } : e)));
  }

  /** Beide Lücken an einer Stelle: der eine Strang oder alle zusammen. */
  function gapItems(trackId: string, at: number): ContextMenuItem[] {
    return [
      { label: "In diesem Strang", onSelect: () => insertGap(trackId, at) },
      { label: "Über alle Stränge", onSelect: () => insertGap(null, at) },
    ];
  }

  function eventMenu(ev: TimelineEvent): ContextMenuItem[] {
    const trackId = ev.trackId ?? tracks[0].id;
    const slot = slotOf(ev);
    return [
      {
        kind: "submenu",
        label: "Lücke davor",
        icon: "plus",
        items: gapItems(trackId, slot),
      },
      {
        kind: "submenu",
        label: "Lücke dahinter",
        icon: "plus",
        items: gapItems(trackId, slot + 1),
      },
      { kind: "separator" },
      {
        label: "Ereignis löschen",
        icon: "trash-2",
        danger: true,
        onSelect: () =>
          void ask(`Ereignis "${ev.title}" löschen?`, {
            title: "Löschen",
            kind: "warning",
          }).then((yes) => yes && deleteEvent(ev.id)),
      },
    ];
  }

  function slotMenu(trackId: string, slot: number): ContextMenuItem[] {
    return [
      { label: "Ereignis anlegen", icon: "plus", onSelect: () => addEvent(trackId, slot) },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Lücke einfügen",
        icon: "plus",
        items: gapItems(trackId, slot),
      },
      { label: "Lücke entfernen", icon: "x", onSelect: () => removeGap(trackId, slot) },
      {
        label: "Lücke überall entfernen",
        icon: "x",
        // Nur wenn die ganze Zeile frei ist — sonst verschwände eine Karte,
        // die man beim Aufräumen gar nicht im Blick hat.
        disabled: tracks.some((t) => cellAt(t.id, slot)),
        onSelect: () => removeGap(null, slot),
      },
    ];
  }

  function trackMenu(track: TimelineTrack, index: number): ContextMenuItem[] {
    return [
      colorSubmenu(track.color, (color) => patchTrack(track.id, { color })),
      { kind: "separator" },
      {
        label: orientation === "columns" ? "Nach links" : "Nach oben",
        icon: orientation === "columns" ? "arrow-left" : "arrow-up",
        disabled: index === 0,
        onSelect: () => moveTrack(index, -1),
      },
      {
        label: orientation === "columns" ? "Nach rechts" : "Nach unten",
        icon: orientation === "columns" ? "arrow-right" : "arrow-down",
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
        onSelect: () => void deleteTrack(track),
      },
    ];
  }

  /** Kopf, Schiene und Zellen sitzen im selben Raster; welche Achse die Zeit
   *  ist, entscheidet die Ausrichtung. Der Kopf belegt die erste Stelle der
   *  Zeitachse, die Schiene läuft über den ganzen Rest. */
  function place(trackIndex: number, slot: number | "header" | "rail"): CSSProperties {
    const lane = trackIndex + 1;
    const time = slot === "header" ? 1 : slot === "rail" ? "2 / -1" : slot + 2;
    return orientation === "columns"
      ? { gridColumn: lane, gridRow: time }
      : { gridRow: lane, gridColumn: time };
  }

  return (
    <div className="timeline">
      <div className="timeline-header">
        <h2>Zeitstrahl</h2>
        <div className="timeline-header-actions">
          <span className="timeline-orientation">
            <button
              className={orientation === "columns" ? "active" : ""}
              title="Stränge nebeneinander (Zeit läuft nach unten)"
              onClick={() => void persist({ ...timeline, orientation: "columns" })}
            >
              <Icon name="columns-2" size={14} />
            </button>
            <button
              className={orientation === "rows" ? "active" : ""}
              title="Stränge untereinander (Zeit läuft nach rechts)"
              onClick={() => void persist({ ...timeline, orientation: "rows" })}
            >
              <Icon name="rows-2" size={14} />
            </button>
          </span>
          <button onClick={addTrack}>
            <Icon name="plus" size={14} />
            Strang
          </button>
        </div>
      </div>
      <div
        className={`timeline-board ${orientation}`}
        style={{
          gridTemplateColumns:
            orientation === "columns"
              ? `repeat(${tracks.length}, var(--lane))`
              : `auto repeat(${slots}, var(--lane))`,
          gridTemplateRows:
            orientation === "columns"
              ? `auto repeat(${slots}, auto)`
              : `repeat(${tracks.length}, auto)`,
        }}
      >
        {tracks.map((track, i) => {
          const lane = { "--track": track.color || "var(--accent)" } as CSSProperties;
          return (
            <Fragment key={track.id || i}>
              <TrackHeader
                track={track}
                style={{ ...lane, ...place(i, "header") }}
                onRename={(name) => patchTrack(track.id, { name })}
                onMenu={(e) => openBelow(e, trackMenu(track, i), openAt)}
                onAdd={() => appendEvent(track.id)}
              />
              <div className="timeline-rail" style={{ ...lane, ...place(i, "rail") }} />
              {Array.from({ length: slots }, (_, slot) => {
                const ev = cellAt(track.id, slot);
                const style = { ...lane, ...place(i, slot) };
                const drop = (dragId: string) => dropEvent(dragId, track.id, slot);
                return ev ? (
                  <EventCard
                    key={ev.id || `${track.id}#${slot}`}
                    event={ev}
                    style={style}
                    orientation={orientation}
                    first={slot === 0}
                    onChange={(patch) => patchEvent(ev.id, patch)}
                    onMove={(dir) => moveEvent(ev, dir)}
                    onMenu={(e) => openBelow(e, eventMenu(ev), openAt)}
                    onContextMenu={(e) => openMenu(e, eventMenu(ev))}
                    onDropHere={drop}
                  />
                ) : (
                  <EmptySlot
                    key={`${track.id}#${slot}`}
                    style={style}
                    onAdd={() => addEvent(track.id, slot)}
                    onContextMenu={(e) => openMenu(e, slotMenu(track.id, slot))}
                    onDropHere={drop}
                  />
                );
              })}
            </Fragment>
          );
        })}
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}

function TrackHeader({
  track,
  style,
  onRename,
  onMenu,
  onAdd,
}: {
  track: TimelineTrack;
  style: CSSProperties;
  onRename: (name: string) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onAdd: () => void;
}) {
  const [name, setName] = useState(track.name);

  return (
    <div className="timeline-track-header" style={style}>
      <span className="color-dot" style={{ background: track.color || "var(--accent)" }} />
      <input
        className="track-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== track.name && onRename(name.trim())}
      />
      <span className="timeline-actions">
        <button title="Ereignis anlegen" onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
        <button title="Strang" onClick={onMenu}>
          <Icon name="ellipsis" size={14} />
        </button>
      </span>
    </div>
  );
}

/** Freier Slot: hier ist in diesem Strang gerade nichts los. Zurückhaltend
 *  gezeichnet — zu sehen ist er erst, wenn man ihn braucht. */
function EmptySlot({
  style,
  onAdd,
  onContextMenu,
  onDropHere,
}: {
  style: CSSProperties;
  onAdd: () => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onDropHere: (dragId: string) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`timeline-slot ${over ? "drop-here" : ""}`}
      style={style}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!draggedEvent(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => leftFor(e) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const dragId = draggedEvent(e);
        draggedEventId = null;
        if (dragId) onDropHere(dragId);
      }}
    >
      <button className="timeline-slot-add" title="Ereignis anlegen" onClick={onAdd}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

function EventCard({
  event,
  style,
  orientation,
  first,
  onChange,
  onMove,
  onMenu,
  onContextMenu,
  onDropHere,
}: {
  event: TimelineEvent;
  style: CSSProperties;
  orientation: TimelineOrientation;
  first: boolean;
  onChange: (patch: Partial<TimelineEvent>) => void;
  onMove: (dir: -1 | 1) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onDropHere: (dragId: string) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [when, setWhen] = useState(event.when ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  // Was beim Loslassen passiert: ein Ereignis rückt hierher, oder ein Dokument
  // bzw. eine Person wird verknüpft (dann steht hier, wer).
  const [over, setOver] = useState<"move" | { kind: "scene" | "person"; id: string } | null>(
    null,
  );
  const linked = event.sceneIds ?? [];
  const people = event.characterIds ?? [];
  const isLinked = (o: { kind: "scene" | "person"; id: string }) =>
    (o.kind === "scene" ? linked : people).includes(o.id);
  // Gezogen wird nur am Griff — die Karte ist voller Textfelder, und wer darin
  // etwas markieren will, soll sie nicht versehentlich verschieben.
  const card = useRef<HTMLDivElement>(null);
  // Der Titel ist ein Textfeld, damit lange Überschriften umbrechen statt
  // seitlich aus der Karte zu laufen. Die Höhe folgt dem Inhalt.
  const titleField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = titleField.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [title, orientation]);

  return (
    <div
      className={`timeline-event ${
        over === "move" ? "drop-move" : over && !isLinked(over) ? "drop-link" : ""
      }`}
      style={style}
      onContextMenu={(e) => {
        // Im Textfeld gehört der Rechtsklick der Rechtschreibprüfung.
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        onContextMenu(e);
      }}
      onDragOver={(e) => {
        // Dokumente aus dem Binder und Personen aus der Seitenleiste dürfen
        // überall auf der Karte landen — man zielt auf das Ereignis, nicht auf
        // die Liste an seinem Fuß.
        const scene = draggedSceneId(e);
        const person = draggedPersonId(e);
        const target = scene
          ? ({ kind: "scene", id: scene } as const)
          : person
            ? ({ kind: "person", id: person } as const)
            : null;
        if (target) {
          e.preventDefault();
          // Schon verknüpft: der Zeiger verweigert, der Eintrag in der Liste
          // leuchtet auf — so sieht man, warum.
          e.dataTransfer.dropEffect = isLinked(target) ? "none" : "link";
          setOver(target);
          return;
        }
        const dragged = draggedEvent(e);
        if (!dragged || dragged === event.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver("move");
      }}
      onDragLeave={(e) => leftFor(e) && setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        const sceneId = e.dataTransfer.getData(SCENE_DRAG_TYPE);
        if (sceneId) {
          if (!linked.includes(sceneId)) onChange({ sceneIds: [...linked, sceneId] });
          return;
        }
        const personId = e.dataTransfer.getData(PERSON_DRAG_TYPE);
        if (personId) {
          if (!people.includes(personId)) onChange({ characterIds: [...people, personId] });
          return;
        }
        const dragId = draggedEvent(e);
        draggedEventId = null;
        if (dragId && dragId !== event.id) onDropHere(dragId);
      }}
    >
      <div className="timeline-marker" />
      <div className="timeline-card" ref={card}>
        <div className="timeline-card-header">
          <span
            className="timeline-grip"
            title="Zum Verschieben ziehen"
            draggable
            onDragStart={(e) => {
              draggedEventId = event.id;
              e.dataTransfer.setData(EVENT_DRAG_TYPE, event.id);
              e.dataTransfer.setData("text/plain", event.id);
              e.dataTransfer.effectAllowed = "move";
              // Am Mauszeiger hängt die ganze Karte, nicht der Griff allein.
              if (card.current) e.dataTransfer.setDragImage(card.current, 24, 24);
            }}
            onDragEnd={() => {
              draggedEventId = null;
            }}
          >
            <Icon name="grip-vertical" size={14} />
          </span>
          <input
            className="event-when"
            placeholder="Wann? (z. B. 3. März, Tag 12 …)"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onBlur={() => when !== (event.when ?? "") && onChange({ when })}
          />
          <span className="timeline-actions">
            <button
              disabled={first}
              title={orientation === "columns" ? "Nach oben" : "Nach links"}
              onClick={() => onMove(-1)}
            >
              <Icon name={orientation === "columns" ? "arrow-up" : "arrow-left"} size={14} />
            </button>
            <button
              title={orientation === "columns" ? "Nach unten" : "Nach rechts"}
              onClick={() => onMove(1)}
            >
              <Icon
                name={orientation === "columns" ? "arrow-down" : "arrow-right"}
                size={14}
              />
            </button>
            <button title="Ereignis" onClick={onMenu}>
              <Icon name="ellipsis" size={14} />
            </button>
          </span>
        </div>
        <textarea
          className="event-title"
          ref={titleField}
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Zeilenumbrüche gehören nicht in eine Überschrift: Enter schließt ab.
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            // Ohne Titel geht es nicht: leer zurück auf den alten, sonst getrimmt.
            const trimmed = title.trim();
            if (!trimmed) setTitle(event.title);
            else if (trimmed !== event.title) onChange({ title: trimmed });
          }}
        />
        <textarea
          className="event-description"
          placeholder="Was passiert? …"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            description !== (event.description ?? "") && onChange({ description })
          }
        />
        <PersonLinks
          characterIds={people}
          onChange={(characterIds) => onChange({ characterIds })}
          incoming={over && over !== "move" && over.kind === "person" ? over.id : null}
        />
        <SceneLinks
          sceneIds={linked}
          onChange={(sceneIds) => onChange({ sceneIds })}
          incoming={over && over !== "move" && over.kind === "scene" ? over.id : null}
        />
      </div>
    </div>
  );
}
