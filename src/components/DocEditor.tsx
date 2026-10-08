// Generischer TipTap-Editor für eigenständige Dokumente (Personen- und
// Orts-Dokumente): lädt selbst und speichert über `useAutosave` — verzögert,
// mit Konflikt-Erkennung und beim Verlassen.

import { useEffect, useRef, useState, type RefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { SAVE_LABELS } from "../saving";
import { useStore, type PaneId } from "../store";
import { ConflictBanner } from "./ConflictBanner";
import { useAutosave } from "./useAutosave";
import { docExtensions, getMarkdown, Toolbar, useEditorLanguage } from "./RichEditor";
import { imagePasteHandler } from "./DocImage";
import { PlanTagOverlay } from "./PlanTagOverlay";
import { EditorContextMenu } from "./EditorContextMenu";
import type { WriteResult } from "../types";

const AUTOSAVE_MS = 2000;

/** Zuletzt gelesener bzw. gespeicherter Text pro docKey: ein schon einmal
 *  geöffnetes Dokument steht beim Wechsel sofort da, statt erst nach dem
 *  Lesen. Der Stand von der Platte wird im Hintergrund nachgeholt. */
const contentCache = new Map<string, string>();

/** Vom Editor bereitgestellt: gleicht den angezeigten Stand mit der Platte ab. */
type Reconcile = (disk: string) => void;

export function DocEditor({
  docKey,
  paneId,
  read,
  write,
}: {
  /** Eindeutig pro Dokument — Wechsel remountet den Editor. */
  docKey: string;
  /** Bereich, in dem dieses Dokument liegt (für Sprünge zu verlinkten Einträgen). */
  paneId: PaneId;
  read: () => Promise<string>;
  write: (content: string, force?: boolean) => Promise<WriteResult>;
}) {
  // Erst beim Lesen bekannt gewordener Text (kein Cache-Treffer).
  const [loaded, setLoaded] = useState<{ key: string; text: string } | null>(null);
  const reconcile = useRef<Reconcile | null>(null);
  const content =
    loaded?.key === docKey ? loaded.text : (contentCache.get(docKey) ?? null);

  useEffect(() => {
    let alive = true;
    const cached = contentCache.get(docKey);
    void read()
      .then((c) => {
        contentCache.set(docKey, c);
        if (!alive) return;
        if (cached === undefined) setLoaded({ key: docKey, text: c });
        else if (c !== cached) reconcile.current?.(c);
      })
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
    // read ist pro docKey stabil gemeint — bewusst nur docKey als Dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  if (content === null) return <DocEditorFrame />;
  return (
    <DocEditorInstance
      key={docKey}
      docKey={docKey}
      paneId={paneId}
      initialContent={content}
      reconcileRef={reconcile}
      read={read}
      write={write}
    />
  );
}

/** Rahmen ohne Inhalt, solange Text oder Editor noch nicht da sind:
 *  Werkzeugleiste (gesperrt), leere Seite, Statusleiste. Sonst blitzt beim
 *  Dokumentwechsel kurz der blanke Hintergrund auf. */
function DocEditorFrame() {
  return (
    <div className="doc-editor" aria-busy="true">
      <Toolbar editor={null} />
      <div className="editor-content doc-editor-content">
        <div className="ProseMirror" />
      </div>
      <footer className="statusbar">
        <span className="save-state saved">{SAVE_LABELS.saved}</span>
      </footer>
    </div>
  );
}

function DocEditorInstance({
  docKey,
  paneId,
  initialContent,
  reconcileRef,
  read,
  write,
}: {
  docKey: string;
  paneId: PaneId;
  initialContent: string;
  reconcileRef: RefObject<Reconcile | null>;
  read: () => Promise<string>;
  write: (content: string, force?: boolean) => Promise<WriteResult>;
}) {
  // Markdown entsteht erst beim Speichern, nicht bei jedem Tastendruck.
  const editorRef = useRef<Editor | null>(null);
  const edited = useRef(false);
  const { status, saver } = useAutosave({
    what: "Dieses Dokument",
    delayMs: AUTOSAVE_MS,
    snapshot: () => getMarkdown(editorRef.current!),
    write: async (content: string, force) => {
      const result = await write(content, force);
      if (result.status === "ok") contentCache.set(docKey, content);
      return result.status;
    },
    reload: async () => {
      const disk = await read();
      contentCache.set(docKey, disk);
      const ed = editorRef.current;
      if (!ed) return;
      // Inzwischen weitergetippt: das Banner entscheidet.
      if (saver.state !== "saved") {
        saver.raiseConflict();
        return;
      }
      if (disk !== getMarkdown(ed)) {
        ed.chain().setMeta("addToHistory", false).setContent(disk, { emitUpdate: false }).run();
      }
      saver.reset();
    },
  });

  const editor = useEditor({
    extensions: docExtensions(),
    editorProps: { handlePaste: imagePasteHandler },
    content: initialContent,
    onUpdate: () => {
      edited.current = true;
      saver.markDirty();
    },
    onBlur: () => void saver.flush(),
  });

  editorRef.current = editor;
  useEditorLanguage(editor);

  // Angezeigt wurde der Stand aus dem Cache; weicht die Platte ab (Sync,
  // externer Editor), still übernehmen — ohne Undo-Schritt zurück zum alten
  // Stand. Wurde schon getippt, entscheidet der Konflikt-Banner.
  useEffect(() => {
    reconcileRef.current = (disk) => {
      if (!editor) return;
      if (edited.current) {
        saver.raiseConflict();
        return;
      }
      editor.chain().setMeta("addToHistory", false).setContent(disk, { emitUpdate: false }).run();
    };
    return () => {
      reconcileRef.current = null;
    };
  }, [editor, reconcileRef, saver]);

  if (!editor) return <DocEditorFrame />;

  const loadExternal = async () => {
    try {
      const c = await read();
      contentCache.set(docKey, c);
      editor.commands.setContent(c, { emitUpdate: false });
      saver.reset();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  };

  return (
    <div className="doc-editor">
      {status === "conflict" && (
        <ConflictBanner
          what="Dieses Dokument"
          onReload={() => void loadExternal()}
          onOverwrite={() => void saver.overwrite()}
        />
      )}
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor-content doc-editor-content" />
      <PlanTagOverlay editor={editor} paneId={paneId} />
      <EditorContextMenu editor={editor} paneId={paneId} />
      <footer className="statusbar">
        <span className={`save-state ${status}`}>{SAVE_LABELS[status]}</span>
      </footer>
    </div>
  );
}
