// Headless-Roundtrip-Test: Textausrichtung → Markdown → Editor → Markdown.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
(globalThis as any).DOMParser = dom.window.DOMParser;
(globalThis as any).MutationObserver = dom.window.MutationObserver;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).Text = dom.window.Text;
(globalThis as any).getComputedStyle = dom.window.getComputedStyle;
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

const { Editor } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Markdown } = await import("tiptap-markdown");
const { AlignedHeading, AlignedParagraph, MarkdownTextAlign } = await import(
  "../src/components/TextAlignMarkdown"
);

const extensions = [
  StarterKit.configure({ paragraph: false, heading: false }),
  AlignedParagraph,
  AlignedHeading.configure({ levels: [1, 2, 3] }),
  Markdown.configure({ html: true }),
  MarkdownTextAlign.configure({ types: ["heading", "paragraph"] }),
];

function makeEditor(content: string) {
  return new Editor({ element: document.createElement("div"), extensions, content });
}

function getMd(editor: InstanceType<typeof Editor>): string {
  return (editor.storage as any).markdown.getMarkdown();
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FEHL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
  if (!ok) failures++;
}

/** "typ:ausrichtung" je Block, z. B. "paragraph:center" oder "heading:-". */
const alignsOf = (editor: InstanceType<typeof Editor>) =>
  (editor.getJSON().content ?? [])
    .map((n: any) => `${n.type}:${n.attrs?.textAlign ?? "-"}`)
    .join(",");

// 1) Absatz zentrieren → Markdown mit Ausrichtungs-Wrapper
const e1 = makeEditor("Erster Absatz\n\nZweiter **fetter** Absatz\n\nDritter Absatz");
e1.commands.setTextSelection(20);
e1.commands.setTextAlign("center");
const md1 = getMd(e1);
check("zentriert serialisiert", md1.includes("text-align: center"), JSON.stringify(md1));

// 2) Roundtrip: Markdown neu laden → Ausrichtung nur am zweiten Absatz
const e2 = makeEditor(md1);
check(
  "Ausrichtung nach Reload",
  alignsOf(e2) === "paragraph:-,paragraph:center,paragraph:-",
  alignsOf(e2),
);
check("Auszeichnung bleibt", JSON.stringify(e2.getJSON()).includes('"bold"'));

// 3) Zweite Serialisierung muss stabil sein (kein Drift)
const md2 = getMd(e2);
check("stabil", md1 === md2, JSON.stringify(md2));

// 4) Explizites "linksbündig" muss überleben (relevant bei Blocksatz-Grundeinstellung)
const e5 = makeEditor("Absatz eins\n\nAbsatz zwei");
e5.commands.setTextSelection(3);
e5.commands.setTextAlign("left");
const md5 = getMd(e5);
check(
  "explizit links",
  md5.includes("text-align: left") && alignsOf(makeEditor(md5)) === "paragraph:left,paragraph:-",
  JSON.stringify(md5),
);

// 5) Überschrift rechtsbündig
const e3 = makeEditor("## Titel\n\nText");
e3.commands.setTextSelection(3);
e3.commands.setTextAlign("right");
const md3 = getMd(e3);
const headingAligns = alignsOf(makeEditor(md3));
check(
  "Überschrift rechts",
  headingAligns === "heading:right,paragraph:-",
  `${JSON.stringify(md3)} → ${headingAligns}`,
);

console.log(failures === 0 ? "\nAlle Tests bestanden." : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
