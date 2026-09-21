// Verknüpfte Dokumente einer Karte (Zeitstrahl) oder eines Eintrags (Personen,
// Orte). Bewusst schlicht: eine Liste aus Symbol und Titel — die Verknüpfung
// ist ein Verweis, keine Karteikarte, und soll die Karte nicht zuwachsen. Was
// man mit ihr tun kann, steht im Rechtsklick-Menü; hinzu kommen Dokumente per
// Drag & Drop aus dem Binder oder über das Plus neben der Überschrift.
import { useState, type DragEvent } from "react";
import { useStore } from "../store";
import { findNode } from "../tree";
import type { BinderNode } from "../types";
import { ContextMenu, openBelow, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { SCENE_DRAG_TYPE, draggedSceneId, leftFor } from "./drag";

const NO_BINDER: BinderNode[] = [];

export function SceneLinks({
  sceneIds,
  onChange,
  incoming,
}: {
  sceneIds: string[];
  onChange: (ids: string[]) => void;
  /** Das Dokument, das gerade über dem Umfeld der Liste hängt. Wer es angibt
   *  (auch als null), nimmt das Ablegen selbst an — die Liste zeigt dann nur,
   *  was beim Loslassen passiert. Ohne Angabe ist die Liste selbst das Ziel. */
  incoming?: string | null;
}) {
  const binder = useStore((s) => s.project?.meta.binder ?? NO_BINDER);
  const selectScene = useStore((s) => s.selectScene);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu();
  const [hovering, setHovering] = useState<string | null>(null);
  const ownsDrop = incoming === undefined;
  const pending = ownsDrop ? hovering : incoming;

  /** Doppelte Verweise bringen nichts — dasselbe Dokument steht nur einmal. */
  function link(id: string) {
    if (id && !sceneIds.includes(id)) onChange([...sceneIds, id]);
  }

  /** Das Menü hinter dem Plus steht so da wie der Binder: Kapitel klappen als
   *  Untermenü auf, Verknüpftes trägt ein Häkchen und lässt sich nicht noch
   *  einmal wählen. Kapitel ohne Dokumente fallen weg. */
  function pickerItems(nodes: BinderNode[]): ContextMenuItem[] {
    return nodes.flatMap((node): ContextMenuItem[] => {
      if (node.kind === "scene") {
        const done = sceneIds.includes(node.id);
        return [
          {
            label: node.title,
            icon: "file-text",
            checked: done,
            disabled: done,
            onSelect: () => link(node.id),
          },
        ];
      }
      const items = pickerItems(node.children);
      return items.length > 0
        ? [{ kind: "submenu", label: node.title, icon: "folder", items }]
        : [];
    });
  }

  const picker = pickerItems(binder);

  function onDragOver(e: DragEvent) {
    const id = draggedSceneId(e);
    if (!id) return;
    e.preventDefault();
    // Schon verknüpft: kein Ablegen, der vorhandene Eintrag leuchtet stattdessen.
    e.dataTransfer.dropEffect = sceneIds.includes(id) ? "none" : "link";
    setHovering(id);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setHovering(null);
    link(e.dataTransfer.getData(SCENE_DRAG_TYPE));
  }

  const pendingIsNew = !!pending && !sceneIds.includes(pending);

  return (
    <div
      className={`link-section scene-links ${ownsDrop && pendingIsNew ? "drop-here" : ""}`}
      onDragOver={ownsDrop ? onDragOver : undefined}
      onDragLeave={ownsDrop ? (e) => leftFor(e) && setHovering(null) : undefined}
      onDrop={ownsDrop ? onDrop : undefined}
    >
      <div className="link-section-header">
        <span className="small muted">Verknüpfte Dokumente</span>
        <button
          className="link-add"
          title={picker.length > 0 ? "Dokument verknüpfen" : "Noch keine Dokumente im Binder"}
          disabled={picker.length === 0}
          onClick={(e) => openBelow(e, picker, openAt)}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
      <ul className="doc-links">
        {sceneIds.map((id) => {
          const node = findNode(binder, id);
          return (
            <li key={id} className={pending === id ? "already" : undefined}>
              <button
                className="doc-link"
                title={pending === id ? "Schon verknüpft" : "Dokument öffnen"}
                onClick={() => void selectScene(id)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    {
                      label: "Verknüpfung löschen",
                      icon: "unlink-2",
                      danger: true,
                      onSelect: () => onChange(sceneIds.filter((s) => s !== id)),
                    },
                  ])
                }
              >
                <Icon name="file-text" size={14} />
                <span className="doc-link-title">{node?.title ?? id}</span>
              </button>
            </li>
          );
        })}
        {pendingIsNew && (
          // Vorschau: so steht das Dokument nach dem Loslassen in der Liste.
          <li className="doc-link-pending">
            <span className="doc-link">
              <Icon name="file-text" size={14} />
              <span className="doc-link-title">{findNode(binder, pending)?.title ?? pending}</span>
            </span>
          </li>
        )}
      </ul>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
