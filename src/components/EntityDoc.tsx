// Person/Ort als freies Dokument: schmaler Meta-Kopf (Name, Bild,
// Szenen-Verknüpfungen) + TipTap-Editor für den Freitext darunter.

import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore, type PaneId } from "../store";
import { DocEditor } from "./DocEditor";
import { MentionsBar } from "./MentionsBar";
import { SceneLinks } from "./SceneLinks";
import type { Entity, EntityKind } from "../types";
import { Icon } from "./Icon";

/** Bild pro Eintrag ("kind:id" → data-URL oder null), einmal pro Sitzung
 *  geladen: das Original geht sonst bei jedem Wechsel erneut als base64 über
 *  die IPC und verzögert das Anzeigen des Dokuments. */
const imageCache = new Map<string, string | null>();

/** Beim Projektwechsel und „Projekt neu laden“: dieselbe ID kann in einem
 *  kopierten Projekt oder nach einem Sync ein anderes Bild haben. */
export function clearEntityImages() {
  imageCache.clear();
}

export function EntityDoc({
  kind,
  entity,
  paneId,
  onDeleted,
}: {
  kind: EntityKind;
  entity: Entity;
  paneId: PaneId;
  onDeleted: () => void;
}) {
  const touchResearch = useStore((s) => s.touchResearch);
  const [name, setName] = useState(entity.name);
  const [sceneIds, setSceneIds] = useState<string[]>(entity.sceneIds ?? []);
  const imageKey = `${kind}:${entity.id}`;
  const [image, setImage] = useState<string | null>(() => imageCache.get(imageKey) ?? null);
  const [metaOpen, setMetaOpen] = useState(false);
  // Nach „Projekt neu laden“ ist der Bildspeicher leer: neu holen.
  const reloadCount = useStore((s) => s.reloadCount);

  useEffect(() => {
    if (imageCache.has(imageKey)) return;
    let alive = true;
    void api.getEntityImage(kind, entity.id).then((img) => {
      imageCache.set(imageKey, img);
      if (alive) setImage(img);
    });
    return () => {
      alive = false;
    };
  }, [kind, entity.id, imageKey, reloadCount]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === entity.name) return;
    try {
      await api.updateEntityMeta(kind, entity.id, { name: trimmed });
      touchResearch();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  async function saveSceneIds(next: string[]) {
    setSceneIds(next);
    try {
      await api.updateEntityMeta(kind, entity.id, { sceneIds: next });
      touchResearch();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  async function chooseImage() {
    try {
      if (!(await api.setEntityImage(kind, entity.id))) return;
      const img = await api.getEntityImage(kind, entity.id);
      imageCache.set(imageKey, img);
      setImage(img);
      touchResearch();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  async function confirmDelete() {
    const yes = await ask(`"${entity.name}" löschen? (wandert in den Papierkorb des Projekts)`, {
      title: "Löschen",
      kind: "warning",
    });
    if (!yes) return;
    try {
      await api.deleteEntity(kind, entity.id);
      touchResearch();
      useStore.getState().touchTrash();
      onDeleted();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  return (
    <div className="entity-doc">
      <div className="entity-meta">
        <div className="detail-header">
          {image && <img className="entity-avatar" src={image} alt={name} />}
          <input
            className="detail-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
          />
          <button
            className={metaOpen ? "on" : ""}
            title="Bild und Dokumenten-Verknüpfungen"
            onClick={() => setMetaOpen(!metaOpen)}
          >
            <Icon name="info" size={14} />
          </button>
          <button title="Löschen" onClick={() => void confirmDelete()}>
            <Icon name="trash-2" size={14} />
          </button>
        </div>
        {metaOpen && (
          <div className="entity-meta-details">
            <div className="detail-image-row">
              {image && <img className="detail-image" src={image} alt={name} />}
              <button onClick={() => void chooseImage()}>
                {image ? "Bild ersetzen …" : "Bild wählen …"}
              </button>
            </div>
            <SceneLinks sceneIds={sceneIds} onChange={(ids) => void saveSceneIds(ids)} />
          </div>
        )}
      </div>
      <DocEditor
        docKey={`${kind}:${entity.id}`}
        paneId={paneId}
        read={() => api.readEntityDoc(kind, entity.id)}
        write={(content, force) => api.writeEntityDoc(kind, entity.id, content, force)}
      />
      <MentionsBar
        tagKind={kind === "characters" ? "person" : "location"}
        id={entity.id}
        paneId={paneId}
      />
    </div>
  );
}
