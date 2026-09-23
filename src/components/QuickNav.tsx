import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { flattenTree } from "../tree";
import type { BinderNode, SearchHit } from "../types";
import { Icon, type IconName } from "./Icon";

/** Stabile Referenz — `?? []` im Selector würde jedes Mal ein neues Array
 *  liefern und eine Endlos-Render-Schleife auslösen. */
const NO_BINDER: BinderNode[] = [];

const KIND_ICON: Record<SearchHit["kind"], IconName> = {
  scene: "file-text",
  character: "user",
  location: "map-pin",
  event: "clock",
};

type Item =
  | { type: "node"; id: string; kind: "chapter" | "scene"; title: string; sub: string }
  | { type: "hit"; hit: SearchHit };

export function QuickNav() {
  const open = useStore((s) => s.quickNavOpen);
  const setOpen = useStore((s) => s.setQuickNavOpen);
  const binder = useStore((s) => s.project?.meta.binder ?? NO_BINDER);
  const selectScene = useStore((s) => s.selectScene);
  const selectChapter = useStore((s) => s.selectChapter);
  const openResearchInPane = useStore((s) => s.openResearchInPane);
  const setPaneTimeline = useStore((s) => s.setPaneTimeline);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Titel-Treffer (sofort, aus dem Binder-Baum)
  const nodeItems = useMemo<Item[]>(() => {
    const all = flattenTree(binder);
    const q = query.toLowerCase().trim();
    const matches = q
      ? all.filter(
          ({ node, path }) =>
            node.title.toLowerCase().includes(q) ||
            path.join(" ").toLowerCase().includes(q),
        )
      : all;
    return matches.slice(0, 20).map(({ node, path }) => ({
      type: "node",
      id: node.id,
      kind: node.kind,
      title: node.title,
      sub: path.join(" › "),
    }));
  }, [binder, query]);

  // Volltext-Treffer (debounced, über SQLite-FTS)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void api
        .searchProject(q)
        .then(setHits)
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Volltexttreffer, die schon als Titeltreffer gelistet sind, nicht doppeln.
  const items = useMemo<Item[]>(() => {
    const nodeIds = new Set(
      nodeItems.map((n) => (n.type === "node" ? n.id : "")),
    );
    return [
      ...nodeItems,
      ...hits
        .filter((h) => !(h.kind === "scene" && nodeIds.has(h.id)))
        .map<Item>((hit) => ({ type: "hit", hit })),
    ];
  }, [nodeItems, hits]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  if (!open) return null;

  function pick(index: number) {
    const item = items[index];
    if (!item) return;
    setOpen(false);
    if (item.type === "node") {
      if (item.kind === "scene") void selectScene(item.id);
      else void selectChapter(item.id);
      return;
    }
    const { kind, id } = item.hit;
    const activePane = useStore.getState().activePane;
    if (kind === "scene") void selectScene(id);
    else if (kind === "character") void openResearchInPane(activePane, "characters", id);
    else if (kind === "location") void openResearchInPane(activePane, "locations", id);
    else if (kind === "event") void setPaneTimeline(activePane, true);
  }

  return (
    <div className="quicknav-overlay" onClick={() => setOpen(false)}>
      <div className="quicknav" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Suchen: Dokumente, Personen, Orte, Volltext …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(selected);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <ul>
          {items.map((item, i) => (
            <li
              key={item.type === "node" ? `n-${item.id}` : `h-${item.hit.kind}-${item.hit.id}`}
              className={i === selected ? "selected" : ""}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(i)}
            >
              {item.type === "node" ? (
                <>
                  <span>
                    <Icon name={item.kind === "chapter" ? "folder" : "file-text"} size={14} />
                    {item.title}
                  </span>
                  {item.sub && <span className="muted small">{item.sub}</span>}
                </>
              ) : (
                <>
                  <span>
                    <Icon name={KIND_ICON[item.hit.kind]} size={14} />
                    {item.hit.title}
                  </span>
                  <span
                    className="muted small snippet"
                    dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.hit.snippet) }}
                  />
                </>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="muted">Keine Treffer</li>}
        </ul>
      </div>
    </div>
  );
}

/** Snippet kommt aus dem FTS-Index mit <b>-Markierung; alles andere escapen. */
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}
