// Oberfläche der Planungs-Tags: das Suchfeld (nach "/person " oder aus dem
// Rechtsklick-Menü für markierten Text) und die Namensvorschau beim
// Überfahren eines fertigen Tags.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { api } from "../api";
import {
  PLAN_TAG_ICON,
  PLAN_TAG_LABEL,
  PLAN_TAG_RESEARCH,
  type PlanTagKind,
} from "../planTags";
import { useStore, type PaneId, type PlanIndexEntry } from "../store";
import {
  cancelPlanTagCommand,
  choosePlanTagTarget,
  getPlanTagCommandState,
  type PlanTagCommandState,
} from "./planTagCommand";
import { removePlanTagAt } from "./PlanTag";
import { cachedPlanTagAvatar, loadPlanTagAvatar, planTagName } from "./planTagInfo";
import type { EntityKind } from "../types";

export function PlanTagOverlay({ editor, paneId }: { editor: Editor; paneId: PaneId }) {
  const command = usePlanTagCommand(editor);
  return (
    <>
      {command?.phase === "picker" && (
        // key: jedes neue Kommando startet mit leerem Suchfeld.
        <PlanTagPicker
          key={`${command.kind}:${command.from}`}
          editor={editor}
          kind={command.kind}
          pos={command.from}
        />
      )}
      <PlanTagTooltip editor={editor} paneId={paneId} />
    </>
  );
}

function usePlanTagCommand(editor: Editor): PlanTagCommandState {
  const [command, setCommand] = useState<PlanTagCommandState>(null);
  useEffect(() => {
    const update = () => setCommand(getPlanTagCommandState(editor.state));
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  return command;
}

/** Bildschirmposition einer Dokumentstelle; null, wenn sie nicht (mehr) sichtbar ist. */
function useCaretCoords(editor: Editor, pos: number) {
  return useMemo(() => {
    try {
      return editor.view.coordsAtPos(pos);
    } catch {
      return null;
    }
    // Die Position ist für die Lebensdauer des Popups fest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pos]);
}

const POPUP_WIDTH = 260;

function PlanTagPicker({
  editor,
  kind,
  pos,
}: {
  editor: Editor;
  kind: PlanTagKind;
  pos: number;
}) {
  const items = useStore((s) => s.planIndex[PLAN_TAG_RESEARCH[kind]]);
  const touchResearch = useStore((s) => s.touchResearch);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Verhindert, dass der Fokuswechsel zurück in den Editor als Abbruch gilt.
  const closing = useRef(false);
  const coords = useCaretCoords(editor, pos);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 &&
    !items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase());
  const optionCount = filtered.length + (canCreate ? 1 : 0);
  const index = optionCount === 0 ? 0 : Math.min(active, optionCount - 1);

  function choose(entry: PlanIndexEntry) {
    closing.current = true;
    choosePlanTagTarget(editor, entry.id, entry.name);
  }

  async function createAndChoose() {
    closing.current = true;
    try {
      if (kind === "note") {
        const notes = await api.createNote(trimmed);
        const created = notes[notes.length - 1];
        touchResearch();
        if (created) choosePlanTagTarget(editor, created.id, created.title);
      } else {
        const research = PLAN_TAG_RESEARCH[kind] as EntityKind;
        const created = await api.saveEntity(research, { id: "", name: trimmed });
        touchResearch();
        choosePlanTagTarget(editor, created.id, created.name);
      }
    } catch (e) {
      useStore.setState({ error: String(e) });
      cancelPlanTagCommand(editor);
    }
  }

  function confirm() {
    if (index < filtered.length) {
      choose(filtered[index]);
    } else if (canCreate) {
      void createAndChoose();
    }
  }

  function cancel() {
    closing.current = true;
    cancelPlanTagCommand(editor);
  }

  if (!coords) return null;

  const flipUp = coords.bottom > window.innerHeight - 220;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(coords.left, window.innerWidth - POPUP_WIDTH - 8)),
    top: flipUp ? coords.top - 6 : coords.bottom + 6,
    width: POPUP_WIDTH,
    transform: flipUp ? "translateY(-100%)" : undefined,
  };

  return (
    <div className="plan-tag-popup" style={style}>
      <div className="plan-tag-popup-head small muted">
        {PLAN_TAG_ICON[kind]} {PLAN_TAG_LABEL[kind]} verlinken
      </div>
      <input
        ref={inputRef}
        value={query}
        placeholder="Suchen …"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => {
          if (!closing.current) cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (optionCount === 0 ? 0 : (Math.min(a, optionCount - 1) + 1) % optionCount));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) =>
              optionCount === 0 ? 0 : (Math.min(a, optionCount - 1) + optionCount - 1) % optionCount,
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
      <ul className="plan-tag-results">
        {filtered.map((entry, i) => (
          <li key={entry.id}>
            <button
              className={i === index ? "on" : ""}
              // Fokus muss im Suchfeld bleiben, sonst gilt der Klick als Abbruch.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(entry)}
            >
              {entry.name}
            </button>
          </li>
        ))}
        {canCreate && (
          <li>
            <button
              className={index === filtered.length ? "on" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(filtered.length)}
              onClick={() => void createAndChoose()}
            >
              + „{trimmed}“ neu anlegen
            </button>
          </li>
        )}
        {optionCount === 0 && (
          <li className="plan-tag-empty-hint small muted">
            Noch keine {PLAN_TAG_LABEL[kind]} angelegt.
          </li>
        )}
      </ul>
    </div>
  );
}

