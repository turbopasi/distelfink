import { useEffect, useMemo, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useStore, type PaneId } from "../store";
import {
  addStats,
  computeStats,
  emptyStats,
  formatNorm,
  subStats,
  type TextStats,
} from "../stats";
import { collectSceneIds, findNode, findParentAndIndex } from "../tree";
import { DocBackdrop } from "./DocBackdrop";
import { DocImage, imagePasteHandler } from "./DocImage";
import { PlanTag } from "./PlanTag";
import { PlanTagCommand } from "./planTagCommand";
import { PlanTagOverlay } from "./PlanTagOverlay";
import { EditorContextMenu } from "./EditorContextMenu";
import { SceneBreak, SCENE_BREAK_NODE } from "./SceneBreak";
import { Icon } from "./Icon";
import {
  AlignedHeading,
  AlignedParagraph,
  MarkdownTextAlign,
} from "./TextAlignMarkdown";

/** Ob gerade woanders aktiv getippt wird (z. B. Umbenennen im Binder) — dann
 *  darf ein Editor sich nicht per Autofocus/Sprung den Fokus greifen. */
function isTypingElsewhere(editor: Editor): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable) &&
    !editor.view.dom.contains(active)
  );
}

/** Gemeinsame Extensions aller Dokument-Editoren (Szenen wie Recherche). */
export function docExtensions() {
  return [
    // Paragraph/Heading kommen als Varianten mit Ausrichtungs-Serialisierung.
    StarterKit.configure({ paragraph: false, heading: false }),
    AlignedParagraph,
    AlignedHeading.configure({ levels: [1, 2, 3] }),
    // html: true, damit die div-Wrapper der Ausrichtung beim Laden greifen.
    Markdown.configure({ html: true }),
    MarkdownTextAlign.configure({ types: ["heading", "paragraph"] }),
    DocImage,
    // Planungs-Tags (/person, /location, /note) samt Slash-Kommando.
    PlanTag,
    PlanTagCommand,
  ];
}

/** Schreibt Sprache und Rechtschreibprüfung an das contenteditable.
 *
 *  Als Effekt und nicht über `editorProps.attributes`, weil die Optionen von
 *  `useEditor` nicht reaktiv sind — eine Änderung in den Einstellungen soll
 *  greifen, ohne den Editor neu aufzubauen (das würde den Undo-Stack kosten).
 *  Die Sprache steuert zugleich das Trennwörterbuch der WebView. */
export function useEditorLanguage(editor: Editor | null) {
  const language = useStore((s) => s.settings.editor.language);
  const spellcheck = useStore((s) => s.settings.editor.spellcheck);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.lang = language;
    editor.view.dom.spellcheck = spellcheck;
  }, [editor, language, spellcheck]);
}

export function RichEditor({ paneId }: { paneId: PaneId }) {
  const pane = useStore((s) => s.panes[paneId]);
  const isActive = useStore((s) => s.activePane === paneId && s.layoutMode !== "single");
  const setActivePane = useStore((s) => s.setActivePane);

  return (
    <section
      className={`editor ${isActive ? "pane-active" : ""}`}
      onFocusCapture={() => setActivePane(paneId)}
      onMouseDownCapture={() => setActivePane(paneId)}
    >
      <DocBackdrop />
      {pane.sceneId ? (
        <EditorInstance
          // Ein Fluss bleibt beim Wechsel innerhalb des Kapitels stehen.
          key={`${pane.flowIds.join("|") || pane.sceneId}:${pane.loadCounter}`}
          paneId={paneId}
          initialContent={pane.content}
        />
      ) : (
        <div className="editor empty">
          <p className="muted">
            Wähle in der Sidebar ein Dokument oder ein Modul für diesen Bereich aus.
          </p>
        </div>
      )}
    </section>
  );
}

