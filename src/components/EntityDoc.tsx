// Person/Ort als freies Dokument: Meta-Kopf (Bild, Name, Szenen-Verknüpfungen)
// + TipTap-Editor für den Freitext darunter. Das Bild ist groß genug, um ein
// Porträt zu erkennen; ein Klick darauf wählt ein neues.

import { useEffect, useState } from "react";
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
}: {
  kind: EntityKind;
  entity: Entity;
  paneId: PaneId;
}) {
  const touchResearch = useStore((s) => s.touchResearch);
  const [name, setName] = useState(entity.name);
  const [sceneIds, setSceneIds] = useState<string[]>(entity.sceneIds ?? []);
  const imageKey = `${kind}:${entity.id}`;
  const [image, setImage] = useState<string | null>(() => imageCache.get(imageKey) ?? null);
  const [imageLoading, setImageLoading] = useState(false);
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
      const path = await api.pickEntityImage();
      if (!path) return;
      // Ab hier wird das Bild gelesen und verkleinert — bei großen Fotos
      // spürbar, daher der Ladezustand auf dem Avatar.
      setImageLoading(true);
      const img = await api.setEntityImage(kind, entity.id, path);
      imageCache.set(imageKey, img);
      setImage(img);
      touchResearch();
    } catch (e) {
      useStore.setState({ error: String(e) });
    } finally {
      setImageLoading(false);
    }
  }

  return (
    <div className="entity-doc">
      <div className="entity-meta">
        {image && <img className="entity-meta-backdrop" src={image} alt="" aria-hidden />}
        <div className="detail-header entity-header">
          <button
            className={`entity-avatar ${image ? "" : "empty"} ${imageLoading ? "loading" : ""}`}
            title={
              imageLoading ? "Bild wird übernommen …" : image ? "Bild ersetzen …" : "Bild wählen …"
            }
            disabled={imageLoading}
            aria-busy={imageLoading}
            onClick={() => void chooseImage()}
          >
            {image ? (
              <img src={image} alt={name} />
            ) : (
              <Icon name={kind === "characters" ? "user" : "map-pin"} size={32} />
            )}
            <span className="entity-avatar-hint">
              {imageLoading ? (
                <span className="entity-avatar-spinner" />
              ) : (
                <Icon name="camera" size={18} />
              )}
            </span>
          </button>
          <div className="entity-header-main">
            <input
              className="detail-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
            />
            <SceneLinks inline sceneIds={sceneIds} onChange={(ids) => void saveSceneIds(ids)} />
          </div>
        </div>
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
