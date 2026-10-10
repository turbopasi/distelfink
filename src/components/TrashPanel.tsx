// Papierkorb des Projekts: was gelöscht wurde, wann, und der Weg zurück.
// Gezeigt wird er wie der Zeitstrahl in einem Bereich, nicht als Dialog —
// Wiederherstellen ist Arbeit am Projekt, kein Zwischenruf.
import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import type { TrashItem } from "../types";
import { Icon, type IconName } from "./Icon";

const KIND_ICON: Record<string, IconName> = {
  chapter: "folder",
  scene: "file-text",
  characters: "user",
  locations: "map-pin",
  mindboard: "workflow",
};

const KIND_LABEL: Record<string, string> = {
  chapter: "Ordner",
  scene: "Dokument",
  characters: "Person",
  locations: "Ort",
  mindboard: "Mindboard",
};

/** „Heute, 14:03" statt eines vollen Zeitstempels — das Datum trägt nur, wo
 *  es etwas unterscheidet. */
function formatDeleted(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return `Heute, ${time}`;
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}, ${time}`;
}

export function TrashPanel() {
  const trashVersion = useStore((s) => s.trashVersion);
  const projectRoot = useStore((s) => s.project?.root);
  const restoreFromTrash = useStore((s) => s.restoreFromTrash);
  const touchTrash = useStore((s) => s.touchTrash);
  const [items, setItems] = useState<TrashItem[]>([]);

  useEffect(() => {
    let alive = true;
    void api
      .listTrash()
      .then((list) => alive && setItems(list))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [trashVersion, projectRoot]);

  async function purge(item: TrashItem) {
    const yes = await ask(
      `"${item.title}" endgültig löschen? Das lässt sich nicht rückgängig machen.`,
      { title: "Endgültig löschen", kind: "warning" },
    );
    if (!yes) return;
    try {
      await api.deleteTrashItem(item.key);
      touchTrash();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  async function emptyAll() {
    const yes = await ask(
      `Papierkorb leeren? ${items.length} Einträge werden endgültig gelöscht.`,
      { title: "Papierkorb leeren", kind: "warning" },
    );
    if (!yes) return;
    try {
      await api.emptyTrash();
      touchTrash();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  return (
    <div className="trash-panel">
      <div className="trash-header">
        <h2>Papierkorb</h2>
        {items.length > 0 && (
          <button onClick={() => void emptyAll()}>
            <Icon name="trash-2" size={14} />
            Leeren
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="muted">
          Der Papierkorb ist leer. Gelöschte Ordner, Dokumente, Personen, Orte und Mindboards
          landen hier, bis sie endgültig gelöscht werden.
        </p>
      ) : (
        <ul className="trash-list">
          {items.map((item) => (
            <li key={item.key}>
              <span className="trash-kind" title={KIND_LABEL[item.kind] ?? item.kind}>
                <Icon name={KIND_ICON[item.kind] ?? "file-text"} size={14} />
              </span>
              <span className="trash-title">{item.title}</span>
              <span className="trash-when muted small">
                {KIND_LABEL[item.kind] ?? item.kind} · {formatDeleted(item.deletedAt)}
              </span>
              <span className="trash-actions">
                <button
                  title="An seinen alten Platz zurücklegen"
                  onClick={() => void restoreFromTrash(item.key)}
                >
                  <Icon name="rotate-cw" size={14} />
                  Wiederherstellen
                </button>
                <button
                  className="danger"
                  title="Endgültig löschen"
                  onClick={() => void purge(item)}
                >
                  <Icon name="trash-2" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