/** Pro Szene neu gemountet (via key) → frischer Undo/Redo-Stack pro Dokument. */
function EditorInstance({
  paneId,
  initialContent,
}: {
  paneId: PaneId;
  initialContent: string;
}) {
  const setContent = useStore((s) => s.setContent);

  const editor = useEditor({
    // SceneBreak nur hier: eigenständige Dokumente (Notizen, Personen) kennen
    // keine Szenengrenzen.
    extensions: [...docExtensions(), SceneBreak],
    editorProps: { handlePaste: imagePasteHandler },
    content: initialContent,
    // Kein autofocus: true — das würde beim Neuaufbau des Editors (z. B. wenn
    // im Fluss-Modus ein Wechsel in eine andere „Wurst“ das Nachladen der
    // Szenen anstößt) den Fokus reißen, selbst wenn woanders gerade aktiv
    // getippt wird (z. B. Umbenennen im Binder). Stattdessen unten manuell
    // und mit Rücksicht darauf fokussieren.
    onUpdate: ({ editor }) => {
      setContent(paneId, getMarkdown(editor));
      if (useStore.getState().typewriter) centerCaret(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      if (useStore.getState().typewriter) centerCaret(editor);
    },
  });

  useEditorLanguage(editor);

  const typewriter = useStore((s) => s.typewriter);
  const focusScene = useStore((s) => s.panes[paneId].sceneId);
  const focusCounter = useStore((s) => s.panes[paneId].focusCounter);

  // Im Fluss zur ausgewählten Szene springen (Binder-Klick, Fundstelle …).
  useEffect(() => {
    if (!editor || !focusScene) return;
    let pos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === SCENE_BREAK_NODE && node.attrs.sceneId === focusScene) {
        pos = offset + node.nodeSize;
      }
    });
    if (pos < 0) return;
    // Kein Fokus-Klau, während woanders aktiv getippt wird (z. B. Umbenennen
    // im Binder) — sonst reißt der Sprung dem Eingabefeld den Fokus weg.
    if (isTypingElsewhere(editor)) {
      editor.chain().setTextSelection(pos).scrollIntoView().run();
      return;
    }
    editor.chain().focus(pos).scrollIntoView().run();
  }, [editor, focusScene, focusCounter]);

  // Einmaliger Autofocus pro Editor-Instanz (Neuaufbau bei Szenen-/Fluss-
  // Wechsel) — außer es wird gerade woanders aktiv getippt (z. B. Umbenennen
  // im Binder, das per Doppelklick genau so einen Wechsel auslöst).
  useEffect(() => {
    if (!editor) return;
    if (isTypingElsewhere(editor)) return;
    editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  return (
    <>
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className={`editor-content ${typewriter ? "typewriter" : ""}`}
      />
      <PlanTagOverlay editor={editor} paneId={paneId} />
      <EditorContextMenu editor={editor} paneId={paneId} />
      <StatusBar editor={editor} paneId={paneId} />
    </>
  );
}

/** tiptap-markdown liefert keine Storage-Typen für sein Editor-Storage-Feld. */
export function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
}

function centerCaret(editor: Editor) {
  requestAnimationFrame(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.head);
    const el = node instanceof Text ? node.parentElement : (node as HTMLElement);
    el?.scrollIntoView({ block: "center" });
  });
}

/** Balken-Icon für die Ausrichtungs-Buttons. */
function AlignIcon({ variant }: { variant: "left" | "center" | "right" | "justify" }) {
  const widths: Record<string, [number, number, number, number]> = {
    left: [12, 8, 12, 8],
    center: [12, 8, 12, 8],
    right: [12, 8, 12, 8],
    justify: [12, 12, 12, 12],
  };
  const x = (w: number) =>
    variant === "center" ? (12 - w) / 2 : variant === "right" ? 12 - w : 0;
  return (
    <svg width="12" height="11" viewBox="0 0 12 11" aria-hidden="true">
      {widths[variant].map((w, i) => (
        <rect key={i} x={x(w)} y={i * 3} width={w} height="1.6" rx="0.8" fill="currentColor" />
      ))}
    </svg>
  );
}

