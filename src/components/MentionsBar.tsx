// Rückrichtung der Planungs-Tags: "wo im Text komme ich vor?"
//
// Sitzt unter dem Dokument einer Person oder eines Orts und zeigt
// jede Fundstelle mit dem getaggten Wort und dem umgebenden Satz.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { PLAN_TAG_LABEL, type PlanTagKind } from "../planTags";
import { useStore, type PaneId } from "../store";
import type { Mention } from "../types";
import { Icon } from "./Icon";

const SOURCE_ICON: Record<Mention["source"], string> = {
  scene: "📄",
  character: "👤",
  location: "📍",
};

export function MentionsBar({
  tagKind,
  id,
  paneId,
}: {
  tagKind: PlanTagKind;
  id: string;
  paneId: PaneId;
}) {
  const researchVersion = useStore((s) => s.researchVersion);
  const openSceneNextTo = useStore((s) => s.openSceneNextTo);
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setMentions(await api.listMentions(tagKind, id));
    } catch {
      // Die Rückverlinkung ist Zusatzinfo — ein Fehler darf nichts blockieren.
      setMentions([]);
    }
  }, [tagKind, id]);

  // Szenen werden verzögert gespeichert; frisch getippte Tags tauchen deshalb
  // erst beim nächsten Laden auf — dafür der Aktualisieren-Knopf.
  useEffect(() => {
    void load();
  }, [load, researchVersion]);

  function goTo(mention: Mention) {
    if (mention.source === "scene") {
      void openSceneNextTo(paneId, mention.sourceId);
    } else {
      void openResearchNextTo(
        paneId,
        mention.source === "character" ? "characters" : "locations",
        mention.sourceId,
      );
    }
  }

  const count = mentions?.length ?? 0;

  return (
    <div className="mentions">
      <div className="mentions-head">
        <button
          className="mentions-toggle"
          onClick={() => {
            setOpen(!open);
            if (!open) void load();
          }}
        >
          <span className="mentions-caret">
            <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
          </span>
          <Icon name="link-2" size={14} />
          {count === 1 ? "1 Erwähnung" : `${count} Erwähnungen`} im Text
        </button>
        <button title="Erwähnungen neu suchen" onClick={() => void load()}>
          <Icon name="rotate-cw" size={14} />
        </button>
      </div>
      {open && (
        <ul className="mentions-list">
          {count === 0 && (
            <li className="small muted">
              Noch nirgends verlinkt. Im Text „/
              {tagKind}&nbsp;“ tippen, um {PLAN_TAG_LABEL[tagKind]} zu verlinken.
            </li>
          )}
          {mentions?.map((mention, i) => (
            <li key={`${mention.sourceId}:${i}`}>
              <button onClick={() => goTo(mention)} title="Fundstelle öffnen">
                <span className="mentions-source">
                  {SOURCE_ICON[mention.source]} {mention.sourceTitle}
                  <span className="mentions-label">{mention.label}</span>
                </span>
                <span className="mentions-context small muted">{mention.context}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
