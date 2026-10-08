// Die Fläche des Mindboards: Ansicht (Verschieben/Zoomen), Auswahl, Ziehen,
// Verbinden durch Ablegen, Bilder und Verweise von außen, Tastatur und
// Zwischenablage. Die Welt ist ein einziges Element mit CSS-Transform —
// Notizen liegen in Weltkoordinaten darin, die Ansicht verschiebt nur sie.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { api } from "../../api";
import { useStore, type PaneId } from "../../store";
import type {
  MindArrow,
  MindBorder,
  MindEdge,
  MindNode,
  MindShape,
  MindView,
  Mindboard,
} from "../../types";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../ContextMenu";
import { saveClipboardImage } from "../DocImage";
import { Icon } from "../Icon";
import { colorSubmenu } from "../NodeActions";
import { draggedLocationId, draggedPersonId, draggedSceneId } from "../drag";
import { exportBoardPng } from "./exportPng";
import {
  align,
  bounds,
  center,
  contains,
  edgeLine,
  intersects,
  rectFromPoints,
  type AlignMode,
  type Point,
  type Rect,
} from "./geometry";
import {
  cloneNodes,
  newId,
  patchNodes,
  removeItems,
  toggleConnections,
} from "./model";
import type { UpdateOptions } from "./MindboardPanel";
import { IMAGE_DEFAULT_WIDTH, NoteView, type NoteHandlers } from "./NoteView";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Ab so vielen Pixeln wird aus einem Klick ein Ziehen. */
const DRAG_THRESHOLD = 3;
/** Größe einer Notiz, bevor sie gemessen wurde. */
const FALLBACK_SIZE = { w: 120, h: 32 };

type Size = { w: number; h: number };

type Drag =
  | {
      kind: "move";
      startW: Point;
      nodeOrigin: Map<string, Point>;
      shapeOrigin: Map<string, Point>;
      base: Mindboard;
      moved: boolean;
      /** Notiz unter dem Zeiger, auf der das Ablegen verbindet. */
      target: string | null;
    }
  | { kind: "box"; startW: Point; additive: boolean; baseNodes: string[]; baseShapes: string[] }
  | { kind: "pan"; startS: Point; startView: MindView }
  | { kind: "resize-node"; id: string; startW: Point; startWidth: number; base: Mindboard }
  | { kind: "resize-shape"; id: string; startW: Point; start: Size; base: Mindboard };

/** Kopierte Notizen; der Text daneben liegt auch in der System-Zwischenablage
 *  und verrät beim Einfügen, ob sie noch von hier stammt. */
let clipboard: { text: string; nodes: MindNode[]; edges: MindEdge[] } | null = null;

const FONT_SIZES: { label: string; value: number }[] = [
  { label: "Klein", value: 12 },
  { label: "Normal", value: 0 },
  { label: "Groß", value: 18 },
  { label: "Sehr groß", value: 24 },
];

const BORDERS: { label: string; value: MindBorder }[] = [
  { label: "Kein Rahmen", value: "none" },
  { label: "Linie", value: "line" },
  { label: "Abgerundet", value: "rounded" },
  { label: "Wolke", value: "cloud" },
];

const ARROWS: { label: string; value: MindArrow }[] = [
  { label: "Keine Pfeile", value: "none" },
  { label: "Pfeil zum Ziel", value: "end" },
  { label: "Pfeile in beide Richtungen", value: "both" },
];

const ALIGNS: { label: string; value: AlignMode }[] = [
  { label: "Links", value: "left" },
  { label: "Mittig (horizontal)", value: "center" },
  { label: "Rechts", value: "right" },
  { label: "Oben", value: "top" },
  { label: "Mittig (vertikal)", value: "middle" },
  { label: "Unten", value: "bottom" },
  { label: "Untereinander stapeln", value: "stack" },
  { label: "Horizontal verteilen", value: "distribute-h" },
  { label: "Vertikal verteilen", value: "distribute-v" },
];

/** Dateiendung eines Bilds — aus dem Namen, sonst aus dem MIME-Typ. */
function imageExt(file: File): string | null {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  const ext =
    fromName && fromName !== file.name.toLowerCase()
      ? fromName
      : (file.type.split("/")[1] ?? "");
  const norm = ext.replace("jpeg", "jpg");
  return ["png", "jpg", "gif", "webp"].includes(norm) ? norm : null;
}

async function naturalWidth(file: File): Promise<number> {
  try {
    const bmp = await createImageBitmap(file);
    const w = bmp.width;
    bmp.close();
    return w;
  } catch {
    return IMAGE_DEFAULT_WIDTH;
  }
}