export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      alignLeft: editor.isActive({ textAlign: "left" }),
      alignCenter: editor.isActive({ textAlign: "center" }),
      alignRight: editor.isActive({ textAlign: "right" }),
      alignJustify: editor.isActive({ textAlign: "justify" }),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  // Ohne explizite Absatz-Ausrichtung gilt die Grundeinstellung aus den
  // Editor-Einstellungen — die Buttons zeigen die tatsächliche Darstellung.
  const defaultAlignment = useStore((s) => s.settings.editor.defaultAlignment);
  const explicitAlign = state.alignLeft
    ? "left"
    : state.alignCenter
      ? "center"
      : state.alignRight
        ? "right"
        : state.alignJustify
          ? "justify"
          : null;
  const effectiveAlign = explicitAlign ?? defaultAlignment;

  const btn = (
    label: ReactNode,
    title: string,
    active: boolean,
    action: () => void,
    disabled = false,
  ) => (
    <button
      className={active ? "on" : ""}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* Fokus bleibt im Editor */}
      onClick={action}
    >
      {label}
    </button>
  );

  const chain = () => editor.chain().focus();

  return (
    <div className="toolbar">
      {btn(<Icon name="bold" size={14} />, "Fett (Strg+B)", state.bold, () =>
        chain().toggleBold().run(),
      )}
      {btn(<Icon name="italic" size={14} />, "Kursiv (Strg+I)", state.italic, () =>
        chain().toggleItalic().run(),
      )}
      <span className="sep" />
      {btn("H1", "Überschrift 1", state.h1, () => chain().toggleHeading({ level: 1 }).run())}
      {btn("H2", "Überschrift 2", state.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn("H3", "Überschrift 3", state.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {btn(<Icon name="pilcrow" size={14} />, "Absatz", false, () =>
        chain().setParagraph().run(),
      )}
      <span className="sep" />
      {btn(
        <AlignIcon variant="left" />,
        "Linksbündig",
        effectiveAlign === "left",
        () => chain().toggleTextAlign("left").run(),
      )}
      {btn(
        <AlignIcon variant="center" />,
        "Zentriert",
        effectiveAlign === "center",
        () => chain().toggleTextAlign("center").run(),
      )}
      {btn(
        <AlignIcon variant="right" />,
        "Rechtsbündig",
        effectiveAlign === "right",
        () => chain().toggleTextAlign("right").run(),
      )}
      {btn(
        <AlignIcon variant="justify" />,
        "Blocksatz",
        effectiveAlign === "justify",
        () => chain().toggleTextAlign("justify").run(),
      )}
      <span className="sep" />
      {btn(
        <Icon name="undo-2" size={14} />,
        "Rückgängig (Strg+Z)",
        false,
        () => chain().undo().run(),
        !state.canUndo,
      )}
      {btn(
        <Icon name="redo-2" size={14} />,
        "Wiederholen (Strg+Y)",
        false,
        () => chain().redo().run(),
        !state.canRedo,
      )}
    </div>
  );
}

function StatusBar({ editor, paneId }: { editor: Editor; paneId: PaneId }) {
  const saveState = useStore((s) => s.panes[paneId].saveState);
  const sceneId = useStore((s) => s.panes[paneId].sceneId);
  const setHistoryFor = useStore((s) => s.setHistoryFor);
  const normVariant = useStore((s) => s.normVariant);
  const setNormVariant = useStore((s) => s.setNormVariant);
  const typewriter = useStore((s) => s.typewriter);
  const toggleTypewriter = useStore((s) => s.toggleTypewriter);
  const flowMode = useStore((s) => s.flowMode);
  const toggleFlowMode = useStore((s) => s.toggleFlowMode);
  const flowIds = useStore((s) => s.panes[paneId].flowIds);

  const text = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor.state.doc
        .textBetween(0, editor.state.doc.content.size, "\n", "\n")
        // Leerzeilen (u. a. die Szenentrenner) sind keine Absätze.
        .split("\n")
        .filter((line) => line.trim())
        .join("\n"),
  });
  // Szene, in der der Cursor steht — im Fluss Bezug für Verlauf und Titel.
  const caretSceneId = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from } = editor.state.selection;
      let id: string | null = null;
      editor.state.doc.forEach((node, offset) => {
        if (offset <= from && node.type.name === SCENE_BREAK_NODE) id = node.attrs.sceneId;
      });
      return id;
    },
  });
  const stats = useMemo(() => computeStats(text), [text]);
  const norm = normVariant === "1800" ? stats.norm1800 : stats.norm30x60;

  const binder = useStore((s) => s.project?.meta.binder);
  const sceneStats = useStore((s) => s.sceneStats);
  // Gesamtes Manuskript: gespeicherte Zählungen aller Szenen, für die offene
  // Szene aber der Live-Stand aus diesem Editor (andere Bereiche folgen beim
  // nächsten automatischen Speichern).
  const total = useMemo(() => {
    if (!binder) return null;
    const saved = collectSceneIds(binder).reduce(
      (sum, id) => addStats(sum, sceneStats[id] ?? emptyStats()),
      emptyStats(),
    );
    // Was dieser Editor zeigt, zählt live statt aus dem Cache.
    const open = flowIds.length ? flowIds : sceneId ? [sceneId] : [];
    const own = open.reduce(
      (sum, id) => addStats(sum, sceneStats[id] ?? emptyStats()),
      emptyStats(),
    );
    return addStats(subStats(saved, own), stats);
  }, [binder, sceneStats, sceneId, flowIds, stats]);
  const totalNorm = (t: TextStats) => (normVariant === "1800" ? t.norm1800 : t.norm30x60);

  // Im Fluss beziehen sich die linken Zahlen auf das Kapitel, der Verlauf auf
  // die Szene am Cursor.
  const historyScene = caretSceneId ?? sceneId;
  const historyTitle = useMemo(
    () => (binder && historyScene ? (findNode(binder, historyScene)?.title ?? "") : ""),
    [binder, historyScene],
  );
  const chapterTitle = useMemo(() => {
    if (!binder || !sceneId) return "Ordner";
    const parentId = findParentAndIndex(binder, sceneId)?.parentId;
    return (parentId && findNode(binder, parentId)?.title) || "Manuskript";
  }, [binder, sceneId]);

  // Sammel-Tooltip der Zahlengruppe: hält die Werte erreichbar, die in
  // schmalen Bereichen ausgeblendet werden (Zeichen, Gesamtzahlen).
  const statsTitle = useMemo(() => {
    const lines = [
      `${stats.words.toLocaleString("de-DE")} Wörter`,
      `${stats.charsWithSpaces.toLocaleString("de-DE")} / ` +
        `${stats.charsWithoutSpaces.toLocaleString("de-DE")} Zeichen ` +
        "(mit / ohne Leerzeichen)",
      `${formatNorm(norm)} Normseiten`,
    ];
    if (total) {
      lines.push(
        `Gesamtes Manuskript: ${total.words.toLocaleString("de-DE")} Wörter · ` +
          `${total.charsWithSpaces.toLocaleString("de-DE")} / ` +
          `${total.charsWithoutSpaces.toLocaleString("de-DE")} Zeichen · ` +
          `${formatNorm(totalNorm(total))} Normseiten`,
      );
    }
    return lines.join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, norm, total, normVariant]);

  const saveLabel: Record<string, string> = {
    saved: "Gespeichert",
    dirty: "Ungespeichert …",
    saving: "Speichert …",
    conflict: "Konflikt",
  };

  return (
    <footer className="statusbar">
      <span className={`save-state ${saveState}`}>{saveLabel[saveState]}</span>
      <span className="spacer" />
      <div className="sb-stats" title={statsTitle}>
        {flowIds.length > 0 && <span className="stats-scope">{chapterTitle}</span>}
        <span className="sb-words">{stats.words.toLocaleString("de-DE")} Wörter</span>
        <span className="sb-chars" title="Zeichen inkl. Leerzeichen / ohne Leerzeichen">
          {stats.charsWithSpaces.toLocaleString("de-DE")} /{" "}
          {stats.charsWithoutSpaces.toLocaleString("de-DE")} Zeichen
        </span>
        <span className="sb-pages">
          {formatNorm(norm)} Normseiten{" "}
          <select
            value={normVariant}
            onChange={(e) => setNormVariant(e.target.value as "1800" | "30x60")}
            title="Normseiten-Zählweise"
          >
            <option value="1800">1800 Zeichen</option>
            <option value="30x60">30 × 60</option>
          </select>
        </span>
        {total && (
          <span className="total-stats">
            Gesamt {total.words.toLocaleString("de-DE")} Wörter ·{" "}
            {formatNorm(totalNorm(total))} Normseiten
          </span>
        )}
      </div>
      <div className="sb-actions">
        <button
          className={flowMode ? "on" : ""}
          title="Fluss: alle Dokumente des Ordners am Stück bearbeiten"
          onClick={() => void toggleFlowMode()}
        >
          <Icon name="book-open" size={14} />
        </button>
        <button
          className={typewriter ? "on" : ""}
          title="Typewriter-Scrolling: Cursorzeile bleibt mittig"
          onClick={toggleTypewriter}
        >
          <Icon name="keyboard" size={14} />
        </button>
        <button
          title={
            historyScene
              ? `Verlauf von "${historyTitle}": frühere Versionen ansehen und wiederherstellen`
              : "Verlauf: frühere Versionen ansehen und wiederherstellen"
          }
          onClick={() => historyScene && setHistoryFor(historyScene)}
        >
          <Icon name="history" size={14} />
          <span className="sb-label">Verlauf</span>
        </button>
      </div>
    </footer>
  );
}
