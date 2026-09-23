// Orte, an denen ein Ereignis des Zeitstrahls spielt. Wie die Dokumente eine
// Liste aus Symbol und Namen statt runder Bilder: ein Ort hat selten ein
// Gesicht, und „Gasthaus zur Post" ist als Text zu erkennen, als Initialen
// nicht. Hinzu kommen Orte per Drag & Drop aus der Seitenleiste oder über das
// Plus neben der Überschrift, entfernt werden sie per Rechtsklick.
import { useStore, type PlanIndexEntry } from "../store";
import { ContextMenu, openBelow, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";

export function LocationLinks({
  locationIds,
  onChange,
  incoming = null,
}: {
  locationIds: string[];
  onChange: (ids: string[]) => void;
  /** Der Ort, der gerade über der Karte hängt. Abgelegt wird auf der Karte;
   *  die Liste zeigt nur, was beim Loslassen passiert. */
  incoming?: string | null;
}) {
  const locations = useStore((s) => s.planIndex.locations);
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu();

  // Gelöschte Orte fallen still heraus — ein Eintrag ohne Ort dahinter hätte
  // keinen Namen.
  const linked = locationIds
    .map((id) => locations.find((l) => l.id === id))
    .filter((l): l is PlanIndexEntry => !!l);

  const pending =
    incoming && !locationIds.includes(incoming)
      ? locations.find((l) => l.id === incoming)
      : undefined;

  const picker: ContextMenuItem[] = [...locations]
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .map((l) => {
      const done = locationIds.includes(l.id);
      return {
        label: l.name,
        icon: "map-pin" as const,
        checked: done,
        disabled: done,
        onSelect: () => onChange([...locationIds, l.id]),
      };
    });

  return (
    <div className="link-section">
      <div className="link-section-header">
        <span className="small muted">Verknüpfte Orte</span>
        <button
          className="link-add"
          title={picker.length > 0 ? "Ort verknüpfen" : "Noch keine Orte angelegt"}
          disabled={picker.length === 0}
          onClick={(e) => openBelow(e, picker, openAt)}
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
      {(linked.length > 0 || pending) && (
        <ul className="doc-links">
          {linked.map((l) => (
            <li key={l.id} className={incoming === l.id ? "already" : undefined}>
              <button
                className="doc-link"
                title={incoming === l.id ? "Schon verknüpft" : "Ort öffnen"}
                onClick={() =>
                  void openResearchNextTo(
                    useStore.getState().activePane,
                    "locations",
                    l.id,
                  )
                }
                onContextMenu={(e) =>
                  openMenu(e, [
                    {
                      label: "Verknüpfung löschen",
                      icon: "unlink-2",
                      danger: true,
                      onSelect: () => onChange(locationIds.filter((id) => id !== l.id)),
                    },
                  ])
                }
              >
                <Icon name="map-pin" size={14} />
                <span className="doc-link-title">{l.name}</span>
              </button>
            </li>
          ))}
          {pending && (
            // Vorschau: so steht der Ort nach dem Loslassen in der Liste.
            <li className="doc-link-pending">
              <span className="doc-link">
                <Icon name="map-pin" size={14} />
                <span className="doc-link-title">{pending.name}</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