export function BoardCanvas({
  board,
  name,
  paneId,
  update,
  getBoard,
  initialView,
  onViewChange,
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  board: Mindboard;
  name: string;
  paneId: PaneId;
  update: (next: Mindboard, opts?: UpdateOptions) => void;
  getBoard: () => Mindboard;
  initialView: MindView | null;
  onViewChange: (view: MindView) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<MindView>(initialView ?? { x: 40, y: 40, zoom: 1 });
  const viewRef = useRef(view);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  const [selNodes, setSelNodes] = useState<string[]>([]);
  const [selShapes, setSelShapes] = useState<string[]>([]);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [externalOver, setExternalOver] = useState(false);

  const drag = useRef<Drag | null>(null);
  /** Neu angelegte Notiz, die noch nie Text hatte: ihr Anlegen und ihr erster
   *  Text sind ein einziger Schritt im Verlauf; bleibt sie leer, verschwindet
   *  sie spurlos. */
  const fresh = useRef<{ id: string; base: Mindboard } | null>(null);
  const lastPointer = useRef<Point | null>(null);
  const markerId = useId().replace(/:/g, "");
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);
  const openSceneNextTo = useStore((s) => s.openSceneNextTo);

  const setView = useCallback(
    (next: MindView) => {
      viewRef.current = next;
      setViewState(next);
      onViewChange(next);
    },
    [onViewChange],
  );

  // ---------------------------------------------------------------- Geometrie

  const nodeRect = useCallback((n: MindNode): Rect => {
    const s = sizesRef.current[n.id] ?? FALLBACK_SIZE;
    return { x: n.x, y: n.y, w: s.w, h: s.h };
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = viewportRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  const viewCenter = useCallback((): Point => {
    const r = viewportRef.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [toWorld]);

  /** Wo Eingefügtes landet: an der Maus, wenn sie über dem Board ist. */
  const insertPoint = useCallback(
    () => lastPointer.current ?? viewCenter(),
    [viewCenter],
  );

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const sx = (clientX ?? r.left + r.width / 2) - r.left;
      const sy = (clientY ?? r.top + r.height / 2) - r.top;
      const v = viewRef.current;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const wx = (sx - v.x) / v.zoom;
      const wy = (sy - v.y) / v.zoom;
      setView({ zoom, x: sx - wx * zoom, y: sy - wy * zoom });
    },
    [setView],
  );

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const b = getBoard();
    const all = bounds([...b.nodes.map(nodeRect), ...b.shapes]);
    if (!all) {
      setView({ x: 40, y: 40, zoom: 1 });
      return;
    }
    const pad = 40;
    const zoom = Math.min(
      1,
      Math.max(
        MIN_ZOOM,
        Math.min(el.clientWidth / (all.w + pad * 2), el.clientHeight / (all.h + pad * 2)),
      ),
    );
    setView({
      zoom,
      x: el.clientWidth / 2 - (all.x + all.w / 2) * zoom,
      y: el.clientHeight / 2 - (all.y + all.h / 2) * zoom,
    });
  }, [getBoard, nodeRect, setView]);

  // Mausrad: ohne Taste verschieben, mit Strg zoomen. Muss nicht-passiv sein,
  // sonst zoomt WebView2 bei Strg+Rad die ganze Seite.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".mb-editor")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      } else {
        const v = viewRef.current;
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setView]);

  // Ein Board ohne gespeicherte Ansicht öffnet eingepasst.
  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (didFit.current || initialView) return;
    didFit.current = true;
    if (board.nodes.length || board.shapes.length) requestAnimationFrame(fit);
  }, [board, fit, initialView]);

  const onSize = useCallback((id: string, w: number, h: number) => {
    setSizes((s) => (s[id]?.w === w && s[id]?.h === h ? s : { ...s, [id]: { w, h } }));
  }, []);

  // ---------------------------------------------------------------- Auswahl

  const select = useCallback((nodes: string[], shapes: string[] = []) => {
    setSelNodes(nodes);
    setSelShapes(shapes);
    setSelEdge(null);
  }, []);

  const clearSelection = useCallback(() => select([], []), [select]);

  const focusBoard = () => viewportRef.current?.focus({ preventScroll: true });

  // ---------------------------------------------------------------- Notizen

  const createNote = useCallback(
    (at: Point, extra: Partial<MindNode> = {}, link?: string) => {
      const base = getBoard();
      const node: MindNode = { id: newId("n"), kind: "text", x: at.x, y: at.y, text: "", ...extra };
      let next: Mindboard = { ...base, nodes: [...base.nodes, node] };
      if (link) {
        next = { ...next, edges: [...next.edges, { id: newId("e"), from: link, to: node.id }] };
      }
      fresh.current = { id: node.id, base };
      update(next, { history: false });
      select([node.id]);
      setEditingId(node.id);
    },
    [getBoard, update, select],
  );

  const commitText = useCallback(
    (node: MindNode, text: string, next: boolean) => {
      setEditingId(null);
      const current = getBoard();
      const isFresh = fresh.current?.id === node.id;
      const base = isFresh ? fresh.current!.base : current;
      fresh.current = null;
      if (!text.trim()) {
        // Leer = weg. Eine frische Notiz verschwindet ohne Spur im Verlauf.
        const without = removeItems(current, [node.id], []);
        if (isFresh) update(without, { history: false });
        else update(without);
        setSelNodes((s) => s.filter((id) => id !== node.id));
        if (!next) focusBoard();
        return;
      }
      const changed = current.nodes.find((n) => n.id === node.id)?.text !== text;
      if (isFresh || changed) {
        update(changed ? patchNodes(current, [node.id], { text }) : current, { base });
      }
      if (next) {
        // Strg+Enter: gleich die nächste Notiz darunter, schon verbunden.
        const size = sizesRef.current[node.id] ?? FALLBACK_SIZE;
        createNote({ x: node.x, y: node.y + size.h + 40 }, {}, node.id);
      } else {
        focusBoard();
      }
    },
    [getBoard, update, createNote],
  );

  const openRef = useCallback(
    (node: MindNode) => {
      if (!node.refId) return;
      if (node.kind === "person") void openResearchNextTo(paneId, "characters", node.refId);
      else if (node.kind === "location") void openResearchNextTo(paneId, "locations", node.refId);
      else if (node.kind === "scene") void openSceneNextTo(paneId, node.refId);
    },
    [openResearchNextTo, openSceneNextTo, paneId],
  );

  // ---------------------------------------------------------------- Ziehen

  const beginMove = (e: PointerEvent, nodeIds: string[], shapeIds: string[]) => {
    const b = getBoard();
    const nodeOrigin = new Map<string, Point>();
    const shapeOrigin = new Map<string, Point>();
    for (const n of b.nodes) if (nodeIds.includes(n.id)) nodeOrigin.set(n.id, { x: n.x, y: n.y });
    for (const s of b.shapes) {
      if (!shapeIds.includes(s.id)) continue;
      shapeOrigin.set(s.id, { x: s.x, y: s.y });
      // Magnetische Formen nehmen mit, was in ihnen liegt.
      if (s.magnetic) {
        for (const n of b.nodes) {
          if (contains(s, center(nodeRect(n)))) nodeOrigin.set(n.id, { x: n.x, y: n.y });
        }
      }
    }
    drag.current = {
      kind: "move",
      startW: toWorld(e.clientX, e.clientY),
      nodeOrigin,
      shapeOrigin,
      base: b,
      moved: false,
      target: null,
    };
    // Eingefangen wird erst, wenn wirklich gezogen wird — sonst landete ein
    // Doppelklick auf der Notiz bei der Fläche statt bei ihr.
  };

  const noteHandlers: NoteHandlers = {
    onPointerDown: (e, node) => {
      if (e.button === 1 || spaceDown) return; // Verschieben der Ansicht übernimmt die Fläche
      e.stopPropagation();
      if (e.button !== 0) return;
      focusBoard();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let nodes = selNodes;
      let shapes = selShapes;
      if (additive) {
        nodes = nodes.includes(node.id) ? nodes.filter((id) => id !== node.id) : [...nodes, node.id];
        select(nodes, shapes);
        if (!nodes.includes(node.id)) return;
      } else if (!nodes.includes(node.id)) {
        nodes = [node.id];
        shapes = [];
        select(nodes, shapes);
      }
      beginMove(e, nodes, shapes);
    },
    onDoubleClick: (e, node) => {
      e.stopPropagation();
      if (node.kind === "text") {
        select([node.id]);
        setEditingId(node.id);
      } else {
        openRef(node);
      }
    },
    onContextMenu: (e, node) => {
      const nodes = selNodes.includes(node.id) ? selNodes : [node.id];
      if (!selNodes.includes(node.id)) select(nodes);
      openMenu(e, nodeMenu(nodes, node));
    },
    onResizeStart: (e, node) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      drag.current = {
        kind: "resize-node",
        id: node.id,
        startW: toWorld(e.clientX, e.clientY),
        startWidth: sizesRef.current[node.id]?.w ?? node.w ?? IMAGE_DEFAULT_WIDTH,
        base: getBoard(),
      };
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    onSize,
    onCommitText: commitText,
  };

  const onShapePointerDown = (e: PointerEvent, shape: MindShape) => {
    if (e.button === 1 || spaceDown) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    focusBoard();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let shapes = selShapes;
    let nodes = selNodes;
    if (additive) {
      shapes = shapes.includes(shape.id)
        ? shapes.filter((id) => id !== shape.id)
        : [...shapes, shape.id];
      select(nodes, shapes);
      if (!shapes.includes(shape.id)) return;
    } else if (!shapes.includes(shape.id)) {
      shapes = [shape.id];
      nodes = [];
      select(nodes, shapes);
    }
    beginMove(e, nodes, shapes);
  };

  const onShapeResizeStart = (e: PointerEvent, shape: MindShape) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    drag.current = {
      kind: "resize-shape",
      id: shape.id,
      startW: toWorld(e.clientX, e.clientY),
      start: { w: shape.w, h: shape.h },
      base: getBoard(),
    };
    viewportRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".mb-toolbar, .mb-label-editor")) return;
    focusBoard();
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      drag.current = {
        kind: "pan",
        startS: { x: e.clientX, y: e.clientY },
        startView: viewRef.current,
      };
      viewportRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) clearSelection();
    drag.current = {
      kind: "box",
      startW: toWorld(e.clientX, e.clientY),
      additive,
      baseNodes: additive ? selNodes : [],
      baseShapes: additive ? selShapes : [],
    };
    viewportRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    lastPointer.current = w;
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView({
        ...d.startView,
        x: d.startView.x + e.clientX - d.startS.x,
        y: d.startView.y + e.clientY - d.startS.y,
      });
      return;
    }
    if (d.kind === "box") {
      const rect = rectFromPoints(d.startW, w);
      setBox(rect);
      const b = getBoard();
      const hitNodes = b.nodes.filter((n) => intersects(rect, nodeRect(n))).map((n) => n.id);
      const hitShapes = b.shapes
        .filter(
          (s) =>
            rect.x <= s.x && rect.y <= s.y && rect.x + rect.w >= s.x + s.w && rect.y + rect.h >= s.y + s.h,
        )
        .map((s) => s.id);
      setSelNodes([...new Set([...d.baseNodes, ...hitNodes])]);
      setSelShapes([...new Set([...d.baseShapes, ...hitShapes])]);
      return;
    }
    if (d.kind === "resize-node") {
      const width = Math.max(40, Math.round(d.startWidth + (w.x - d.startW.x)));
      update(patchNodes(d.base, [d.id], { w: width }), { history: false });
      return;
    }
    if (d.kind === "resize-shape") {
      update(
        {
          ...d.base,
          shapes: d.base.shapes.map((s) =>
            s.id === d.id
              ? {
                  ...s,
                  w: Math.max(40, Math.round(d.start.w + w.x - d.startW.x)),
                  h: Math.max(40, Math.round(d.start.h + w.y - d.startW.y)),
                }
              : s,
          ),
        },
        { history: false },
      );
      return;
    }
    // Verschieben
    const dx = w.x - d.startW.x;
    const dy = w.y - d.startW.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * viewRef.current.zoom < DRAG_THRESHOLD) return;
      d.moved = true;
      viewportRef.current?.setPointerCapture(e.pointerId);
    }
    update(
      {
        ...d.base,
        nodes: d.base.nodes.map((n) => {
          const o = d.nodeOrigin.get(n.id);
          return o ? { ...n, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : n;
        }),
        shapes: d.base.shapes.map((s) => {
          const o = d.shapeOrigin.get(s.id);
          return o ? { ...s, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : s;
        }),
      },
      { history: false },
    );
    // Ziel zum Verbinden: die oberste fremde Notiz unter dem Zeiger.
    let target: string | null = null;
    if (d.nodeOrigin.size && !d.shapeOrigin.size) {
      const b = d.base;
      for (let i = b.nodes.length - 1; i >= 0; i--) {
        const n = b.nodes[i];
        if (d.nodeOrigin.has(n.id)) continue;
        if (contains(nodeRect(n), w)) {
          target = n.id;
          break;
        }
      }
    }
    d.target = target;
    setDropTarget(target);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (viewportRef.current?.hasPointerCapture(e.pointerId)) {
      viewportRef.current.releasePointerCapture(e.pointerId);
    }
    if (!d) return;
    if (d.kind === "box") {
      setBox(null);
      return;
    }
    if (d.kind === "resize-node" || d.kind === "resize-shape") {
      update(getBoard(), { base: d.base });
      return;
    }
    if (d.kind !== "move" || !d.moved) return;
    const target = d.target;
    setDropTarget(null);
    if (target) {
      // Abgelegt auf einer Notiz: verbinden (oder trennen), die gezogenen
      // Notizen springen an ihren Platz zurück.
      const arrow: MindArrow = e.shiftKey ? "end" : "none";
      update(toggleConnections(d.base, [...d.nodeOrigin.keys()], target, arrow), {
        base: d.base,
      });
      return;
    }
    update(getBoard(), { base: d.base });
  };

  // ---------------------------------------------------------------- Aktionen

  const deleteSelection = useCallback(() => {
    if (!selNodes.length && !selShapes.length && !selEdge) return;
    update(removeItems(getBoard(), selNodes, selShapes, selEdge));
    clearSelection();
  }, [selNodes, selShapes, selEdge, getBoard, update, clearSelection]);

  const applyAlign = useCallback(
    (ids: string[], mode: AlignMode) => {
      const b = getBoard();
      const nodes = b.nodes.filter((n) => ids.includes(n.id));
      const points = align(nodes.map(nodeRect), mode);
      const byId = new Map(nodes.map((n, i) => [n.id, points[i]]));
      update(
        patchNodes(b, ids, (n) => {
          const p = byId.get(n.id)!;
          return { x: Math.round(p.x), y: Math.round(p.y) };
        }),
      );
    },
    [getBoard, nodeRect, update],
  );

  const addShape = useCallback(
    (around?: string[]) => {
      const b = getBoard();
      const box =
        around?.length && bounds(b.nodes.filter((n) => around.includes(n.id)).map(nodeRect));
      const pad = 24;
      const c = viewCenter();
      const shape: MindShape = box
        ? {
            id: newId("s"),
            x: Math.round(box.x - pad),
            y: Math.round(box.y - pad - 20),
            w: Math.round(box.w + pad * 2),
            h: Math.round(box.h + pad * 2 + 20),
            title: "",
            magnetic: true,
          }
        : {
            id: newId("s"),
            x: Math.round(c.x - 160),
            y: Math.round(c.y - 110),
            w: 320,
            h: 220,
            title: "",
            magnetic: true,
          };
      // Formen liegen hinten — neue ganz hinten, damit sie nichts verdecken.
      update({ ...b, shapes: [shape, ...b.shapes] });
      select([], [shape.id]);
      setEditingShape(shape.id);
    },
    [getBoard, nodeRect, viewCenter, update, select],
  );

  const copySelection = useCallback((): string | null => {
    const b = getBoard();
    const nodes = b.nodes.filter((n) => selNodes.includes(n.id));
    if (!nodes.length) return null;
    const edges = b.edges.filter((e) => selNodes.includes(e.from) && selNodes.includes(e.to));
    const text = nodes
      .map((n) => n.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    clipboard = { text, nodes, edges };
    return text;
  }, [getBoard, selNodes]);

  const pasteNodes = useCallback(
    (nodes: MindNode[], edges: MindEdge[], at?: Point) => {
      const b = getBoard();
      const box = bounds(nodes.map(nodeRect));
      const offset = at && box ? { x: at.x - box.x, y: at.y - box.y } : { x: 24, y: 24 };
      const { board: next, ids } = cloneNodes(b, nodes, edges, offset);
      update(next);
      select(ids);
    },
    [getBoard, nodeRect, update, select],
  );

  const duplicate = useCallback(() => {
    const b = getBoard();
    const nodes = b.nodes.filter((n) => selNodes.includes(n.id));
    if (!nodes.length) return;
    const edges = b.edges.filter((e) => selNodes.includes(e.from) && selNodes.includes(e.to));
    pasteNodes(nodes, edges);
  }, [getBoard, selNodes, pasteNodes]);

  /** Speichert Bilddateien im Projekt und legt sie als Notizen ab. */
  const addImages = useCallback(
    async (files: File[], at: Point) => {
      const images = files.filter((f) => f.type.startsWith("image/") || imageExt(f));
      if (!images.length) return;
      const created: MindNode[] = [];
      let skipped = 0;
      for (const [i, file] of images.entries()) {
        if (!imageExt(file)) {
          skipped++;
          continue;
        }
        try {
          const ext = imageExt(file)!;
          const rel = await saveClipboardImage(
            file.type ? file : new File([file], file.name, { type: `image/${ext}` }),
          );
          const width = Math.min(await naturalWidth(file), IMAGE_DEFAULT_WIDTH);
          created.push({
            id: newId("n"),
            kind: "image",
            x: Math.round(at.x + i * 24),
            y: Math.round(at.y + i * 24),
            w: width,
            image: rel,
          });
        } catch (e) {
          useStore.setState({ error: String(e) });
        }
      }
      if (skipped) {
        useStore.setState({
          error: "Nur PNG, JPG, GIF und WebP lassen sich aufs Mindboard legen.",
        });
      }
      if (!created.length) return;
      const b = getBoard();
      update({ ...b, nodes: [...b.nodes, ...created] });
      select(created.map((n) => n.id));
    },
    [getBoard, update, select],
  );

  // ---------------------------------------------------------------- Tastatur

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingId || editingEdge || editingShape) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === " " && !e.repeat) {
      e.preventDefault();
      setSpaceDown(true);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
    } else if ((e.key === "Enter" || e.key === "F2") && selNodes.length === 1) {
      const n = getBoard().nodes.find((x) => x.id === selNodes[0]);
      if (n?.kind === "text") {
        e.preventDefault();
        setEditingId(n.id);
      }
    } else if (e.key === "Escape") {
      clearSelection();
    } else if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && key === "a") {
      e.preventDefault();
      const b = getBoard();
      select(
        b.nodes.map((n) => n.id),
        b.shapes.map((s) => s.id),
      );
    } else if (mod && key === "d") {
      e.preventDefault();
      duplicate();
    } else if (mod && key === "0") {
      e.preventDefault();
      fit();
    } else if (e.key.startsWith("Arrow") && (selNodes.length || selShapes.length)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const b = getBoard();
      update({
        ...patchNodes(b, selNodes, (n) => ({ x: n.x + dx, y: n.y + dy })),
        shapes: b.shapes.map((s) =>
          selShapes.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s,
        ),
      });
    }
  };

  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") setSpaceDown(false);
  };

  // Zwischenablage: nur, wenn das Board selbst den Fokus hat (nicht beim
  // Schreiben in einer Notiz — dort gilt die normale Textbearbeitung).
  useEffect(() => {
    const boardFocused = () => document.activeElement === viewportRef.current;
    const onCopy = (e: ClipboardEvent) => {
      if (!boardFocused()) return;
      const text = copySelection();
      if (text === null) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", text);
    };
    const onCut = (e: ClipboardEvent) => {
      if (!boardFocused()) return;
      onCopy(e);
      if (clipboard) deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!boardFocused() || !e.clipboardData) return;
      const files = [...e.clipboardData.items]
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      e.preventDefault();
      const at = insertPoint();
      if (files.length) {
        void addImages(files, at);
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (clipboard && text === clipboard.text) {
        pasteNodes(clipboard.nodes, clipboard.edges, at);
        return;
      }
      if (!text.trim()) return;
      // Fremder Text: ein Absatz = eine Notiz, untereinander.
      const paragraphs = text
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      const b = getBoard();
      const nodes: MindNode[] = paragraphs.map((p, i) => ({
        id: newId("n"),
        kind: "text",
        x: Math.round(at.x),
        y: Math.round(at.y + i * 48),
        text: p,
      }));
      update({ ...b, nodes: [...b.nodes, ...nodes] });
      select(nodes.map((n) => n.id));
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [copySelection, deleteSelection, insertPoint, addImages, pasteNodes, getBoard, update, select]);

  // ---------------------------------------------------------------- Ablegen von außen

  const acceptsDrop = (e: DragEvent) => {
    const t = e.dataTransfer.types;
    return (
      t.includes("Files") ||
      t.includes("text/uri-list") ||
      !!draggedPersonId(e) ||
      !!draggedLocationId(e) ||
      !!draggedSceneId(e)
    );
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    const t = e.dataTransfer.types;
    e.dataTransfer.dropEffect =
      t.includes("Files") || t.includes("text/uri-list") ? "copy" : "link";
    setExternalOver(true);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    setExternalOver(false);
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const person = draggedPersonId(e);
    const location = draggedLocationId(e);
    const scene = draggedSceneId(e);
    const ref = person
      ? { kind: "person" as const, refId: person }
      : location
        ? { kind: "location" as const, refId: location }
        : scene
          ? { kind: "scene" as const, refId: scene }
          : null;
    if (ref) {
      const b = getBoard();
      const node: MindNode = { id: newId("n"), x: Math.round(at.x), y: Math.round(at.y), ...ref };
      update({ ...b, nodes: [...b.nodes, node] });
      select([node.id]);
      focusBoard();
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length) {
      await addImages(files, at);
      focusBoard();
      return;
    }
    // Aus dem Browser gezogen: nur eingebettete Bilder (data:) kommen an —
    // Webadressen blockiert der Browser für fremde Seiten.
    const uri = e.dataTransfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((l) => l && !l.startsWith("#"));
    if (!uri) return;
    try {
      if (!uri.startsWith("data:image/")) throw new Error("kein eingebettetes Bild");
      const blob = await (await fetch(uri)).blob();
      await addImages([new File([blob], "bild", { type: blob.type })], at);
    } catch {
      useStore.setState({
        error:
          "Dieses Bild lässt sich nicht direkt aus dem Browser ablegen. Im Browser mit Rechtsklick „Bild kopieren“ und hier mit Strg+V einfügen.",
      });
    }
  };

  // ---------------------------------------------------------------- Menüs

  function nodeMenu(ids: string[], node: MindNode): ContextMenuItem[] {
    const b = getBoard();
    const nodes = b.nodes.filter((n) => ids.includes(n.id));
    const patch = (p: Partial<MindNode>) => update(patchNodes(getBoard(), ids, p));
    const items: ContextMenuItem[] = [];
    if (node.kind === "text" && ids.length === 1) {
      items.push({ label: "Bearbeiten", icon: "pencil", hint: "Enter", onSelect: () => setEditingId(node.id) });
    }
    if (node.refId && ids.length === 1) {
      items.push({ label: "Öffnen", icon: "arrow-right", onSelect: () => openRef(node) });
    }
    if (items.length) items.push({ kind: "separator" });
    items.push(colorSubmenu(node.color, (color) => patch({ color })));
    items.push({
      kind: "submenu",
      label: "Rahmen",
      icon: "square",
      items: BORDERS.map((o) => ({
        label: o.label,
        checked: (node.border || "none") === o.value,
        onSelect: () => patch({ border: o.value }),
      })),
    });
    if (nodes.some((n) => n.kind !== "image")) {
      items.push({
        kind: "submenu",
        label: "Schriftgröße",
        icon: "pilcrow",
        items: FONT_SIZES.map((o) => ({
          label: o.label,
          checked: (node.fontSize || 0) === o.value,
          onSelect: () => patch({ fontSize: o.value }),
        })),
      });
      items.push({
        label: "Fett",
        icon: "bold",
        checked: !!node.bold,
        onSelect: () => patch({ bold: !node.bold }),
      });
    }
    if (node.kind === "text" && node.w && ids.length === 1) {
      items.push({ label: "Breite automatisch", onSelect: () => patch({ w: 0 }) });
    }
    items.push({ kind: "separator" });
    if (ids.length > 1) {
      items.push({
        kind: "submenu",
        label: "Ausrichten",
        icon: "rows-2",
        items: ALIGNS.map((o) => ({ label: o.label, onSelect: () => applyAlign(ids, o.value) })),
      });
    }
    items.push({ label: "In Form fassen", icon: "square", onSelect: () => addShape(ids) });
    const linked = b.edges.some((e) => ids.includes(e.from) || ids.includes(e.to));
    items.push({
      label: "Verbindungen lösen",
      icon: "unlink-2",
      disabled: !linked,
      onSelect: () => {
        const cur = getBoard();
        update({
          ...cur,
          edges: cur.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)),
        });
      },
    });
    items.push({ kind: "separator" });
    items.push({ label: "Duplizieren", icon: "copy", hint: "Strg+D", onSelect: duplicate });
    items.push({
      label: "Löschen",
      icon: "trash-2",
      danger: true,
      hint: "Entf",
      onSelect: () => {
        update(removeItems(getBoard(), ids, []));
        clearSelection();
      },
    });
    return items;
  }

  function edgeMenu(edge: MindEdge): ContextMenuItem[] {
    const patchEdge = (p: Partial<MindEdge>) => {
      const b = getBoard();
      update({ ...b, edges: b.edges.map((e) => (e.id === edge.id ? { ...e, ...p } : e)) });
    };
    return [
      ...ARROWS.map((o) => ({
        label: o.label,
        checked: (edge.arrow || "none") === o.value,
        onSelect: () => patchEdge({ arrow: o.value }),
      })),
      {
        label: "Richtung umkehren",
        icon: "rotate-cw" as const,
        disabled: (edge.arrow || "none") !== "end",
        onSelect: () => patchEdge({ from: edge.to, to: edge.from }),
      },
      { kind: "separator" as const },
      { label: "Beschriftung …", icon: "pencil" as const, onSelect: () => setEditingEdge(edge.id) },
      { kind: "separator" as const },
      {
        label: "Verbindung löschen",
        icon: "trash-2" as const,
        danger: true,
        onSelect: () => {
          update(removeItems(getBoard(), [], [], edge.id));
          setSelEdge(null);
        },
      },
    ];
  }

  function shapeMenu(shape: MindShape): ContextMenuItem[] {
    const patchShape = (p: Partial<MindShape>) => {
      const b = getBoard();
      update({ ...b, shapes: b.shapes.map((s) => (s.id === shape.id ? { ...s, ...p } : s)) });
    };
    return [
      { label: "Titel bearbeiten", icon: "pencil", onSelect: () => setEditingShape(shape.id) },
      colorSubmenu(shape.color, (color) => patchShape({ color })),
      {
        label: "Magnetisch (Notizen mitnehmen)",
        checked: !!shape.magnetic,
        onSelect: () => patchShape({ magnetic: !shape.magnetic }),
      },
      { kind: "separator" },
      {
        label: "Form löschen",
        icon: "trash-2",
        danger: true,
        onSelect: () => {
          update(removeItems(getBoard(), [], [shape.id]));
          setSelShapes([]);
        },
      },
    ];
  }

  function backgroundMenu(at: Point): ContextMenuItem[] {
    return [
      { label: "Neue Notiz", icon: "plus", hint: "Doppelklick", onSelect: () => createNote(at) },
      { label: "Neue Form", icon: "square", onSelect: () => addShape() },
      { kind: "separator" },
      {
        label: "Alles auswählen",
        hint: "Strg+A",
        onSelect: () => {
          const b = getBoard();
          select(
            b.nodes.map((n) => n.id),
            b.shapes.map((s) => s.id),
          );
        },
      },
      { label: "Alles einpassen", icon: "scan", hint: "Strg+0", onSelect: fit },
    ];
  }

  // ---------------------------------------------------------------- Export

  const exportPng = async () => {
    try {
      const b = getBoard();
      const data = await exportBoardPng(b, (n) => nodeRect(n), viewportRef.current!);
      if (!data) {
        useStore.setState({ error: "Das Mindboard ist leer." });
        return;
      }
      await api.exportMindboardPng(`${name || "Mindboard"}.png`, data);
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  };

  // ---------------------------------------------------------------- Zeichnen

  const nodesById = useMemo(() => new Map(board.nodes.map((n) => [n.id, n])), [board.nodes]);

  const edgeGeometry = board.edges
    .map((edge) => {
      const a = nodesById.get(edge.from);
      const b = nodesById.get(edge.to);
      if (!a || !b) return null;
      const line = edgeLine(
        { x: a.x, y: a.y, ...(sizes[a.id] ?? FALLBACK_SIZE) },
        { x: b.x, y: b.y, ...(sizes[b.id] ?? FALLBACK_SIZE) },
      );
      return line ? { edge, line } : null;
    })
    .filter((g): g is { edge: MindEdge; line: { a: Point; b: Point } } => !!g);

  const zoomPct = Math.round(view.zoom * 100);

  return (
    <div className="mindboard">
      <div className="mb-toolbar">
        <h2 title={name}>{name}</h2>
        <div className="mb-toolbar-actions">
          <button title="Rückgängig (Strg+Z)" disabled={!canUndo} onClick={undo}>
            <Icon name="undo-2" size={14} />
          </button>
          <button title="Wiederholen (Strg+Y)" disabled={!canRedo} onClick={redo}>
            <Icon name="redo-2" size={14} />
          </button>
          <span className="mb-sep" />
          <button
            title={selNodes.length ? "Form um die Auswahl legen" : "Neue Hintergrundform"}
            onClick={() => addShape(selNodes)}
          >
            <Icon name="square" size={14} />
            Form
          </button>
          <span className="mb-sep" />
          <button title="Verkleinern" onClick={() => zoomAt(1 / 1.2)}>
            <Icon name="minus" size={14} />
          </button>
          <button
            className="mb-zoom"
            title="Auf 100 % setzen"
            onClick={() => zoomAt(1 / viewRef.current.zoom)}
          >
            {zoomPct} %
          </button>
          <button title="Vergrößern" onClick={() => zoomAt(1.2)}>
            <Icon name="plus" size={14} />
          </button>
          <button title="Alles einpassen (Strg+0)" onClick={fit}>
            <Icon name="scan" size={14} />
          </button>
          <span className="mb-sep" />
          <button title="Als PNG-Bild exportieren" onClick={() => void exportPng()}>
            <Icon name="download" size={14} />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`mb-viewport ${spaceDown ? "panning" : ""} ${externalOver ? "drop-over" : ""}`}
        tabIndex={0}
        style={{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!drag.current) lastPointer.current = null;
        }}
        onDoubleClick={(e) => {
          // Nur auf freier Fläche — Notizen, Linien und Formköpfe haben eigene.
          if (e.target !== e.currentTarget) return;
          createNote(toWorld(e.clientX, e.clientY));
        }}
        onContextMenu={(e) => openMenu(e, backgroundMenu(toWorld(e.clientX, e.clientY)))}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => setSpaceDown(false)}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExternalOver(false);
        }}
        onDrop={(e) => void onDrop(e)}
      >
        {!board.nodes.length && !board.shapes.length && (
          <div className="mb-empty muted">
            Doppelklick legt eine Notiz an. Notiz auf eine andere ziehen verbindet beide.
            <br />
            Bilder hierher ziehen oder mit Strg+V einfügen; Personen, Orte und Szenen aus
            den Seitenleisten ablegen.
          </div>
        )}
        <div
          className="mb-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          {board.shapes.map((s) => (
            <div
              key={s.id}
              className={`mb-shape ${s.color ? "mb-colored" : ""} ${selShapes.includes(s.id) ? "selected" : ""}`}
              style={
                {
                  left: s.x,
                  top: s.y,
                  width: s.w,
                  height: s.h,
                  ...(s.color ? { "--mb-color": s.color } : {}),
                } as CSSProperties
              }
            >
              <div
                className="mb-shape-head"
                onPointerDown={(e) => onShapePointerDown(e, s)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingShape(s.id);
                }}
                onContextMenu={(e) => {
                  select([], [s.id]);
                  openMenu(e, shapeMenu(s));
                }}
              >
                {editingShape === s.id ? (
                  <input
                    autoFocus
                    className="mb-shape-title-input"
                    defaultValue={s.title ?? ""}
                    placeholder="Titel"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      setEditingShape(null);
                      const title = e.currentTarget.value.trim();
                      const b = getBoard();
                      if (title !== (s.title ?? "")) {
                        update({
                          ...b,
                          shapes: b.shapes.map((x) => (x.id === s.id ? { ...x, title } : x)),
                        });
                      }
                      focusBoard();
                    }}
                  />
                ) : (
                  <span className="mb-shape-title">{s.title || " "}</span>
                )}
              </div>
              {selShapes.includes(s.id) && (
                <span
                  className="mb-resize"
                  title="Größe ändern"
                  onPointerDown={(e) => onShapeResizeStart(e, s)}
                />
              )}
            </div>
          ))}
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
            {edgeGeometry.map(({ edge, line }) => {
              const sel = selEdge === edge.id;
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
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      focusBoard();
                      setSelNodes([]);
                      setSelShapes([]);
                      setSelEdge(edge.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingEdge(edge.id);
                    }}
                    onContextMenu={(e) => {
                      setSelEdge(edge.id);
                      openMenu(e, edgeMenu(edge));
                    }}
                  />
                </g>
              );
            })}
          </svg>
          {edgeGeometry.map(({ edge, line }) => {
            const editing = editingEdge === edge.id;
            if (!edge.label && !editing) return null;
            const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
            return editing ? (
              <input
                key={edge.id}
                autoFocus
                className="mb-label-editor"
                style={{ left: mid.x, top: mid.y }}
                defaultValue={edge.label ?? ""}
                placeholder="Beschriftung"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  setEditingEdge(null);
                  const label = e.currentTarget.value.trim();
                  const b = getBoard();
                  if (label !== (edge.label ?? "")) {
                    update({
                      ...b,
                      edges: b.edges.map((x) => (x.id === edge.id ? { ...x, label } : x)),
                    });
                  }
                  focusBoard();
                }}
              />
            ) : (
              <span
                key={edge.id}
                className={`mb-label ${selEdge === edge.id ? "selected" : ""}`}
                style={{ left: mid.x, top: mid.y }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelNodes([]);
                  setSelShapes([]);
                  setSelEdge(edge.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingEdge(edge.id);
                }}
                onContextMenu={(e) => openMenu(e, edgeMenu(edge))}
              >
                {edge.label}
              </span>
            );
          })}
          {board.nodes.map((n) => (
            <NoteView
              key={n.id}
              node={n}
              selected={selNodes.includes(n.id)}
              editing={editingId === n.id}
              dropTarget={dropTarget === n.id}
              handlers={noteHandlers}
            />
          ))}
          {box && (
            <div
              className="mb-box"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          )}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
