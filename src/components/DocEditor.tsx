// Generischer TipTap-Editor für eigenständige Dokumente (Personen- und
// Orts-Dokumente): lädt selbst, speichert debounced mit Konflikt-Erkennung und
// flusht beim Unmount — unabhängig von der Pane-Speicherlogik der Szenen.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { extraFlushers, useStore, type PaneId } from "../store";
import { docExtensions, getMarkdown, Toolbar, useEditorLanguage } from "./RichEditor";
import { imagePasteHandler } from "./DocImage";
import { PlanTagOverlay } from "./PlanTagOverlay";
import { EditorContextMenu } from "./EditorContextMenu";
import type { WriteResult } from "../types";

const AUTOSAVE_MS = 2000;

type Status = "saved" | "dirty" | "conflict";

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
  const [status, setStatusState] = useState<Status>("saved");
  // Refs, weil Timer, Unmount und `flushAll` den Stand außerhalb des Renderns
  // brauchen. Markdown entsteht erst beim Speichern, nicht bei jedem
  // Tastendruck: `edits` zählt die Änderungen, `savedEdits` den gesicherten Stand.
  const statusRef = useRef<Status>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const edits = useRef(0);
  const savedEdits = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const setStatus = (next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Nie zwei Schreibvorgänge gleichzeitig: ein laufender könnte sonst nach
    // dem neueren fertig werden und dessen Stand als „gespeichert“ melden.
    while (inFlight.current) await inFlight.current;
    const editor = editorRef.current;
    if (!editor || statusRef.current === "conflict" || edits.current === savedEdits.current) return;

    const seq = edits.current;
    const content = getMarkdown(editor);
    const run = (async () => {
      try {
        const result = await write(content);
        if (result.status === "conflict") {
          setStatus("conflict");
          return;
        }
        savedEdits.current = seq;
        // Wurde währenddessen weitergetippt, ist der Stand noch nicht gesichert.
        setStatus(edits.current === seq ? "saved" : "dirty");
      } catch (e) {
        useStore.setState({ error: String(e) });
      }
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [write]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Bei `flushAll` (Projekt schließen, Fenster schließen, Update …) mitspeichern
  // und beim Verlassen ungespeicherte Änderungen sichern.
  useEffect(() => {
    const flushForStore = () => flushRef.current();
    extraFlushers.add(flushForStore);
    return () => {
      extraFlushers.delete(flushForStore);
      void flushRef.current();
    };
  }, []);

  const editor = useEditor({
    extensions: docExtensions(),
    editorProps: { handlePaste: imagePasteHandler },
    content: initialContent,
    onUpdate: () => {
      edits.current++;
      // Ein offener Konflikt bleibt sichtbar, bis er entschieden ist.
      if (statusRef.current === "saved") setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    },
    onBlur: () => void flushRef.current(),
  });

  editorRef.current = editor;
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
                if (timer.current) clearTimeout(timer.current);
                editor.commands.setContent(c, { emitUpdate: false });
                savedEdits.current = edits.current;
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
              const seq = edits.current;
              const result = await write(getMarkdown(editor), true).catch((e) => {
                useStore.setState({ error: String(e) });
                return null;
              });
              if (!result) return;
              savedEdits.current = seq;
              setStatus(edits.current === seq ? "saved" : "dirty");
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
