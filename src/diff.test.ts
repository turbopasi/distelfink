import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

const compact = (oldText: string, newText: string) =>
  diffLines(oldText, newText).map((l) => `${{ same: " ", add: "+", del: "-" }[l.type]}${l.text}`);

describe("Zeilenvergleich für den Verlauf", () => {
  it("zeigt gleiche Texte als unverändert", () => {
    expect(compact("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("findet eingefügte und gelöschte Zeilen", () => {
    expect(compact("a\nb\nc", "a\nc\nd")).toEqual([" a", "-b", " c", "+d"]);
  });

  it("zeigt eine geänderte Zeile als entfernt und hinzugefügt", () => {
    expect(compact("Er ging.", "Sie ging.")).toEqual(["-Er ging.", "+Sie ging."]);
  });

  it("behandelt Windows-Zeilenenden wie normale", () => {
    expect(compact("a\r\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("bleibt bei sehr großen Änderungen schnell und vollständig", () => {
    const oldText = Array.from({ length: 1500 }, (_, i) => `alt ${i}`).join("\n");
    const newText = Array.from({ length: 1500 }, (_, i) => `neu ${i}`).join("\n");
    const out = diffLines(oldText, newText);
    expect(out.filter((l) => l.type === "del")).toHaveLength(1500);
    expect(out.filter((l) => l.type === "add")).toHaveLength(1500);
  });
});
