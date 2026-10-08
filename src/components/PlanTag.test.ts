// @vitest-environment jsdom
// Roundtrip der Planungs-Tags (Mark → Markdown → Editor → Mark) und das
// Slash-Kommando, das sie setzt. Normale Links bleiben unangetastet.
/* eslint-disable @typescript-eslint/no-explicit-any -- Editor-JSON ist untypisiert */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { PlanTag } from "./PlanTag";
import {
  choosePlanTagTarget,
  finishPlanTagCompose,
  getPlanTagCommandState,
  PlanTagCommand,
} from "./planTagCommand";

const makeEditor = (content: string, withCommand = false) =>
  new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit,
      Markdown.configure({ html: true }),
      PlanTag,
      ...(withCommand ? [PlanTagCommand] : []),
    ],
    content,
  });

const getMd = (editor: Editor): string => (editor.storage as any).markdown.getMarkdown();

const firstParagraph = (editor: Editor): any[] =>
  (editor.getJSON().content?.[0] as any)?.content ?? [];

describe("Planungs-Tags im Markdown", () => {
  const tagged = () => {
    const e = makeEditor("Am Abend kam er zurueck.");
    e.commands.setTextSelection({ from: 14, to: 16 }); // "er"
    e.commands.setMark("planTag", { kind: "person", id: "jonas-3f2a1b" });
    return getMd(e);
  };

  it("serialisiert als Link mit eigenem Schema", () => {
    expect(tagged()).toBe("Am Abend kam [er](person:jonas-3f2a1b) zurueck.");
  });

  it("stellt den Tag samt Attributen beim Laden wieder her", () => {
    const marks = firstParagraph(makeEditor(tagged())).flatMap((n) => n.marks ?? []);
    const tag = marks.find((m) => m.type === "planTag");
    expect(tag?.attrs).toMatchObject({ kind: "person", id: "jonas-3f2a1b" });
  });

  it("bleibt bei erneutem Speichern stabil", () => {
    const md = tagged();
    expect(getMd(makeEditor(md))).toBe(md);
  });

  it("funktioniert für Orte ebenso", () => {
    const e = makeEditor("Dort war es still.");
    e.commands.setTextSelection({ from: 1, to: 5 }); // "Dort"
    e.commands.setMark("planTag", { kind: "location", id: "dunkler-wald-9c11ab" });
    const md = getMd(e);
    expect(md).toBe("[Dort](location:dunkler-wald-9c11ab) war es still.");
    const mark = firstParagraph(makeEditor(md))[0]?.marks?.[0];
    expect(mark?.attrs).toMatchObject({ kind: "location", id: "dunkler-wald-9c11ab" });
  });

  it("lässt normale Links in Ruhe", () => {
    const e = makeEditor("Siehe [Quelle](https://example.org/x) dazu.");
    const link = firstParagraph(e).find((n) => n.text === "Quelle")?.marks?.[0];
    expect(link?.type).toBe("link");
    expect(getMd(e)).toContain("https://example.org/x");
  });

  it("verträgt Auszeichnungen innerhalb des Tags", () => {
    const e = makeEditor("Der alte Mann ging.");
    e.commands.setTextSelection({ from: 1, to: 14 });
    e.commands.setMark("planTag", { kind: "person", id: "jonas-3f2a1b" });
    e.commands.setTextSelection({ from: 5, to: 9 });
    e.commands.setMark("italic");
    const md = getMd(e);
    expect(md).toContain("(person:jonas-3f2a1b)");
    expect(getMd(makeEditor(md))).toBe(md);
  });
});

describe("Slash-Kommando /person, /location", () => {
  /** Tippt "/kind" und danach das auslösende Leerzeichen. Das führende
   *  Leerzeichen wird mitgetippt, weil Markdown es am Zeilenende wegkürzt —
   *  im Editor steht es aber wirklich da. */
  function typeCommand(editor: Editor, kind: string, precedingSpace = true) {
    editor.commands.insertContent(`${precedingSpace ? " " : ""}/${kind}`);
    const pos = editor.state.selection.head;
    return (
      editor.view.someProp("handleTextInput", (f: any) => f(editor.view, pos, pos, " ")) === true
    );
  }

  it("setzt einen Tag um das danach getippte Wort", () => {
    const e = makeEditor("Am Abend kam", true);
    e.commands.focus("end");
    expect(typeCommand(e, "person")).toBe(true);
    expect(e.state.doc.textContent).toBe("Am Abend kam ");
    expect(getPlanTagCommandState(e.state)?.phase).toBe("picker");

    choosePlanTagTarget(e, "jonas-3f2a1b", "Jonas");
    expect(getPlanTagCommandState(e.state)?.phase).toBe("compose");
    expect(e.state.doc.textContent).toBe("Am Abend kam ");

    e.commands.insertContent("Er");
    finishPlanTagCompose(e);
    expect(getMd(e)).toBe("Am Abend kam [Er](person:jonas-3f2a1b)");
    expect(getPlanTagCommandState(e.state)).toBeNull();

    // Weitertippen verlängert den fertigen Tag nicht (inclusive: false).
    e.commands.insertContent(" zurueck.");
    expect(getMd(e)).toBe("Am Abend kam [Er](person:jonas-3f2a1b) zurueck.");
  });

  it("nimmt ohne getipptes Wort den Namen der Auswahl", () => {
    const e = makeEditor("Dann sah", true);
    e.commands.focus("end");
    typeCommand(e, "location");
    choosePlanTagTarget(e, "wald-9c11ab", "Dunkler Wald");
    finishPlanTagCompose(e);
    expect(getMd(e)).toBe("Dann sah [Dunkler Wald](location:wald-9c11ab)");
  });

  it("greift nicht mitten im Wort", () => {
    const e = makeEditor("und", true);
    e.commands.focus("end");
    expect(typeCommand(e, "person", false)).toBe(false);
  });
});
