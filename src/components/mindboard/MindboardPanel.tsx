// Mindboard als Pane-Inhalt: lädt das Board, speichert verzögert und führt
// den Verlauf. Alles Interaktive steckt in BoardCanvas.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { askLoadExternal } from "../../conflict";
import { extraFlushers, useStore, type PaneId } from "../../store";
import type { MindView, Mindboard } from "../../types";
import { BoardCanvas } from "./BoardCanvas";
import { History } from "./model";
import { loadView, storeView } from "./viewMemory";
import "./mindboard.css";

const SAVE_DELAY_MS = 400;
/** Die Ansicht wird beim Verschieben/Zoomen laufend gemeldet — seltener merken. */
const VIEW_DELAY_MS = 300;

export interface UpdateOptions {
  /** false = kein Schritt im Verlauf (Zwischenstände beim Ziehen). */
  history?: boolean;
  /** Stand, zu dem Rückgängig zurückkehrt; Standard: der aktuelle. */
  base?: Mindboard;
}

export function MindboardPanel({ boardId, paneId }: { boardId: string; paneId: PaneId }) {
  const [board, setBoard] = useState<Mindboard | null>(null);
  const boardRef = useRef<Mindboard | null>(null);
  const viewRef = useRef<MindView | null>(null);
  const historyRef = useRef(new History<Mindboard>());
  const [, setHistoryTick] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useStore((s) => s.mindboardVersion);
  const root = useStore((s) => s.project?.root ?? "");
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [name, setName] = useState("");

  // Solange die Konfliktfrage offen ist, wartet jedes weitere Speichern auf
  // die Antwort — sonst stapeln sich Dialoge.
  const conflictOpen = useRef<Promise<void> | null>(null);

  const save = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (conflictOpen.current) return conflictOpen.current;
    const current = boardRef.current;
    if (!current) return;
    // Die Ansicht lebt in viewMemory, nicht in der Datei (auch eine alte
    // `view` aus früheren Versionen verschwindet so beim nächsten Speichern).
    const latest = () => ({ ...(boardRef.current ?? current), view: null });
    const result = await api.saveMindboard(latest());
    if (result.status === "ok") return;

    conflictOpen.current = (async () => {
      if (await askLoadExternal(`Das Mindboard „${current.name}“`)) {
        const fresh = await api.loadMindboard(boardId);
        boardRef.current = fresh;
        historyRef.current = new History<Mindboard>();
        setBoard(fresh);
        setHistoryTick((t) => t + 1);
      } else {
        await api.saveMindboard(latest(), true);
      }
    })().finally(() => {
      conflictOpen.current = null;
    });
    return conflictOpen.current;
  }, [boardId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save().catch((e) => useStore.setState({ error: String(e) }));
    }, SAVE_DELAY_MS);
  }, [save]);

  useEffect(() => {
    let alive = true;
    void api
      .loadMindboard(boardId)
      .then((b) => {
        if (!alive) return;
        boardRef.current = b;
        const remembered = loadView(root, boardId);
        viewRef.current = remembered ?? b.view ?? null;
        // Boards aus früheren Versionen tragen die Ansicht noch in der Datei.
        if (!remembered && b.view) storeView(root, boardId, b.view);
        setBoard(b);
        setName(b.name);
      })
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
    // root wechselt nie, solange das Board offen ist (Projektwechsel schließt es).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Name folgt dem Umbenennen in der Seitenleiste.
  useEffect(() => {
    if (!version) return;
    let alive = true;
    void api
      .listMindboards()
      .then((l) => {
        const hit = l.find((b) => b.id === boardId);
        if (alive && hit) setName(hit.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version, boardId]);

  // Offene Änderungen beim Schließen des Panes und vor Projektwechseln sichern.
  useEffect(() => {
    const flush = async () => {
      if (saveTimer.current) await save().catch(() => {});
    };
    extraFlushers.add(flush);
    return () => {
      extraFlushers.delete(flush);
      // Gelöschte Boards lehnt das Backend ab — das ist hier kein Fehler.
      void flush();
      if (viewTimer.current) {
        clearTimeout(viewTimer.current);
        if (viewRef.current) storeView(root, boardId, viewRef.current);
      }
    };
  }, [save, root, boardId]);

  const update = useCallback(
    (next: Mindboard, opts: UpdateOptions = {}) => {
      const prev = opts.base ?? boardRef.current;
      if (!prev || prev === next) return;
      if (opts.history !== false) {
        historyRef.current.push(prev);
        setHistoryTick((t) => t + 1);
      }
      boardRef.current = next;
      setBoard(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onViewChange = useCallback(
    (view: MindView) => {
      viewRef.current = view;
      if (viewTimer.current) clearTimeout(viewTimer.current);
      viewTimer.current = setTimeout(() => {
        viewTimer.current = null;
        storeView(root, boardId, view);
      }, VIEW_DELAY_MS);
    },
    [root, boardId],
  );

  const step = useCallback(
    (dir: "undo" | "redo") => {
      const current = boardRef.current;
      if (!current) return;
      const h = historyRef.current;
      const next = dir === "undo" ? h.undo(current) : h.redo(current);
      if (!next) return;
      boardRef.current = next;
      setBoard(next);
      setHistoryTick((t) => t + 1);
      scheduleSave();
    },
    [scheduleSave],
  );

  if (!board) {
    return <div className="mindboard muted small mb-loading">Lade Mindboard …</div>;
  }

  return (
    <BoardCanvas
      board={board}
      name={name}
      paneId={paneId}
      update={update}
      getBoard={() => boardRef.current!}
      initialView={viewRef.current}
      onViewChange={onViewChange}
      undo={() => step("undo")}
      redo={() => step("redo")}
      canUndo={historyRef.current.canUndo}
      canRedo={historyRef.current.canRedo}
    />
  );
}
