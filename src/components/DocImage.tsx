// Inline-Bilder in Dokumenten (Szenen, Recherche): Markdown speichert den
// projektrelativen Pfad ("images/…"), die Anzeige löst ihn per Backend als
// data-URL auf — vermeidet Asset-Protocol-Scopes.

import { useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { api } from "../api";
import { useStore } from "../store";
import { cacheImage, getCachedImage } from "../imageCache";

function isExternal(src: string) {
  return src.startsWith("data:") || src.startsWith("http");
}

/** Löst einen projektrelativen Bildpfad ("images/…") als data-URL auf. */
export function useDocImage(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() =>
    !src ? null : isExternal(src) ? src : (getCachedImage(src) ?? null),
  );

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    if (isExternal(src)) {
      setResolved(src);
      return;
    }
    const hit = getCachedImage(src);
    if (hit) {
      setResolved(hit);
      return;
    }
    setResolved(null);
    let alive = true;
    void api
      .readDocImage(src)
      .then((url) => {
        if (url) cacheImage(src, url);
        if (alive) setResolved(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src]);

  return resolved;
}

function DocImageView({ node }: NodeViewProps) {
  const src: string = node.attrs.src ?? "";
  const resolved = useDocImage(src);

  return (
    <NodeViewWrapper className="doc-image" data-drag-handle>
      {resolved ? (
        <img src={resolved} alt={node.attrs.alt ?? ""} />
      ) : (
        <span className="doc-image-missing muted small">🖼 Bild ({src})</span>
      )}
    </NodeViewWrapper>
  );
}

export const DocImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DocImageView);
  },
});

/** Für `editorProps.handlePaste`: Bilder aus der Zwischenablage (Screenshots,
 *  kopierte Bilddateien) im Projekt speichern und an der Cursorposition einfügen. */
export function imagePasteHandler(view: EditorView, event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items;
  if (!items) return false;
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    event.preventDefault();
    void insertImageFile(view, file);
    return true;
  }
  return false;
}

async function insertImageFile(view: EditorView, file: File) {
  try {
    const rel = await saveClipboardImage(file);
    const imageType = view.state.schema.nodes.image;
    if (!imageType) return;
    view.dispatch(view.state.tr.replaceSelectionWith(imageType.create({ src: rel })));
  } catch (e) {
    useStore.setState({ error: String(e) });
  }
}

/** Speichert ein Bild aus der Zwischenablage im Projekt; liefert den rel. Pfad. */
export async function saveClipboardImage(file: File): Promise<string> {
  const ext = (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
  return api.saveDocImage(toBase64(await file.arrayBuffer()), ext);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
