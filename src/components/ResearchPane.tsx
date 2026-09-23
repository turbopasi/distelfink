import { useEffect, useState } from "react";
import { api } from "../api";
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

  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    let alive = true;
    void api
      .listEntities(kind)
      .then((l) => alive && setEntities(l))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [kind, researchVersion]);

  const labels = RESEARCH_KIND_LABELS[kind];
  const selectedEntity = entities.find((e) => e.id === researchId);

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
      ) : (
        <div className="research-detail empty">
          <p className="muted">
            {entities.length === 0
              ? `Noch keine ${labels.plural} angelegt.`
              : "Wähle in der Sidebar ein Dokument oder ein Modul für diesen Bereich aus."}
          </p>
        </div>
      )}
    </section>
  );
}