interface HoverTarget {
  kind: PlanTagKind;
  id: string;
  rect: DOMRect;
  /** Für „Verknüpfung lösen“ — veraltete Knoten fängt `removePlanTagAt` ab. */
  el: HTMLElement;
}

function PlanTagTooltip({ editor, paneId }: { editor: Editor; paneId: PaneId }) {
  const planIndex = useStore((s) => s.planIndex);
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useMemo(
    () => (kind: PlanTagKind, id: string) => {
      setTarget(null);
      void openResearchNextTo(paneId, PLAN_TAG_RESEARCH[kind], id);
    },
    [openResearchNextTo, paneId],
  );

  useEffect(() => {
    const dom = editor.view.dom;

    const tagAt = (node: EventTarget | null) =>
      node instanceof Element
        ? (node.closest(".plan-tag[data-plan-id]") as HTMLElement | null)
        : null;

    const onOver = (e: Event) => {
      const el = tagAt(e.target);
      if (!el) return;
      const id = el.getAttribute("data-plan-id");
      const kind = el.getAttribute("data-plan-tag") as PlanTagKind | null;
      if (!id || !kind) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (showTimer.current) clearTimeout(showTimer.current);
      showTimer.current = setTimeout(
        () => setTarget({ kind, id, el, rect: el.getBoundingClientRect() }),
        180,
      );
    };

    const onOut = (e: MouseEvent) => {
      const el = tagAt(e.target);
      if (!el || el.contains(e.relatedTarget as Node)) return;
      if (showTimer.current) clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => setTarget(null), 250);
    };

    const onClick = (e: MouseEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const el = tagAt(e.target);
      const id = el?.getAttribute("data-plan-id");
      const kind = el?.getAttribute("data-plan-tag") as PlanTagKind | null;
      if (!id || !kind) return;
      e.preventDefault();
      open(kind, id);
    };

    // Beim Scrollen wandert der Tag weg — die gemerkte Position stimmt dann nicht mehr.
    const onScroll = () => setTarget(null);

    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    dom.addEventListener("click", onClick);
    dom.parentElement?.addEventListener("scroll", onScroll, true);
    return () => {
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
      dom.removeEventListener("click", onClick);
      dom.parentElement?.removeEventListener("scroll", onScroll, true);
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [editor, open]);

  useEffect(() => {
    if (!target) {
      setAvatar(null);
      return;
    }
    setAvatar(cachedPlanTagAvatar(target.kind, target.id));
    let alive = true;
    void loadPlanTagAvatar(target.kind, target.id, planIndex).then((img) => {
      if (alive) setAvatar(img);
    });
    return () => {
      alive = false;
    };
  }, [target, planIndex]);

  if (!target) return null;

  const name = planTagName(target.kind, target.id, planIndex);
  const flipUp = target.rect.bottom > window.innerHeight - 140;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(target.rect.left, window.innerWidth - 280)),
    top: flipUp ? target.rect.top - 6 : target.rect.bottom + 6,
    transform: flipUp ? "translateY(-100%)" : undefined,
  };

  return (
    <div
      className="plan-tag-tooltip"
      style={style}
      onMouseEnter={() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => setTarget(null)}
    >
      {avatar && <img className="plan-tag-avatar" src={avatar} alt="" />}
      <div className="plan-tag-tooltip-text">
        <span className="small muted">
          {PLAN_TAG_ICON[target.kind]} {PLAN_TAG_LABEL[target.kind]}
        </span>
        <span className="plan-tag-tooltip-name">
          {name ?? "Eintrag nicht gefunden"}
        </span>
      </div>
      <div className="plan-tag-tooltip-actions">
        {name && (
          <button
            title="Im Nebenbereich öffnen (Strg+Klick)"
            onClick={() => open(target.kind, target.id)}
          >
            Öffnen
          </button>
        )}
        <button
          title="Verknüpfung lösen — das Wort bleibt im Text stehen"
          onClick={() => {
            removePlanTagAt(editor, target.el);
            setTarget(null);
          }}
        >
          Lösen
        </button>
      </div>
    </div>
  );
}
