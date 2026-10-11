// Ein Ereignis als Balken auf seiner Bahn: Titel und darunter die Synopsis.
// Anfassen verschiebt, die schmalen Ränder ändern die Länge, Doppelklick
// benennt um. Dokumente, Personen und Orte lassen sich auf den Balken ziehen
// und werden damit verknüpft.
import {
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import type { TimelineEvent } from "../../types";
import {
  LOCATION_DRAG_TYPE,
  PERSON_DRAG_TYPE,
  SCENE_DRAG_TYPE,
  draggedLocationId,
  draggedPersonId,
  draggedSceneId,
  leftFor,
} from "../drag";
import { InlineInput } from "../mindboard/InlineInput";

type LinkField = "sceneIds" | "characterIds" | "locationIds";

/** Was gerade über dem Balken hängt: die Liste, in die es käme, und ob es
 *  dort schon steht. */
type Incoming = { field: LinkField; known: boolean };

export function EventBar({
  event,
  left,
  width,
  selected,
  dragging,
  editing,
  onPointerDown,
  onResizeStart,
  onEdit,
  onEditDone,
  onContextMenu,
  onLink,
}: {
  event: TimelineEvent;
  left: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  editing: boolean;
  onPointerDown: (e: PointerEvent) => void;
  onResizeStart: (e: PointerEvent, edge: "left" | "right") => void;
  onEdit: () => void;
  onEditDone: (title: string) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onLink: (patch: Partial<TimelineEvent>) => void;
}) {
  const [over, setOver] = useState<Incoming | null>(null);

  /** Welche Verknüpfung das Gezogene ergäbe — oder null, wenn es keine ist. */
  function incoming(e: DragEvent): { field: LinkField; id: string } | null {
    const scene = draggedSceneId(e);
    if (scene) return { field: "sceneIds", id: scene };
    const person = draggedPersonId(e);
    if (person) return { field: "characterIds", id: person };
    const location = draggedLocationId(e);
    if (location) return { field: "locationIds", id: location };
    return null;
  }

  const classes = [
    "tl-bar",
    selected && "selected",
    dragging && "dragging",
    over && !over.known && "drop-link",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{ left, width }}
      title={event.when ? `${event.title} — ${event.when}` : event.title}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        onContextMenu(e);
      }}
      onDragOver={(e) => {
        const link = incoming(e);
        if (!link) return;
        e.preventDefault();
        const known = (event[link.field] ?? []).includes(link.id);
        // Schon verknüpft: der Zeiger verweigert, sonst bietet er an.
        e.dataTransfer.dropEffect = known ? "none" : "link";
        setOver({ field: link.field, known });
      }}
      onDragLeave={(e) => leftFor(e) && setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        const fields: [LinkField, string][] = [
          ["sceneIds", SCENE_DRAG_TYPE],
          ["characterIds", PERSON_DRAG_TYPE],
          ["locationIds", LOCATION_DRAG_TYPE],
        ];
        for (const [field, type] of fields) {
          const id = e.dataTransfer.getData(type);
          if (!id) continue;
          const list = event[field] ?? [];
          if (!list.includes(id)) onLink({ [field]: [...list, id] });
          return;
        }
      }}
    >
      <div className="tl-bar-content">
        {editing ? (
          <InlineInput
            initial={event.title}
            placeholder="Titel"
            className="tl-bar-title-input"
            onDone={onEditDone}
          />
        ) : (
          <div className="tl-bar-title">{event.title}</div>
        )}
        {event.description && <div className="tl-bar-synopsis">{event.description}</div>}
      </div>
      <div className="tl-bar-edge left" onPointerDown={(e) => onResizeStart(e, "left")} />
      <div className="tl-bar-edge right" onPointerDown={(e) => onResizeStart(e, "right")} />
    </div>
  );
}
