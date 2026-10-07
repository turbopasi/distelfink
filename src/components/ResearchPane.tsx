import { useEffect, useState } from "react";
import { cachedEntities, loadEntities } from "../entityLists";
import { useStore, type PaneId, type PaneResearchKind } from "../store";
import { DocBackdrop } from "./DocBackdrop";
import { EntityDoc } from "./EntityDoc";
import type { Entity } from "../types";

export const RESEARCH_KIND_LABELS: Record<PaneResearchKind, { singular: string; plural: string }> = {
  characters: { singular: "Person", plural: "Personen" },
  locations: { singular: "Ort", plural: "Orte" },
};

/** Pane-Inhalt für Recherche: das Detail zum in der Sidebar gewählten Eintrag. */
export function ResearchPane({ paneId }: { paneId: PaneId }) {
  const kind = useStore((s) => s.panes[paneId].researchKind)!;
  const researchId = useStore((s) => s.panes[paneId].researchId);
  const isActive = useStore((s) => s.activePane === paneId && s.layoutMode !== "single");
  const setActivePane = useStore((s) => s.setActivePane);
  const setPaneResearchId = useStore((s) => s.setPaneResearchId);
  const researchVersion = useStore((s) => s.researchVersion);
  const projectRoot = useStore((s) => s.project?.root);

  // Frisch geladene Liste — gilt nur für Art, Projekt und Stand, zu denen sie
  // geladen wurde. Bis dahin steht die zwischengespeicherte Liste da.
  const [loaded, setLoaded] = useState<{
    kind: PaneResearchKind;
    root: string | undefined;
    version: number;
    list: Entity[];
  } | null>(null);
  const fresh =
    loaded?.kind === kind && loaded.root === projectRoot && loaded.version === researchVersion;
  const entities =
    (loaded?.kind === kind && loaded.root === projectRoot ? loaded.list : undefined) ??
    cachedEntities(projectRoot, kind);

  useEffect(() => {
    let alive = true;
    void loadEntities(projectRoot, kind)
      .then((list) => alive && setLoaded({ kind, root: projectRoot, version: researchVersion, list }))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [kind, researchVersion, projectRoot]);

  const labels = RESEARCH_KIND_LABELS[kind];
  const selectedEntity = entities?.find((e) => e.id === researchId);
  // Liste (oder ein gerade angelegter Eintrag) noch unterwegs: leere Fläche
  // statt kurz aufblitzender Hinweise.
  const pending = !entities || (!selectedEntity && researchId !== null && !fresh);

  return (
    <section
      className={`editor research-pane ${isActive ? "pane-active" : ""}`}
      onFocusCapture={() => setActivePane(paneId)}
      onMouseDownCapture={() => setActivePane(paneId)}
    >
      <DocBackdrop />
      {selectedEntity ? (
        <EntityDoc
          key={selectedEntity.id}
          kind={kind}
          entity={selectedEntity}
          paneId={paneId}
          onDeleted={() => setPaneResearchId(paneId, null)}
        />
      ) : pending ? null : (
        <div className="research-detail empty">
          <p className="muted">
            {!entities?.length
              ? `Noch keine ${labels.plural} angelegt.`
              : "Wähle in der Sidebar ein Dokument oder ein Modul für diesen Bereich aus."}
          </p>
        </div>
      )}
    </section>
  );
}
