// Headless-Roundtrip-Test der Planungs-Tags: Mark → Markdown → Editor → Mark.
// Prüft außerdem, dass normale Links unangetastet bleiben.
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
const { PlanTag } = await import("../src/components/PlanTag");

const extensions = [StarterKit, Markdown.configure({ html: true }), PlanTag];

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

// 1) Tag setzen → Markdown
const e1 = makeEditor("Am Abend kam er zurueck.");
e1.commands.setTextSelection({ from: 14, to: 16 }); // "er"
e1.commands.setMark("planTag", { kind: "person", id: "jonas-3f2a1b" });
const md1 = getMd(e1);
check(
  "Serialisierung",
  md1 === "Am Abend kam [er](person:jonas-3f2a1b) zurueck.",
  JSON.stringify(md1),
);

// 2) Roundtrip: neu laden → Mark mit Attributen wieder da?
const e2 = makeEditor(md1);
const marks = (e2.getJSON().content?.[0] as any)?.content?.flatMap(
  (n: any) => n.marks ?? [],
);
const tag = marks?.find((m: any) => m.type === "planTag");
check(
  "Mark nach Reload",
  tag?.attrs?.kind === "person" && tag?.attrs?.id === "jonas-3f2a1b",
  JSON.stringify(marks),
);

// 3) Zweite Serialisierung muss identisch sein (kein Drift)
const md2 = getMd(e2);
check("stabil", md1 === md2, JSON.stringify(md2));

// 4) Orte ebenso (Notizen gibt es seit 0.12 nicht mehr)
for (const [kind, id] of [["location", "dunkler-wald-9c11ab"]] as const) {
  const e = makeEditor("Dort war es still.");
  e.commands.setTextSelection({ from: 1, to: 5 }); // "Dort"
  e.commands.setMark("planTag", { kind, id });
  const md = getMd(e);
  const back = makeEditor(md);
  const m = (back.getJSON().content?.[0] as any)?.content?.[0]?.marks?.[0];
  check(
    `Roundtrip ${kind}`,
    md === `[Dort](${kind}:${id}) war es still.` &&
      m?.attrs?.id === id &&
      m?.attrs?.kind === kind,
    JSON.stringify(md),
  );
}

// 5) Normale Links dürfen nicht zu Tags werden
const e5 = makeEditor("Siehe [Quelle](https://example.org/x) dazu.");
const linkMark = (e5.getJSON().content?.[0] as any)?.content?.find(
  (n: any) => n.text === "Quelle",
)?.marks?.[0];
check(
  "fremde Links unberuehrt",
  linkMark?.type === "link" && getMd(e5).includes("https://example.org/x"),
  JSON.stringify(getMd(e5)),
);

// 6) Fett/kursiv innerhalb eines Tags
const e6 = makeEditor("Der alte Mann ging.");
e6.commands.setTextSelection({ from: 1, to: 14 });
e6.commands.setMark("planTag", { kind: "person", id: "jonas-3f2a1b" });
e6.commands.setTextSelection({ from: 5, to: 9 });
e6.commands.setMark("italic");
const md6 = getMd(e6);
const e6b = makeEditor(md6);
check(
  "Auszeichnung im Tag",
  getMd(e6b) === md6 && md6.includes("(person:jonas-3f2a1b)"),
  JSON.stringify(md6),
);

// --- Slash-Kommando: /person → leerer Tag → Label tippen → ENTER ------------

const { PlanTagCommand, getPlanTagCommandState, choosePlanTagTarget, finishPlanTagCompose } =
  await import("../src/components/planTagCommand");

function makeCommandEditor(content: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, Markdown.configure({ html: true }), PlanTag, PlanTagCommand],
    content,
  });
}

/** Tippt "/person" und danach das auslösende Leerzeichen.
 *  Das führende Leerzeichen wird mitgetippt, weil Markdown es am Zeilenende
 *  wegkürzt — im Editor steht es aber wirklich da. */
function typeCommand(editor: any, kind: string, precedingSpace = true) {
  editor.commands.insertContent(`${precedingSpace ? " " : ""}/${kind}`);
  const pos = editor.state.selection.head;
  const handled = editor.view.someProp("handleTextInput", (f: any) =>
    f(editor.view, pos, pos, " "),
  );
  return handled === true;
}

const c1 = makeCommandEditor("Am Abend kam");
c1.commands.focus("end");
check("Kommando erkannt", typeCommand(c1, "person"));
check(
  "Kommandotext entfernt",
  c1.state.doc.textContent === "Am Abend kam ",
  JSON.stringify(c1.state.doc.textContent),
);
check("Suchfeld-Zustand", getPlanTagCommandState(c1.state)?.phase === "picker");

choosePlanTagTarget(c1, "jonas-3f2a1b", "Jonas");
check("Tag eroeffnet (noch leer)", getPlanTagCommandState(c1.state)?.phase === "compose");
check("nichts eingefuegt", c1.state.doc.textContent === "Am Abend kam ");

c1.commands.insertContent("Er");
finishPlanTagCompose(c1);
check(
  "Label getaggt",
  getMd(c1) === "Am Abend kam [Er](person:jonas-3f2a1b)",
  JSON.stringify(getMd(c1)),
);
check("Kommando beendet", getPlanTagCommandState(c1.state) === null);

// Weitertippen darf den fertigen Tag nicht verlaengern (inclusive: false).
c1.commands.insertContent(" zurueck.");
check(
  "Tag waechst nicht weiter",
  getMd(c1) === "Am Abend kam [Er](person:jonas-3f2a1b) zurueck.",
  JSON.stringify(getMd(c1)),
);

// ENTER ohne getipptes Label: der Name der Auswahl springt ein.
const c2 = makeCommandEditor("Dann sah");
c2.commands.focus("end");
typeCommand(c2, "location");
choosePlanTagTarget(c2, "wald-9c11ab", "Dunkler Wald");
finishPlanTagCompose(c2);
check(
  "leeres Label faellt auf den Namen zurueck",
  getMd(c2) === "Dann sah [Dunkler Wald](location:wald-9c11ab)",
  JSON.stringify(getMd(c2)),
);

// Kein Kommando mitten im Wort ("und/person").
const c3 = makeCommandEditor("und");
c3.commands.focus("end");
check("kein Treffer im Wort", !typeCommand(c3, "person", false));

console.log(failures === 0 ? "\nAlle Tests bestanden." : `\n${failures} Test(s) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
