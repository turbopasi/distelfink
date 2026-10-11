// Details eines Ereignisses am rechten Rand des Zeitstrahls. Gebaut aus
// denselben Teilen wie die Ansicht von Personen und Orten — Kopf mit großem
// Namensfeld, kleine Überschriften, die gewohnten Verknüpfungslisten —, damit
// sie sich wie ein Teil der App liest und nicht wie ein eigenes Werkzeug.
import { useLayoutEffect, useRef, useState } from "react";
import type { TimelineEvent, TimelineTrack } from "../../types";
import { Icon } from "../Icon";
import { LocationLinks } from "../LocationLinks";
import { PersonLinks } from "../PersonLinks";
import { SceneLinks } from "../SceneLinks";

/** Getippt wird lokal, gespeichert beim Verlassen des Felds — der Zeitstrahl
 *  speichert jede Änderung sofort, nicht jeden Buchstaben. Ändert sich der
 *  Wert von außen (Umbenennen im Balken, Neuladen), übernimmt das Feld ihn. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/** Ein Textfeld so hoch wie sein Inhalt (plus Rahmen). */
function fitHeight(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight + 2}px`;
}

export function EventInspector({
  event,
  track,
  onChange,
  onDelete,
  onClose,
}: {
  event: TimelineEvent;
  track: TimelineTrack | undefined;
  onChange: (patch: Partial<TimelineEvent>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useDraft(event.title);
  const [when, setWhen] = useDraft(event.when ?? "");
  const [synopsis, setSynopsis] = useDraft(event.description ?? "");
  const titleField = useRef<HTMLTextAreaElement>(null);
  const synopsisField = useRef<HTMLTextAreaElement>(null);

  // Titel und Synopsis wachsen mit ihrem Text: lange Titel brechen um, statt
  // seitlich aus dem Feld zu laufen, die Synopsis scrollt nicht im Kasten.
  useLayoutEffect(() => fitHeight(titleField.current), [title]);
  useLayoutEffect(() => fitHeight(synopsisField.current), [synopsis]);

  return (
    <aside
      className="tl-inspector"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="detail-header">
        <textarea
          ref={titleField}
          className="detail-name tl-inspector-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Zeilenumbrüche gehören nicht in einen Titel: Enter schließt ab.
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            // Ohne Titel geht es nicht: leer zurück auf den alten.
            const trimmed = title.trim();
            if (!trimmed) setTitle(event.title);
            else if (trimmed !== event.title) onChange({ title: trimmed });
          }}
        />
        <button title="Löschen" onClick={onDelete}>
          <Icon name="trash-2" size={14} />
        </button>
        <button title="Schließen" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {track && (
        <div className="tl-inspector-track small muted">
          <span className="color-dot" style={{ background: track.color || "var(--accent)" }} />
          {track.name}
        </div>
      )}
      <label className="tl-inspector-field">
        <span className="small muted">Wann?</span>
        <input
          placeholder="z. B. 3. März, Tag 12 …"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => when !== (event.when ?? "") && onChange({ when })}
        />
      </label>
      <label className="tl-inspector-field">
        <span className="small muted">Synopsis</span>
        <textarea
          ref={synopsisField}
          placeholder="Was passiert? …"
          rows={3}
          value={synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
          onBlur={() =>
            synopsis !== (event.description ?? "") && onChange({ description: synopsis })
          }
        />
      </label>
      <PersonLinks
        characterIds={event.characterIds ?? []}
        onChange={(characterIds) => onChange({ characterIds })}
      />
      <LocationLinks
        locationIds={event.locationIds ?? []}
        onChange={(locationIds) => onChange({ locationIds })}
      />
      <SceneLinks
        sceneIds={event.sceneIds ?? []}
        onChange={(sceneIds) => onChange({ sceneIds })}
      />
    </aside>
  );
}
