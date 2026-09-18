// Generischer TipTap-Editor für eigenständige Dokumente (Notizen, Personen-/
// Orts-Dokumente): lädt selbst, speichert debounced mit Konflikt-Erkennung und
// flusht beim Unmount — unabhängig von der Pane-Speicherlogik der Szenen.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useStore, type PaneId } from "../store";
import { docExtensions, getMarkdown, Toolbar, useEditorLanguage } from "./RichEditor";
import { imagePasteHandler } from "./DocImage";
import { PlanTagOverlay } from "./PlanTagOverlay";
import { EditorContextMenu } from "./EditorContextMenu";
import type { WriteResult } from "../types";

const AUTOSAVE_MS = 2000;

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
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    void read()
      .then((c) => {
        if (alive) setContent(c);
      })
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
    // read ist pro docKey stabil gemeint — bewusst nur docKey als Dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  if (content === null) return <div className="doc-editor" />;
  return (
    <DocEditorInstance
      key={docKey}
      paneId={paneId}
      initialContent={content}
      read={read}
      write={write}
    />
  );
}

function DocEditorInstance({
  paneId,
  initialContent,
  read,
  write,
}: {
  paneId: PaneId;
  initialContent: string;
  read: () => Promise<string>;
  write: (content: string, force?: boolean) => Promise<WriteResult>;
}) {
  const [status, setStatus] = useState<"saved" | "dirty" | "conflict">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initialContent);
  const statusRef = useRef(status);
  statusRef.current = status;

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const result = await write(latest.current);
      setStatus(result.status === "conflict" ? "conflict" : "saved");
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }, [write]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // Beim Verlassen ungespeicherte Änderungen sichern.
      if (statusRef.current === "dirty") void flushRef.current();
    };
  }, []);

  const editor = useEditor({
    extensions: docExtensions(),
    editorProps: { handlePaste: imagePasteHandler },
    content: initialContent,
    onUpdate: ({ editor }) => {
      latest.current = getMarkdown(editor);
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    },
    onBlur: () => {
      if (statusRef.current === "dirty") void flushRef.current();
    },
  });

  useEditorLanguage(editor);

  if (!editor) return null;

  return (
    <div className="doc-editor">
      {status === "conflict" && (
        <div className="banner warning">
          <span>Dieses Dokument wurde außerhalb der App verändert.</span>
          <button
            onClick={async () => {
              try {
                const c = await read();
                latest.current = c;
                editor.commands.setContent(c);
                setStatus("saved");
              } catch (e) {
                useStore.setState({ error: String(e) });
              }
            }}
          >
            Externe Version laden (eigene Änderungen verwerfen)
          </button>
          <button
            onClick={async () => {
              const result = await write(latest.current, true).catch((e) => {
                useStore.setState({ error: String(e) });
                return null;
              });
              if (result) setStatus("saved");
            }}
          >
            Eigene Version behalten (extern überschreiben)
          </button>
        </div>
      )}
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor-content doc-editor-content" />
      <PlanTagOverlay editor={editor} paneId={paneId} />
      <EditorContextMenu editor={editor} paneId={paneId} />
      <footer className="statusbar">
        <span>
          {status === "saved"
            ? "Gespeichert"
            : status === "dirty"
              ? "Ungespeichert …"
              : "⚠ Konflikt"}
        </span>
      </footer>
    </div>
  );
}
