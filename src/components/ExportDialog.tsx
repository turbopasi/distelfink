import { useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { LANGUAGE_OPTIONS } from "../settings";
import { useStore } from "../store";
import {
  EXPORT_FONT_LABEL,
  EXPORT_FORMAT_LABEL,
  type BinderNode,
  type ExportFormat,
  type ExportTemplate,
} from "../types";

/** Modal für Export/Compile (Phase 6). */
export function ExportOverlay() {
  const open = useStore((s) => s.exportOpen);
  if (!open) return null;
  return <ExportDialog />;
}

/** Alle Node-IDs eines Teilbaums (inkl. Wurzeln). */
function allIds(nodes: BinderNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children)]);
}

const FORMATS: ExportFormat[] = ["docx", "pdf", "epub", "markdown", "txt"];

function ExportDialog() {
  const project = useStore((s) => s.project)!;
  const setExportOpen = useStore((s) => s.setExportOpen);

  const [templates, setTemplates] = useState<ExportTemplate[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("builtin-normseite");
  /** Editierbare Arbeitskopie der gewählten Vorlage. */
  const [tpl, setTpl] = useState<ExportTemplate | null>(null);
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(allIds(project.meta.binder)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api
      .listExportTemplates()
      .then((list) => {
        setTemplates(list);
        const first = list.find((t) => t.id === "builtin-normseite") ?? list[0];
        if (first) {
          setSelectedId(first.id);
          setTpl({ ...first });
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const selectTemplate = (id: string) => {
    const t = templates?.find((t) => t.id === id);
    if (!t) return;
    setSelectedId(id);
    setTpl({ ...t, marginsMm: { ...t.marginsMm } });
  };

  const patchTpl = (patch: Partial<ExportTemplate>) =>
    setTpl((t) => (t ? { ...t, ...patch } : t));

  const sceneCount = useMemo(() => {
    const count = (nodes: BinderNode[]): number =>
      nodes.reduce(
        (sum, n) =>
          sum +
          (included.has(n.id) ? (n.kind === "scene" ? 1 : 0) + count(n.children) : 0),
        0,
      );
    return count(project.meta.binder);
  }, [project, included]);

  async function saveTemplate() {
    if (!tpl) return;
    try {
      const isBuiltin = templates?.find((t) => t.id === tpl.id)?.builtIn;
      const name = isBuiltin ? `${tpl.name} (Kopie)` : tpl.name;
      const list = await api.saveExportTemplate({ ...tpl, name });
      setTemplates(list);
      // Neu angelegte Vorlage (neue ID) direkt auswählen.
      const customs = list.filter((t) => !t.builtIn);
      const saved =
        list.find((t) => !isBuiltin && t.id === tpl.id) ?? customs[customs.length - 1];
      if (saved) {
        setSelectedId(saved.id);
        setTpl({ ...saved, marginsMm: { ...saved.marginsMm } });
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteTemplate() {
    if (!tpl || templates?.find((t) => t.id === tpl.id)?.builtIn) return;
    try {
      const list = await api.deleteExportTemplate(tpl.id);
      setTemplates(list);
      selectTemplateFrom(list, "builtin-normseite");
    } catch (e) {
      setError(String(e));
    }
  }

  function selectTemplateFrom(list: ExportTemplate[], id: string) {
    const t = list.find((t) => t.id === id) ?? list[0];
    if (t) {
      setSelectedId(t.id);
      setTpl({ ...t, marginsMm: { ...t.marginsMm } });
    }
  }

  async function doExport() {
    if (!tpl || busy) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const written = await api.exportProject(format, tpl, [...included]);
      if (written) setDone(written);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const isBuiltin = templates?.find((t) => t.id === selectedId)?.builtIn ?? true;

  return (
    <div className="quicknav-overlay" onMouseDown={() => setExportOpen(false)}>
      <div className="history export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="history-header">
          <strong>Exportieren</strong>
          <span className="spacer" />
          <button onClick={() => setExportOpen(false)}>Schließen (Esc)</button>
        </header>
        {error && <p className="history-error">{error}</p>}
        <div className="export-split">
          <aside className="export-tree">
            <h3>Inhalt</h3>
            <p className="muted small">Was soll in den Export einfließen?</p>
            <IncludeTree
              nodes={project.meta.binder}
              included={included}
              setIncluded={setIncluded}
            />
          </aside>
          <section className="export-settings">
            <label className="export-row">
              <span>Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {EXPORT_FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="export-row">
              <span>Vorlage</span>
              <select value={selectedId} onChange={(e) => selectTemplate(e.target.value)}>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.builtIn ? " (eingebaut)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {tpl && (
              <fieldset className="export-template">
                <legend>Formatierung</legend>
                <label className="export-row">
                  <span>Name</span>
                  <input
                    value={tpl.name}
                    onChange={(e) => patchTpl({ name: e.target.value })}
                  />
                </label>
                <label className="export-row">
                  <span>Schriftart</span>
                  <select value={tpl.font} onChange={(e) => patchTpl({ font: e.target.value })}>
                    {Object.entries(EXPORT_FONT_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="export-row">
                  <span>Größe / Zeilenabstand</span>
                  <span className="export-inline">
                    <input
                      type="number"
                      min={6}
                      max={32}
                      step={0.5}
                      value={tpl.fontSizePt}
                      onChange={(e) => patchTpl({ fontSizePt: Number(e.target.value) })}
                    />
                    <span className="muted small">pt</span>
                    <select
                      value={String(tpl.lineSpacing)}
                      onChange={(e) => patchTpl({ lineSpacing: Number(e.target.value) })}
                    >
                      <option value="1">einzeilig</option>
                      <option value="1.15">1,15</option>
                      <option value="1.5">1,5-zeilig</option>
                      <option value="2">zweizeilig</option>
                    </select>
                  </span>
                </div>
                <div className="export-row">
                  <span>Ränder (mm)</span>
                  <span className="export-inline">
                    {(["top", "bottom", "left", "right"] as const).map((side) => (
                      <label key={side} className="export-margin">
                        <span className="muted small">
                          {{ top: "oben", bottom: "unten", left: "links", right: "rechts" }[side]}
                        </span>
                        <input
                          type="number"
                          min={5}
                          max={60}
                          value={tpl.marginsMm[side]}
                          onChange={(e) =>
                            patchTpl({
                              marginsMm: { ...tpl.marginsMm, [side]: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                    ))}
                  </span>
                </div>
                <div className="export-row">
                  <span>Ausrichtung</span>
                  <span className="export-inline">
                    <select
                      value={tpl.alignment || "left"}
                      onChange={(e) => patchTpl({ alignment: e.target.value })}
                    >
                      <option value="left">Linksbündig</option>
                      <option value="justify">Blocksatz</option>
                    </select>
                    <span className="muted small">
                      gilt für Absätze ohne eigene Ausrichtung; PDF setzt immer Flattersatz
                    </span>
                  </span>
                </div>
                <div className="export-row">
                  <span>Sprache</span>
                  <span className="export-inline">
                    <select
                      value={tpl.language || "de"}
                      onChange={(e) => patchTpl({ language: e.target.value })}
                    >
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <span className="muted small">ePub-Metadaten und Silbentrennung</span>
                  </span>
                </div>
                <label className="export-row">
                  <span>Kopfzeile</span>
                  <input
                    value={tpl.header}
                    placeholder="leer = keine Kopfzeile"
                    title="Platzhalter: {titel}, {autor}, {seite}"
                    onChange={(e) => patchTpl({ header: e.target.value })}
                  />
                </label>
                <label className="export-row">
                  <span>Dokumententrenner</span>
                  <input
                    value={tpl.sceneSeparator}
                    placeholder="leer = Leerzeile"
                    onChange={(e) => patchTpl({ sceneSeparator: e.target.value })}
                  />
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={tpl.hyphenation}
                    onChange={(e) => patchTpl({ hyphenation: e.target.checked })}
                  />
                  Silbentrennung im ePub (empfohlen bei Blocksatz)
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={tpl.chapterStartNewPage}
                    onChange={(e) => patchTpl({ chapterStartNewPage: e.target.checked })}
                  />
                  Jeder Ordner beginnt auf neuer Seite
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={tpl.includeSceneTitles}
                    onChange={(e) => patchTpl({ includeSceneTitles: e.target.checked })}
                  />
                  Dokumententitel als Überschriften ausgeben
                </label>
                <div className="export-inline">
                  <button onClick={() => void saveTemplate()}>
                    {isBuiltin ? "Als neue Vorlage speichern" : "Vorlage speichern"}
                  </button>
                  {!isBuiltin && (
                    <button onClick={() => void deleteTemplate()}>Vorlage löschen</button>
                  )}
                </div>
                <p className="muted small">
                  Kopfzeilen-Platzhalter: {"{titel}"}, {"{autor}"}, {"{seite}"} · Vorlagen
                  werden im Projekt gespeichert.
                </p>
              </fieldset>
            )}

            <div className="export-actions">
              {done ? (
                <>
                  <span className="export-done">✓ Exportiert: {done}</span>
                  <button onClick={() => void revealItemInDir(done)}>Im Ordner anzeigen</button>
                </>
              ) : (
                <span className="muted small">
                  {sceneCount} {sceneCount === 1 ? "Dokument" : "Dokumente"} ausgewählt
                </span>
              )}
              <span className="spacer" />
              <button
                className="primary"
                disabled={busy || sceneCount === 0}
                onClick={() => void doExport()}
              >
                {busy ? "Exportiere …" : "Exportieren …"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Checkbox-Baum: Abwählen eines Kapitels wählt dessen Teilbaum ab. */
function IncludeTree({
  nodes,
  included,
  setIncluded,
  depth = 0,
}: {
  nodes: BinderNode[];
  included: Set<string>;
  setIncluded: (s: Set<string>) => void;
  depth?: number;
}) {
  const toggle = (node: BinderNode, on: boolean) => {
    const next = new Set(included);
    for (const id of [node.id, ...allIds(node.children)]) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setIncluded(next);
  };

  return (
    <ul className="export-tree-list">
      {nodes.map((n) => (
        <li key={n.id} style={{ paddingLeft: depth * 16 }}>
          <label className="export-check">
            <input
              type="checkbox"
              checked={included.has(n.id)}
              onChange={(e) => toggle(n, e.target.checked)}
            />
            <span className={n.kind === "chapter" ? "export-chapter" : ""}>{n.title}</span>
          </label>
          {n.children.length > 0 && included.has(n.id) && (
            <IncludeTree
              nodes={n.children}
              included={included}
              setIncluded={setIncluded}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
