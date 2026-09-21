// Personen, die in einem Ereignis des Zeitstrahls vorkommen. Gezeigt als
// Reihe runder Avatare — wer dabei ist, erkennt man am Gesicht schneller als
// am Namen; der Name steht im Tooltip. Hinzu kommen Personen per Drag & Drop
// aus der Seitenleiste oder über das Plus neben der Überschrift, entfernt
// werden sie per Rechtsklick.
import { useEffect, useState } from "react";
import { useStore, type PlanIndexEntry } from "../store";
import {
  ContextMenu,
  openBelow,
  useContextMenu,
  type ContextMenuItem,
} from "./ContextMenu";
import { Icon } from "./Icon";
import { cachedPlanTagAvatar, loadPlanTagAvatar } from "./planTagInfo";

export function PersonLinks({
  characterIds,
  onChange,
  incoming = null,
}: {
  characterIds: string[];
  onChange: (ids: string[]) => void;
  /** Die Person, die gerade über der Karte hängt. Abgelegt wird auf der Karte;
   *  die Reihe zeigt nur, was beim Loslassen passiert. */
  incoming?: string | null;
}) {
  const characters = useStore((s) => s.planIndex.characters);
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu();

  // Gelöschte Personen fallen still heraus — ein Avatar ohne Person dahinter
  // hätte weder Bild noch Namen.
  const linked = characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is PlanIndexEntry => !!c);

  const pending =
    incoming && !characterIds.includes(incoming)
      ? characters.find((c) => c.id === incoming)
      : undefined;

  const picker: ContextMenuItem[] = [...characters]
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .map((c) => {
      const done = characterIds.includes(c.id);
      return {
        label: c.name,
        mark: <Avatar person={c} size={18} />,
        checked: done,
        disabled: done,
        onSelect: () => onChange([...characterIds, c.id]),
      };
    });

  return (
    <div className="link-section">
      <div className="link-section-header">
        <span className="small muted">Verknüpfte Personen</span>
        <button
          className="link-add"
          title={
            picker.length > 0
              ? "Person verknüpfen"
              : "Noch keine Personen angelegt"
          }
          disabled={picker.length === 0}
          onClick={(e) => openBelow(e, picker, openAt)}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
      {(linked.length > 0 || pending) && (
        <ul className="person-links">
          {linked.map((c) => (
            <li
              key={c.id}
              className={incoming === c.id ? "already" : undefined}
            >
              <button
                className="person-link"
                title={c.name}
                onClick={() =>
                  void openResearchNextTo(
                    useStore.getState().activePane,
                    "characters",
                    c.id,
                  )
                }
                onContextMenu={(e) =>
                  openMenu(e, [
                    {
                      label: "Verknüpfung löschen",
                      icon: "unlink-2",
                      danger: true,
                      onSelect: () =>
                        onChange(characterIds.filter((id) => id !== c.id)),
                    },
                  ])
                }
              >
                <Avatar person={c} size={28} />
              </button>
            </li>
          ))}
          {pending && (
            // Vorschau: so steht die Person nach dem Loslassen in der Reihe.
            <li className="person-link-pending" title={pending.name}>
              <Avatar person={pending} size={28} />
            </li>
          )}
        </ul>
      )}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}

/** Rundes Bild der Person; ohne Bild ihre Initialen. */
function Avatar({ person, size }: { person: PlanIndexEntry; size: number }) {
  const [src, setSrc] = useState(() =>
    cachedPlanTagAvatar("person", person.id),
  );

  useEffect(() => {
    if (!person.hasImage) {
      setSrc(null);
      return;
    }
    let alive = true;
    void loadPlanTagAvatar(
      "person",
      person.id,
      useStore.getState().planIndex,
    ).then((img) => alive && setSrc(img));
    return () => {
      alive = false;
    };
    // `person` ist nach jedem Neuladen des Index ein neues Objekt — so kommt
    // auch ein ausgetauschtes Bild an (der Cache wird dabei geleert).
  }, [person]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return src ? (
    <img className="person-avatar" src={src} alt={person.name} style={style} />
  ) : (
    <span
      className="person-avatar initials"
      style={style}
      aria-label={person.name}
    >
      {initials(person.name)}
    </span>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
