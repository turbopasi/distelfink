import { useEffect, useMemo, useState } from "react";
import { api, sceneRelPath } from "../api";
import { diffLines } from "../diff";
import { splitFlow } from "../flow";
import { PANE_IDS, sceneView, showsScene, useStore } from "../store";
import { findNode } from "../tree";
import type { VersionInfo } from "../types";

/** Modal mit der Versionshistorie der Szene aus `historyFor` (Ebene C). */
export function HistoryOverlay() {
  const sceneId = useStore((s) => s.historyFor);
  if (!sceneId) return null;
  return <HistoryPanel key={sceneId} sceneId={sceneId} />;
}

function HistoryPanel({ sceneId }: { sceneId: string }) {
  const project = useStore((s) => s.project);
  const setHistoryFor = useStore((s) => s.setHistoryFor);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const flushAll = useStore((s) => s.flushAll);
  // Aktueller Editorstand, falls die Szene gerade offen ist (Diff-Basis).
  // Im Fluss steht das ganze Kapitel im Editor — verglichen wird nur der
  // Abschnitt dieser Szene, sonst erschiene der Rest als „hinzugefügt".
  const paneContent = useStore((s) => {
    for (const id of PANE_IDS) {
      const pane = s.panes[id];
      const v = sceneView(pane);
      if (!v || !showsScene(pane, sceneId)) continue;
      if (!v.flowIds.length) return pane.content;
      return splitFlow(pane.content, v.flowIds).find((p) => p.id === sceneId)?.content ?? null;
    }
    return null;
  });

  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [selected, setSelected] = useState<VersionInfo | null>(null);
  const [versionContent, setVersionContent] = useState<string | null>(null);
  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = project ? (findNode(project.meta.binder, sceneId)?.title ?? sceneId) : sceneId;
  const rel = sceneRelPath(sceneId);
  const current = paneContent ?? diskContent;

  useEffect(() => {
    void (async () => {
      try {
        // Erst offene Änderungen auf Platte bringen, dann Verlauf laden.
        await flushAll();
        setVersions(await api.listHistory(rel));
        if (paneContent === null) setDiskContent(await api.readScene(sceneId));
      } catch (e) {
        setError(String(e));
      }
    })();
    // Einmal beim Öffnen: `paneContent` ändert sich mit jedem Tastendruck,
    // und neu zu laden ist dann nichts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  useEffect(() => {
    if (!selected) return;
    setVersionContent(null);
    api
      .getVersion(selected.commitId, rel)
      .then(setVersionContent)
      .catch((e) => setError(String(e)));
  }, [selected, rel]);

  const diff = useMemo(
    () => (versionContent !== null && current !== null ? diffLines(versionContent, current) : null),
    [versionContent, current],
  );
  const changed = diff?.some((l) => l.type !== "same") ?? false;

  return (
    <div className="quicknav-overlay" onMouseDown={() => setHistoryFor(null)}>
      <div className="history" onMouseDown={(e) => e.stopPropagation()}>
        <header className="history-header">
          <strong>Verlauf: {title}</strong>
          <span className="spacer" />
          <button onClick={() => setHistoryFor(null)}>Schließen (Esc)</button>
        </header>
        {error && <p className="history-error">{error}</p>}
        <div className="history-split">
          <aside className="history-list">
            {versions === null ? (
              <p className="muted small">Lade Verlauf …</p>
            ) : versions.length === 0 ? (
              <p className="muted small">Noch keine Sicherungspunkte für diese Szene.</p>
            ) : (
              <ul>
                {versions.map((v) => (
                  <li
                    key={v.commitId}
                    className={selected?.commitId === v.commitId ? "selected" : ""}
                    onClick={() => setSelected(v)}
                  >
                    <span className="history-time">
                      {new Date(v.timestampMs).toLocaleString("de-DE", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <span className="muted small history-msg">{v.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className="history-diff">
            {!selected ? (
              <p className="muted">
                Wähle links eine Version, um sie mit dem aktuellen Stand zu vergleichen.
              </p>
            ) : versionContent === null || current === null ? (
              <p className="muted">Lade Version …</p>
            ) : (
              <>
                <div className="history-diff-actions">
                  <span className="muted small">
                    {changed
                      ? "Rot = damals vorhanden, heute entfernt · Grün = seitdem hinzugekommen"
                      : "Diese Version ist identisch mit dem aktuellen Stand."}
                  </span>
                  <span className="spacer" />
                  <button
                    disabled={!changed}
                    onClick={() => void restoreVersion(sceneId, selected.commitId)}
                    title="Der aktuelle Stand wird vorher automatisch gesichert."
                  >
                    Diese Version wiederherstellen
                  </button>
                </div>
                <pre className="diff">
                  {diff!.map((line, i) => (
                    <div key={i} className={`diff-line diff-${line.type}`}>
                      <span className="diff-sign">
                        {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                      </span>
                      {line.text || " "}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
