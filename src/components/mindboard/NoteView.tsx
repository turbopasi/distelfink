// Eine Notiz auf dem Mindboard: freier Text, Bild oder Verweis auf Person,
// Ort oder Szene. Die Notiz meldet ihre gemessene Größe nach oben — Linien,
// Auswahlrahmen und Export brauchen sie, gespeichert wird sie nicht.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useStore } from "../../store";
import { findNode } from "../../tree";
import type { MindNode } from "../../types";
import { useDocImage } from "../DocImage";
import { Icon } from "../Icon";
import { cachedPlanTagAvatar, loadPlanTagAvatar } from "../planTagInfo";

/** Breite, ab der Text ohne feste Breite umbricht. */
export const TEXT_MAX_WIDTH = 260;
/** Breite neu abgelegter Bilder. */
export const IMAGE_DEFAULT_WIDTH = 240;

export interface NoteHandlers {
  onPointerDown: (e: PointerEvent, node: MindNode) => void;
  onDoubleClick: (e: MouseEvent, node: MindNode) => void;
  onContextMenu: (e: MouseEvent, node: MindNode) => void;
  onResizeStart: (e: PointerEvent, node: MindNode) => void;
  onSize: (id: string, w: number, h: number) => void;
  /** Bearbeiten beendet; `next` = gleich eine verbundene Notiz darunter. */
  onCommitText: (node: MindNode, text: string, next: boolean) => void;
}

export function NoteView({
  node,
  selected,
  editing,
  dropTarget,
  handlers,
}: {
  node: MindNode;
  selected: boolean;
  editing: boolean;
  dropTarget: boolean;
  handlers: NoteHandlers;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { onSize } = handlers;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onSize(node.id, el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id, onSize]);

  const style: CSSProperties = {
    left: node.x,
    top: node.y,
    fontSize: node.fontSize || undefined,
    fontWeight: node.bold ? 600 : undefined,
  };
  if (node.color) (style as Record<string, string>)["--mb-color"] = node.color;
  if (node.kind === "text" && node.w) style.width = node.w;

  const classes = [
    "mb-note",
    `mb-${node.kind}`,
    `mb-border-${node.border || "none"}`,
    node.color ? "mb-colored" : "",
    selected ? "selected" : "",
    editing ? "editing" : "",
    dropTarget ? "drop-target" : "",
  ].join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      style={style}
      data-node-id={node.id}
      onPointerDown={(e) => handlers.onPointerDown(e, node)}
      onDoubleClick={(e) => handlers.onDoubleClick(e, node)}
      onContextMenu={(e) => handlers.onContextMenu(e, node)}
    >
      {node.kind === "text" &&
        (editing ? (
          <NoteEditor node={node} onCommit={handlers.onCommitText} />
        ) : (
          <div className="mb-text-body">{node.text || " "}</div>
        ))}
      {node.kind === "image" && <NoteImage node={node} />}
      {(node.kind === "person" || node.kind === "location") && <NoteEntity node={node} />}
      {node.kind === "scene" && <NoteScene node={node} />}
      {selected && !editing && (node.kind === "image" || node.kind === "text") && (
        <span
          className="mb-resize"
          title="Größe ändern"
          onPointerDown={(e) => handlers.onResizeStart(e, node)}
        />
      )}
    </div>
  );
}

function NoteEditor({
  node,
  onCommit,
}: {
  node: MindNode;
  onCommit: (node: MindNode, text: string, next: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Blur nach Strg+Enter/Esc darf nicht ein zweites Mal speichern.
  const done = useRef(false);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    grow();
  }, []);

  const finish = (next: boolean) => {
    if (done.current) return;
    done.current = true;
    onCommit(node, ref.current?.value ?? "", next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish(true);
    }
  };

  return (
    <textarea
      ref={ref}
      className="mb-editor"
      defaultValue={node.text ?? ""}
      rows={1}
      spellCheck
      onInput={grow}
      onKeyDown={onKeyDown}
      onBlur={() => finish(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

function NoteImage({ node }: { node: MindNode }) {
  const src = useDocImage(node.image);
  const width = node.w || IMAGE_DEFAULT_WIDTH;
  return src ? (
    <img src={src} alt="" draggable={false} style={{ width }} />
  ) : (
    <div className="mb-image-missing muted small" style={{ width }}>
      <Icon name="image" size={16} /> Bild fehlt
    </div>
  );
}

function NoteEntity({ node }: { node: MindNode }) {
  const research = node.kind === "person" ? "characters" : "locations";
  const tagKind = node.kind === "person" ? "person" : "location";
  const entry = useStore((s) => s.planIndex[research].find((e) => e.id === node.refId));
  const [avatar, setAvatar] = useState(() =>
    node.refId ? cachedPlanTagAvatar(tagKind, node.refId) : null,
  );

  useEffect(() => {
    if (!entry?.hasImage || !node.refId) {
      setAvatar(null);
      return;
    }
    let alive = true;
    void loadPlanTagAvatar(tagKind, node.refId, useStore.getState().planIndex).then(
      (img) => alive && setAvatar(img),
    );
    return () => {
      alive = false;
    };
  }, [entry, node.refId, tagKind]);

  return (
    <div className="mb-ref">
      {avatar ? (
        <img className="mb-ref-avatar" src={avatar} alt="" draggable={false} />
      ) : (
        <span className="mb-ref-icon">
          <Icon name={node.kind === "person" ? "user" : "map-pin"} size={16} />
        </span>
      )}
      <span className={entry ? "" : "muted"}>{entry?.name ?? "Gelöscht"}</span>
    </div>
  );
}

function NoteScene({ node }: { node: MindNode }) {
  const title = useStore((s) =>
    node.refId ? findNode(s.project?.meta.binder ?? [], node.refId)?.title : undefined,
  );
  return (
    <div className="mb-ref">
      <span className="mb-ref-icon">
        <Icon name="file-text" size={16} />
      </span>
      <span className={title ? "" : "muted"}>{title ?? "Gelöscht"}</span>
    </div>
  );
}
