// Zeitstrahl: Handlungsstränge als Bahnen untereinander, die Zeit läuft nach
// rechts. Jedes Ereignis ist ein Balken mit Anfang und Länge auf einer
// gemeinsamen, abstrakten Achse — gleicher Anfang in zwei Strängen heißt „zur
// selben Zeit". Ein Datum gibt es bewusst nicht, damit auch erfundene
// Kalender funktionieren; das Feld „Wann?" bleibt Freitext.
//
// Das Panel lädt und speichert und hält die Auswahl; was auf der Fläche
// passiert, regelt TimelineBoard, die Details eines Ereignisses der Inspector.
import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../../api";
import { newId } from "../../ids";
import { useStore } from "../../store";
import { COLOR_PRESETS, type Timeline, type TimelineEvent, type TimelineTrack } from "../../types";
import { ConflictBanner } from "../ConflictBanner";
import { Icon } from "../Icon";
import { useAutosave } from "../useAutosave";
import { EventInspector } from "./EventInspector";
import { TimelineBoard } from "./TimelineBoard";
import "./timeline.css";

/** Pixel je Rastereinheit: Start, Grenzen und Schritt der Zoomknöpfe. */
const ZOOM_DEFAULT = 40;
const ZOOM_MIN = 6;
const ZOOM_MAX = 160;
const ZOOM_STEP = 1.25;

function clampZoom(ppu: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ppu));
}

export function TimelinePanel() {
  // Der Zeitstrahl gehört zum Projekt: beim Wechsel neu laden, sonst zeigt das
  // Panel die Ereignisse des vorigen Projekts.
  const projectRoot = useStore((s) => s.project?.root);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ppu, setPpu] = useState(ZOOM_DEFAULT);

  /** Zeigt einen Stand an und merkt ihn fürs Speichern vor. */
  const show = (tl: Timeline | null) => {
    timelineRef.current = tl;
    setTimeline(tl);
  };

  const { status, saver } = useAutosave({
    what: "Der Zeitstrahl",
    // Jede Änderung ist eine abgeschlossene Aktion, kein Tippen: gleich
    // speichern — aber nie zwei Vorgänge gleichzeitig.
    delayMs: 0,
    snapshot: () => timelineRef.current!,
    write: async (tl: Timeline, force) => {
      const result = await api.saveTimeline(tl, force);
      // Die Antwort trägt den vom Backend bereinigten Stand — nur
      // übernehmen, wenn seitdem nichts weiter geändert wurde.
      if (result.status === "ok" && timelineRef.current === tl) show(result.data);
      return result.status;
    },
    reload: async () => {
      const fresh = await api.loadTimeline();
      // Inzwischen weiter bearbeitet: das Banner entscheidet.
      if (saver.state !== "saved") {
        saver.raiseConflict();
        return;
      }
      show(fresh);
      saver.reset();
    },
  });

  useEffect(() => {
    let cancelled = false;
    show(null);
    setSelected([]);
    void api
      .loadTimeline()
      .then((tl) => !cancelled && show(tl))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  if (timeline === null) return <div className="timeline" />;

  const { tracks, events } = timeline;
  // Der Inspector zeigt genau ein Ereignis; bei mehreren gilt die Auswahl
  // nur dem gemeinsamen Verschieben.
  const inspected =
    selected.length === 1 ? events.find((e) => e.id === selected[0]) : undefined;

  function persist(next: Timeline) {
    show(next);
    saver.markDirty();
  }

  async function loadExternal() {
    try {
      show(await api.loadTimeline());
      saver.reset();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  const setEvents = (next: TimelineEvent[]) => persist({ ...timeline, events: next });

  const setTracks = (next: TimelineTrack[], nextEvents = events) =>
    persist({ ...timeline, tracks: next, events: nextEvents });

  function addTrack() {
    setTracks([
      ...tracks,
      {
        id: newId("strang"),
        name: `Strang ${tracks.length + 1}`,
        // Reihum durch die Palette, damit neue Stränge sich gleich unterscheiden.
        color: COLOR_PRESETS[tracks.length % COLOR_PRESETS.length],
      },
    ]);
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
    setTracks(
      tracks.filter((t) => t.id !== track.id),
      events.filter((e) => e.trackId !== track.id),
    );
  }

  function addEvent(trackId: string, start: number, length: number) {
    const id = newId("ereignis");
    setEvents([
      ...events,
      { id, title: "Neues Ereignis", when: "", description: "", trackId, start, length },
    ]);
    setSelected([id]);
  }

  function patchEvent(id: string, patch: Partial<TimelineEvent>) {
    setEvents(events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function deleteEvents(ids: string[]) {
    const doomed = events.filter((e) => ids.includes(e.id));
    if (!doomed.length) return;
    const yes = await ask(
      doomed.length === 1
        ? `Ereignis "${doomed[0].title}" löschen?`
        : `${doomed.length} Ereignisse löschen?`,
      { title: "Löschen", kind: "warning" },
    );
    if (!yes) return;
    setEvents(events.filter((e) => !ids.includes(e.id)));
    setSelected((sel) => sel.filter((id) => !ids.includes(id)));
  }

  return (
    <div className="timeline">
      {status === "conflict" && (
        <ConflictBanner
          what="Der Zeitstrahl"
          onReload={() => void loadExternal()}
          onOverwrite={() => void saver.overwrite()}
        />
      )}
      <div className="timeline-header">
        <h2>Zeitstrahl</h2>
        <div className="timeline-header-actions">
          <button
            title="Verkleinern"
            disabled={ppu <= ZOOM_MIN}
            onClick={() => setPpu(clampZoom(ppu / ZOOM_STEP))}
          >
            <Icon name="minus" size={14} />
          </button>
          <button
            title="Vergrößern"
            disabled={ppu >= ZOOM_MAX}
            onClick={() => setPpu(clampZoom(ppu * ZOOM_STEP))}
          >
            <Icon name="plus" size={14} />
          </button>
          <span className="timeline-sep" />
          <button onClick={addTrack}>
            <Icon name="plus" size={14} />
            Strang
          </button>
        </div>
      </div>
      <div className="timeline-body">
        <TimelineBoard
          tracks={tracks}
          events={events}
          selected={selected}
          ppu={ppu}
          onZoom={(factor) => setPpu((p) => clampZoom(p * factor))}
          onSelect={setSelected}
          onEvents={setEvents}
          onTracks={setTracks}
          onPatchEvent={patchEvent}
          onAddEvent={addEvent}
          onDeleteEvents={(ids) => void deleteEvents(ids)}
          onDeleteTrack={(t) => void deleteTrack(t)}
        />
        {inspected && (
          <EventInspector
            key={inspected.id}
            event={inspected}
            track={tracks.find((t) => t.id === inspected.trackId)}
            onChange={(patch) => patchEvent(inspected.id, patch)}
            onDelete={() => void deleteEvents([inspected.id])}
            onClose={() => setSelected([])}
          />
        )}
      </div>
    </div>
  );
}
