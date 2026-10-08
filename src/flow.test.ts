// Fluss-Modus: Szenen werden für den Editor zusammengesetzt und beim
// Speichern an den Trennern wieder zerlegt — dabei darf nie Text verloren gehen.
import { describe, expect, it } from "vitest";
import { joinFlow, normalizeScene, sceneBreakHtml, splitFlow } from "./flow";

describe("Fluss zusammensetzen und zerlegen", () => {
  const parts = [
    { id: "a-111111", content: "Erste Szene.\n\nZweiter Absatz." },
    { id: "b-222222", content: "Zweite Szene." },
    { id: "c-333333", content: "" },
  ];
  const ids = parts.map((p) => p.id);

  it("ergibt nach dem Zerlegen wieder dieselben Szenen", () => {
    expect(splitFlow(joinFlow(parts), ids)).toEqual(
      parts.map((p) => ({ id: p.id, content: normalizeScene(p.content) })),
    );
  });

  it("ordnet Text oberhalb des ersten Trenners der ersten Szene zu", () => {
    const md = `Davor getippt.\n${joinFlow(parts)}`;
    expect(splitFlow(md, ids)[0].content).toContain("Davor getippt.");
  });

  it("hängt Abschnitte mit unbekannter Marke an die vorige Szene an", () => {
    const md = joinFlow(parts.slice(0, 2)) + `\n${sceneBreakHtml("fremd-999999")}\n\nNoch Text.`;
    const out = splitFlow(md, ids);
    expect(out.map((p) => p.id)).toEqual(["a-111111", "b-222222"]);
    expect(out[1].content).toContain("Noch Text.");
    expect(out[1].content).not.toContain("fremd-999999");
  });

  it("liefert ohne Trenner nichts — dann ist nicht zuzuordnen, wohin der Text gehört", () => {
    expect(splitFlow("Nur Text ohne Trenner.", ids)).toEqual([]);
  });
});

describe("normalizeScene", () => {
  it("entfernt Leerzeilen am Rand und endet mit genau einem Zeilenumbruch", () => {
    expect(normalizeScene("\n\nText\n\n\n")).toBe("Text\n");
  });

  it("lässt eine leere Szene leer", () => {
    expect(normalizeScene("  \n ")).toBe("");
  });
});
