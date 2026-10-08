// @vitest-environment jsdom
// Roundtrip der Textausrichtung: Editor → Markdown → Editor → Markdown.
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { AlignedHeading, AlignedParagraph, MarkdownTextAlign } from "./TextAlignMarkdown";

const extensions = [
  StarterKit.configure({ paragraph: false, heading: false }),
  AlignedParagraph,
  AlignedHeading.configure({ levels: [1, 2, 3] }),
  Markdown.configure({ html: true }),
  MarkdownTextAlign.configure({ types: ["heading", "paragraph"] }),
];

const makeEditor = (content: string) =>
  new Editor({ element: document.createElement("div"), extensions, content });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMd = (editor: Editor): string => (editor.storage as any).markdown.getMarkdown();

/** "typ:ausrichtung" je Block, z. B. "paragraph:center" oder "heading:-". */
const alignsOf = (editor: Editor) =>
  (editor.getJSON().content ?? [])
    .map((n: JSONContent) => `${n.type}:${n.attrs?.textAlign ?? "-"}`)
    .join(",");

describe("Textausrichtung im Markdown", () => {
  const centered = () => {
    const e = makeEditor("Erster Absatz\n\nZweiter **fetter** Absatz\n\nDritter Absatz");
    e.commands.setTextSelection(20);
    e.commands.setTextAlign("center");
    return getMd(e);
  };

  it("serialisiert eine Zentrierung", () => {
    expect(centered()).toContain("text-align: center");
  });

  it("stellt die Ausrichtung beim Laden nur am betroffenen Absatz wieder her", () => {
    const e = makeEditor(centered());
    expect(alignsOf(e)).toBe("paragraph:-,paragraph:center,paragraph:-");
    expect(JSON.stringify(e.getJSON())).toContain('"bold"');
  });

  it("bleibt bei erneutem Speichern stabil", () => {
    const md = centered();
    expect(getMd(makeEditor(md))).toBe(md);
  });

  it("behält ein ausdrückliches Linksbündig (wichtig bei Blocksatz als Grundeinstellung)", () => {
    const e = makeEditor("Absatz eins\n\nAbsatz zwei");
    e.commands.setTextSelection(3);
    e.commands.setTextAlign("left");
    const md = getMd(e);
    expect(md).toContain("text-align: left");
    expect(alignsOf(makeEditor(md))).toBe("paragraph:left,paragraph:-");
  });

  it("richtet Überschriften aus", () => {
    const e = makeEditor("## Titel\n\nText");
    e.commands.setTextSelection(3);
    e.commands.setTextAlign("right");
    expect(alignsOf(makeEditor(getMd(e)))).toBe("heading:right,paragraph:-");
  });
});
