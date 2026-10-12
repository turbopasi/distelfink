// Vorgabe für neue Notizen (Farbe, Rahmen, Schrift, Ausrichtung) aus der
// Werkzeugleiste.
// Gilt für alle Mindboards und gehört wie die Ansicht nicht in die
// Projektdatei — es ist eine Arbeitsgewohnheit, kein Inhalt.

import type { MindAlign, MindBorder, MindNode, MindVAlign } from "../../types";

export interface NoteStyle {
  /** Wert aus COLOR_PRESETS, "" = Standard. */
  color: string;
  border: MindBorder;
  /** 0 = Normal. */
  fontSize: number;
  bold: boolean;
  align: MindAlign;
  valign: MindVAlign;
}

export const DEFAULT_STYLE: NoteStyle = {
  color: "",
  border: "none",
  fontSize: 0,
  bold: false,
  align: "left",
  valign: "top",
};

const KEY = "distelfink.mindboardStyle";

export function loadStyle(): NoteStyle {
  try {
    return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_STYLE;
  }
}

export function storeStyle(style: NoteStyle) {
  try {
    localStorage.setItem(KEY, JSON.stringify(style));
  } catch {
    // Nur Komfort — ohne gemerkte Vorgabe starten neue Notizen schlicht.
  }
}

/** Die Felder, die eine neue Notiz aus der Vorgabe erbt — nur die vom
 *  Standard abweichenden, damit die Datei schlank bleibt. */
export function styleFields(style: NoteStyle): Partial<MindNode> {
  const out: Partial<MindNode> = {};
  if (style.color) out.color = style.color;
  if (style.border !== "none") out.border = style.border;
  if (style.fontSize) out.fontSize = style.fontSize;
  if (style.bold) out.bold = true;
  if (style.align !== "left") out.align = style.align;
  if (style.valign !== "top") out.valign = style.valign;
  return out;
}
