// Die Verbindungen auf dem Mindboard: Linien (samt Pfeilspitzen) in einem
// SVG und ihre Beschriftungen als HTML darüber. Jede Linie hat eine breite,
// unsichtbare Zwillingslinie, damit sie sich auch dünn gut treffen lässt.

import type { MouseEvent, PointerEvent } from "react";
import type { MindEdge } from "../../types";
import type { Point } from "./geometry";
import { InlineInput } from "./InlineInput";

export interface EdgeGeometry {
  edge: MindEdge;
  line: { a: Point; b: Point };
}

export interface EdgeHandlers {
  onSelect: (edge: MindEdge) => void;
  onEdit: (edge: MindEdge) => void;
  onContextMenu: (e: MouseEvent, edge: MindEdge) => void;
  onCommitLabel: (edge: MindEdge, label: string) => void;
}

export function EdgeLayer({
  edges,
  markerId,
  selected,
  editing,
  handlers,
}: {
  edges: EdgeGeometry[];
  /** Eindeutiger Präfix für die Pfeil-Marker (mehrere Boards gleichzeitig). */
  markerId: string;
  selected: string | null;
  editing: string | null;
  handlers: EdgeHandlers;
}) {
  const select = (e: PointerEvent, edge: MindEdge) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    handlers.onSelect(edge);
  };
  const edit = (e: MouseEvent, edge: MindEdge) => {
    e.stopPropagation();
    handlers.onEdit(edge);
  };

  return (
    <>
      <svg className="mb-edges" width="1" height="1">
        <defs>
          {["", "-sel"].map((suffix) => (
            <marker
              key={suffix}
              id={`${markerId}-arrow${suffix}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 z" className={`mb-arrow${suffix}`} />
            </marker>
          ))}
        </defs>
        {edges.map(({ edge, line }) => {
          const sel = selected === edge.id;
          const marker = `url(#${markerId}-arrow${sel ? "-sel" : ""})`;
          const arrow = edge.arrow || "none";
          return (
            <g key={edge.id} className={`mb-edge ${sel ? "selected" : ""}`}>
              <line
                x1={line.a.x}
                y1={line.a.y}
                x2={line.b.x}
                y2={line.b.y}
                markerEnd={arrow !== "none" ? marker : undefined}
                markerStart={arrow === "both" ? marker : undefined}
              />
              <line
                className="mb-edge-hit"
                x1={line.a.x}
                y1={line.a.y}
                x2={line.b.x}
                y2={line.b.y}
                onPointerDown={(e) => select(e, edge)}
                onDoubleClick={(e) => edit(e, edge)}
                onContextMenu={(e) => handlers.onContextMenu(e, edge)}
              />
            </g>
          );
        })}
      </svg>
      {edges.map(({ edge, line }) => {
        const isEditing = editing === edge.id;
        if (!edge.label && !isEditing) return null;
        const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
        return isEditing ? (
          <InlineInput
            key={edge.id}
            className="mb-label-editor"
            style={{ left: mid.x, top: mid.y }}
            initial={edge.label ?? ""}
            placeholder="Beschriftung"
            onDone={(label) => handlers.onCommitLabel(edge, label)}
          />
        ) : (
          <span
            key={edge.id}
            className={`mb-label ${selected === edge.id ? "selected" : ""}`}
            style={{ left: mid.x, top: mid.y }}
            onPointerDown={(e) => select(e, edge)}
            onDoubleClick={(e) => edit(e, edge)}
            onContextMenu={(e) => handlers.onContextMenu(e, edge)}
          >
            {edge.label}
          </span>
        );
      })}
    </>
  );
}
