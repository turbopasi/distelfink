import { useState, type ClipboardEvent, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import { findNode, findParentAndIndex } from "../tree";
import {
  ContextMenu,
  openBelow,
  useContextMenu,
  type ContextMenuItem,
} from "./ContextMenu";
import {
  StatusPill,
  colorMenuItem,
  confirmDeleteNode,
  statusMenuItem,
  statusOf,
} from "./NodeActions";
import { saveClipboardImage, useDocImage } from "./DocImage";
import { Icon } from "./Icon";
import type { BinderNode } from "../types";

/** ID der gerade gezogenen Karte (modulweit, DnD läuft nie parallel). */
let draggedCardId: string | null = null;

export function Corkboard({ chapterId }: { chapterId: string }) {
  const chapter = useStore((s) =>
    s.project ? findNode(s.project.meta.binder, chapterId) : null,
  );
  const createNode = useStore((s) => s.createNode);
  const moveNode = useStore((s) => s.moveNode);
  const selectChapter = useStore((s) => s.selectChapter);
  // Der Ordner, in dem dieser hier liegt — nur dann führt ein Weg nach oben.
  const parent = useStore((s) => {
    if (!s.project) return null;
    const pos = findParentAndIndex(s.project.meta.binder, chapterId);
    return pos?.parentId ? findNode(s.project.meta.binder, pos.parentId) : null;
  });
  const { menu, openAt, close: closeMenu } = useContextMenu();

  if (!chapter) return null;

  /** Der Ordner nimmt beides auf — die Karte entscheidet erst der Inhalt. */
  const newItems: ContextMenuItem[] = [
    {
      label: "Neues Dokument",
      icon: "file-text",
      onSelect: () => void createNode(chapterId, "scene", "Dokument"),
    },
    {
      label: "Neuer Ordner",
      icon: "folder",
      onSelect: () => void createNode(chapterId, "chapter", "Ordner"),
    },
  ];

  function onBoardDrop(e: DragEvent) {
    // Drop auf freie Fläche: ans Ende anhängen.
    e.preventDefault();
    if (draggedCardId) {
      void moveNode(draggedCardId, chapterId, Number.MAX_SAFE_INTEGER);
    }
  }

  return (
    <div
      className="corkboard"
      onDragOver={(e) => {
        if (draggedCardId) e.preventDefault();
      }}
      onDrop={onBoardDrop}
    >
      <div className="corkboard-header">
        {parent && (
          <button
            className="corkboard-up"
            title={`Zurück zu „${parent.title}"`}
            onClick={() => void selectChapter(parent.id)}
          >
            <Icon name="arrow-left" size={16} />
          </button>
        )}
        <h2>{chapter.title}</h2>
        <button
          aria-haspopup="menu"
          title="Neues Dokument oder neuen Ordner anlegen"
          onClick={(e) => openBelow(e, newItems, openAt)}
        >
          <Icon name="plus" size={14} />
          Neu
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
      {chapter.children.length === 0 ? (
        <p className="muted">Dieser Ordner ist noch leer.</p>
      ) : (
        <div className="cards">
          {chapter.children.map((child) => (
            <Card key={child.id} node={child} parentId={chapterId} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ node, parentId }: { node: BinderNode; parentId: string }) {
  const { selectScene, selectChapter, updateNodeMeta, moveNode, renameNode, duplicateNode } =
    useStore();
  const [synopsisDraft, setSynopsisDraft] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<"before" | "after" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  function openNode() {
    if (node.kind === "scene") void selectScene(node.id);
    else void selectChapter(node.id);
  }

  function startRename() {
    setDraft(node.title);
    setEditing(true);
  }

  function commitRename() {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== node.title) void renameNode(node.id, title);
    else setDraft(node.title);
  }

  /** Alles, was die Karte kann, steht im Rechtsklick-Menü — die Karte selbst
   *  zeigt nur noch Titel, Status, Bild und Synopsis. */
  function menuItems(): ContextMenuItem[] {
    return [
      { label: "Umbenennen", icon: "pencil", onSelect: startRename },
      { label: "Duplizieren", icon: "copy", onSelect: () => void duplicateNode(node.id) },
      { kind: "separator" },
      statusMenuItem(node),
      colorMenuItem(node),
      { kind: "separator" },
      {
        label: "Bild wählen …",
        icon: "image",
        hint: "Strg+V",
        onSelect: () => void chooseImage(),
      },
      ...(node.image
        ? [
            {
              label: "Bild entfernen",
              icon: "x" as const,
              onSelect: () => void updateNodeMeta(node.id, { image: "" }),
            },
          ]
        : []),
      { kind: "separator" },
      {
        label: "Löschen",
        icon: "trash-2",
        danger: true,
        onSelect: () => void confirmDeleteNode(node),
      },
    ];
  }

  function commitSynopsis() {
    if (synopsisDraft !== null && synopsisDraft !== (node.synopsis ?? "")) {
      void updateNodeMeta(node.id, { synopsis: synopsisDraft });
    }
    setSynopsisDraft(null);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const side = computeSide(e);
    setDropSide(null);
    if (!draggedCardId || draggedCardId === node.id) return;
    const binder = useStore.getState().project?.meta.binder ?? [];
    const targetPos = findParentAndIndex(binder, node.id);
    const dragPos = findParentAndIndex(binder, draggedCardId);
    if (!targetPos || !dragPos) return;
    let index = targetPos.index;
    if (dragPos.parentId === targetPos.parentId && dragPos.index < targetPos.index) {
      index--;
    }
    if (side === "after") index++;
    void moveNode(draggedCardId, parentId, index);
  }

  function computeSide(e: DragEvent): "before" | "after" {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX - rect.left < rect.width / 2 ? "before" : "after";
  }

  async function chooseImage() {
    const file = await open({
      title: "Kartenbild wählen",
      filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (typeof file !== "string") return;
    try {
      const rel = await api.importDocImage(file);
      await updateNodeMeta(node.id, { image: rel });
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  function onPaste(e: ClipboardEvent) {
    // Screenshot/Bild in der Zwischenablage → als Kartenbild übernehmen.
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void (async () => {
      try {
        const rel = await saveClipboardImage(file);
        await updateNodeMeta(node.id, { image: rel });
      } catch (err) {
        useStore.setState({ error: String(err) });
      }
    })();
  }

  return (
    <div
      className={`card ${dropSide ? `drop-${dropSide}` : ""} ${menu ? "menu-open" : ""}`}
      tabIndex={0}
      onPaste={onPaste}
      draggable={synopsisDraft === null && !editing}
      onDragStart={(e) => {
        draggedCardId = node.id;
        e.dataTransfer.setData("text/plain", node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        draggedCardId = null;
      }}
      onDragOver={(e) => {
        if (!draggedCardId || draggedCardId === node.id) return;
        e.preventDefault();
        e.stopPropagation();
        setDropSide(computeSide(e));
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={onDrop}
      // Auf der ganzen Karte — die Synopsis nimmt den halben Platz ein, dort
      // erwartet niemand ein anderes Menü. Nur das Umbenennen-Feld behält das
      // native Menü, weil dort gerade Text bearbeitet wird.
      onContextMenu={(e) => !editing && openMenu(e, menuItems())}
      style={node.color ? { borderTopColor: node.color } : undefined}
    >
      <StatusPill status={statusOf(node)} />

      <div className="card-head">
        {editing ? (
          <input
            className="card-title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(node.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="card-title" title="Doppelklick: öffnen" onDoubleClick={openNode}>
            <Icon name={node.kind === "chapter" ? "folder" : "file-text"} size={14} />
            {node.title}
          </div>
        )}
      </div>

      {node.image && <CardImage rel={node.image} />}

      <textarea
        className="card-synopsis"
        placeholder="Synopsis …"
        value={synopsisDraft ?? node.synopsis ?? ""}
        onFocus={() => setSynopsisDraft(node.synopsis ?? "")}
        onChange={(e) => setSynopsisDraft(e.target.value)}
        onBlur={commitSynopsis}
      />

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}

function CardImage({ rel }: { rel: string }) {
  const url = useDocImage(rel);
  if (!url) return null;
  return <img className="card-image" src={url} alt="" draggable={false} />;
}
