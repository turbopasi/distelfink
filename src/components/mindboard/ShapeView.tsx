// Eine Hintergrundform auf dem Mindboard: Fläche mit Titelkopf, an dem sie
// gezogen wird, und einem Griff zum Größeändern, solange sie ausgewählt ist.

import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import type { MindShape } from "../../types";
import { InlineInput } from "./InlineInput";

export interface ShapeHandlers {
  onHeadPointerDown: (e: PointerEvent, shape: MindShape) => void;
  onEdit: (shape: MindShape) => void;
  onContextMenu: (e: MouseEvent, shape: MindShape) => void;
  onResizeStart: (e: PointerEvent, shape: MindShape) => void;
  onCommitTitle: (shape: MindShape, title: string) => void;
}

export function ShapeView({
  shape,
  selected,
  editing,
  handlers,
}: {
  shape: MindShape;
  selected: boolean;
  editing: boolean;
  handlers: ShapeHandlers;
}) {
  return (
    <div
      className={`mb-shape ${shape.color ? "mb-colored" : ""} ${selected ? "selected" : ""}`}
      style={
        {
          left: shape.x,
          top: shape.y,
          width: shape.w,
          height: shape.h,
          ...(shape.color ? { "--mb-color": shape.color } : {}),
        } as CSSProperties
      }
    >
      <div
        className="mb-shape-head"
        onPointerDown={(e) => handlers.onHeadPointerDown(e, shape)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handlers.onEdit(shape);
        }}
        onContextMenu={(e) => handlers.onContextMenu(e, shape)}
      >
        {editing ? (
          <InlineInput
            className="mb-shape-title-input"
            initial={shape.title ?? ""}
            placeholder="Titel"
            onDone={(title) => handlers.onCommitTitle(shape, title)}
          />
        ) : (
          <span className="mb-shape-title">{shape.title || " "}</span>
        )}
      </div>
      {selected && (
        <span
          className="mb-resize"
          title="Größe ändern"
          onPointerDown={(e) => handlers.onResizeStart(e, shape)}
        />
      )}
    </div>
  );
}
