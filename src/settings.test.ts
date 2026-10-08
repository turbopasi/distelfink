// Gespeicherte Einstellungen stammen evtl. aus einer älteren Version oder
// sind beschädigt: mergeSettings muss daraus immer vollständige machen.
import { describe, expect, it } from "vitest";
import { defaultSettings, mergeSettings } from "./settings";

describe("mergeSettings", () => {
  it("liefert ohne gespeicherte Einstellungen die Vorgaben", () => {
    expect(mergeSettings(null)).toEqual(defaultSettings());
    expect(mergeSettings("kaputt")).toEqual(defaultSettings());
  });

  it("ergänzt fehlende Felder aus den Vorgaben", () => {
    const merged = mergeSettings({ editor: { fontSize: 22 } });
    expect(merged.editor.fontSize).toBe(22);
    expect(merged.editor.lineHeight).toBe(defaultSettings().editor.lineHeight);
    expect(merged.layout).toEqual(defaultSettings().layout);
  });

  it("verwirft ein unbekanntes Theme", () => {
    expect(mergeSettings({ theme: "gibt-es-nicht" }).theme).toBe(defaultSettings().theme);
  });

  it("gibt neuen Aktionen ihr Standard-Kürzel, behält aber eigene", () => {
    const d = defaultSettings();
    const [action] = Object.keys(d.shortcuts);
    const merged = mergeSettings({ shortcuts: { [action]: "Ctrl+Alt+X" } });
    expect(merged.shortcuts[action as keyof typeof d.shortcuts]).toBe("Ctrl+Alt+X");
    expect(Object.keys(merged.shortcuts)).toEqual(Object.keys(d.shortcuts));
  });
});
