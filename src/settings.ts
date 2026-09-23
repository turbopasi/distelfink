// Zentrale App-Einstellungen (Phase 7): Schema, Defaults, Themes, Shortcuts.
// Persistiert werden sie app-weit über das Rust-Backend (settings.json im
// App-Config-Verzeichnis) — siehe src-tauri/src/settings.rs.

import { PRESET_THEMES, type PresetTheme } from "./presetThemes";

/** Eigene Themes aus styles/tokens.css plus die vorgefertigten aus
 *  presetThemes.ts ("daisy-…"), die wie "custom" inline gesetzt werden. */
export type ThemeId =
  | "system"
  | "light"
  | "dark"
  | "sepia"
  | "midnight"
  | "custom"
  | PresetTheme["id"];

export interface ThemeColors {
  bg: string;
  text: string;
  panel: string;
  border: string;
  accent: string;
  accentText: string;
  card: string;
  /** Markierungsfarbe des Autors: Textauswahl, Fundstellen, Hervorhebungen.
   *  Bewusst getrennt vom Akzent — der Akzent gehört der App, das hier dem
   *  Schreibenden. */
  highlight: string;
}

export interface EditorSettings {
  fontFamily: string;
  /** Schriftgröße in px. */
  fontSize: number;
  lineHeight: number;
  /** Maximale Textbreite in rem. */
  textWidth: number;
  cursorStyle: "standard" | "accent";
  /** Grundausrichtung aller Absätze ohne explizite Ausrichtung. */
  defaultAlignment: "left" | "justify";
  /** Automatische Silbentrennung (wichtig für sauberen Blocksatz). */
  hyphenation: boolean;
  /** "spaced" = Abstand zwischen den Absätzen, "indent" = Erstzeileneinzug
   *  (deutscher Romansatz). Beide Maße bleiben gespeichert, damit der Wechsel
   *  zwischen den Formaten nichts verliert. */
  paragraphStyle: "spaced" | "indent";
  /** Abstand nach jedem Absatz in em — gilt bei paragraphStyle "spaced". */
  paragraphSpacing: number;
  /** Einzug der ersten Zeile in em — gilt bei paragraphStyle "indent". */
  paragraphIndent: number;
  /** BCP-47-Sprachcode; steuert Trennwörterbuch und Rechtschreibprüfung. */
  language: string;
  /** Rechtschreibprüfung des Systems im Editor. */
  spellcheck: boolean;
}

export interface LayoutSettings {
  binderVisible: boolean;
  /** Binder-Breite in px (auch per Drag am Trennsteg verstellbar). */
  binderWidth: number;
  binderPosition: "left" | "right";
  /** Planungsleiste (Personen/Orte/Notizen/Module) — zweite Sidebar neben dem
   *  Binder. Schlüssel heißen weiter research*, damit gespeicherte
   *  Einstellungen bestehender Projekte gültig bleiben. */
  researchVisible: boolean;
  researchWidth: number;
  researchPosition: "left" | "right";
}

/** Hintergrundbild der Dokumentenfläche (Schreibtisch, auf dem das Blatt liegt).
 *  Das Bild selbst liegt im App-Config-Verzeichnis; hier steht nur sein Name. */
export interface BackgroundSettings {
  /** Dateiname im App-Config-Verzeichnis; "" = kein Bild. */
  image: string;
  /** "cover" = proportional füllen, "tile" = in Originalgröße wiederholen. */
  fit: "cover" | "tile";
  /** Deckkraft des Bildes in Prozent — darunter scheint der Theme-Hintergrund durch. */
  opacity: number;
  /** Deckkraft der Manuskriptseite in Prozent — darunter scheint das Bild durch. */
  paperOpacity: number;
}

export interface AppSettings {
  theme: ThemeId;
  customTheme: ThemeColors;
  background: BackgroundSettings;
  editor: EditorSettings;
  layout: LayoutSettings;
  /** Aktions-ID → Kürzel (kanonisch, z. B. "Ctrl+Shift+F"). "" = kein Kürzel. */
  shortcuts: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/** `preview` speist die drei Farbpunkte auf den Theme-Knöpfen: Fläche, Papier,
 *  Akzent — genau die drei Töne, an denen man ein Theme wiedererkennt. */
export const THEME_OPTIONS: { id: ThemeId; label: string; preview: [string, string, string] }[] = [
  { id: "system", label: "System", preview: ["#faf6ef", "#141310", "#2f5d50"] },
  { id: "light", label: "Papier", preview: ["#faf6ef", "#fffdf9", "#2f5d50"] },
  { id: "dark", label: "Nachtpapier", preview: ["#141310", "#1b1a16", "#3e7566"] },
  { id: "sepia", label: "Sepia", preview: ["#f0e7d5", "#fdf8ec", "#7e561f"] },
  { id: "midnight", label: "Mitternacht", preview: ["#0f1420", "#1a2235", "#5f89c9"] },
  { id: "custom", label: "Eigenes Theme", preview: ["#faf6ef", "#fffdf9", "#b07d34"] },
];

/** Helles Standard-Theme („Papier") — zugleich Ausgangspunkt für eigene Themes.
 *  Die Werte müssen mit :root[data-theme="light"] in styles/tokens.css
 *  übereinstimmen; von hier aus werden sie beim Übernehmen kopiert. */
export const LIGHT_COLORS: ThemeColors = {
  bg: "#faf6ef",
  text: "#2a2620",
  panel: "#f2ede3",
  border: "#dcd3c3",
  accent: "#2f5d50",
  accentText: "#fffdf9",
  card: "#fffdf9",
  highlight: "#b07d34",
};

export const DARK_COLORS: ThemeColors = {
  bg: "#141310",
  text: "#e4ded1",
  panel: "#1b1a16",
  border: "#2e2c26",
  accent: "#3e7566",
  accentText: "#f5f0e6",
  card: "#1b1a16",
  highlight: "#d8b378",
};

export function findPreset(id: unknown): PresetTheme | undefined {
  return PRESET_THEMES.find((t) => t.id === id);
}

export const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "Hintergrund" },
  { key: "text", label: "Text" },
  { key: "panel", label: "Leisten & Seitenbereiche" },
  { key: "border", label: "Rahmen & Trennlinien" },
  { key: "accent", label: "Akzentfarbe" },
  { key: "accentText", label: "Text auf Akzentfarbe" },
  { key: "card", label: "Karten & Manuskriptseite" },
  { key: "highlight", label: "Markierungen & Fundstellen" },
];

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export const FONT_OPTIONS: { label: string; value: string }[] = [
  // Literata, IBM Plex Sans und IBM Plex Mono liegen lokal in public/fonts.
  { label: "Literata (Serife)", value: '"Literata", Charter, Georgia, serif' },
  { label: "Georgia (Serife)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Garamond", value: 'Garamond, "EB Garamond", Georgia, serif' },
  { label: "IBM Plex Sans (serifenlos)", value: '"IBM Plex Sans", "Segoe UI", sans-serif' },
  { label: "Serifenlos (System)", value: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", ui-monospace, monospace' },
  { label: "Schreibmaschine (Monospace)", value: '"Courier New", ui-monospace, monospace' },
];

/** Sprache des Manuskripts. Der Code landet als lang-Attribut am Editor und
 *  entscheidet damit, welches Trennwörterbuch und welche Rechtschreibprüfung
 *  die WebView verwendet. */
export const LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Deutsch", value: "de" },
  { label: "Deutsch (Schweiz)", value: "de-CH" },
  { label: "Englisch", value: "en" },
  { label: "Englisch (UK)", value: "en-GB" },
  { label: "Französisch", value: "fr" },
  { label: "Spanisch", value: "es" },
  { label: "Italienisch", value: "it" },
  { label: "Niederländisch", value: "nl" },
];

// ---------------------------------------------------------------------------
// Tastaturkürzel
// ---------------------------------------------------------------------------

export interface ShortcutAction {
  id: string;
  label: string;
  default: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "focusMode", label: "Fokusmodus umschalten", default: "Ctrl+Shift+F" },
  { id: "quickNav", label: "Schnellnavigation", default: "Ctrl+K" },
  { id: "toggleSplit", label: "Split-Layout wechseln", default: "Ctrl+Shift+S" },
  { id: "toggleBinder", label: "Binder ein-/ausblenden", default: "Ctrl+Shift+B" },
  { id: "toggleResearchSidebar", label: "Planungsleiste ein-/ausblenden", default: "Ctrl+Shift+R" },
  { id: "snapshot", label: "Sicherungspunkt setzen", default: "Ctrl+S" },
  { id: "export", label: "Export-Dialog öffnen", default: "Ctrl+Shift+E" },
  { id: "settings", label: "Einstellungen öffnen", default: "Ctrl+," },
];

/** Baut aus einem KeyboardEvent das kanonische Kürzel ("Ctrl+Shift+F") — oder null. */
export function eventToCombo(e: KeyboardEvent): string | null {
  const key = normalizeKey(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function normalizeKey(e: KeyboardEvent): string | null {
  // Reine Modifier-Tasten sind kein Kürzel.
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  // e.code ist layoutunabhängig für Buchstaben/Ziffern ("KeyF" → "F").
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key === "," ? "," : e.key.toUpperCase();
  return e.key; // "Enter", "Tab", "ArrowUp", …
}

/** Anzeige mit deutschen Modifier-Namen ("Strg+Umschalt+F"). */
export function formatCombo(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) => (p === "Ctrl" ? "Strg" : p === "Shift" ? "Umschalt" : p === "Space" ? "Leertaste" : p))
    .join("+");
}

// ---------------------------------------------------------------------------
// Defaults, Merge, Anwendung
// ---------------------------------------------------------------------------

export function defaultSettings(): AppSettings {
  return {
    theme: "system",
    customTheme: { ...LIGHT_COLORS },
    background: { image: "", fit: "cover", opacity: 100, paperOpacity: 100 },
    editor: {
      fontFamily: FONT_OPTIONS[0].value,
      // 18px auf ~34em Satzbreite: das Maß, bei dem eine Zeile in einem Blick
      // erfasst wird, ohne dass das Auge am Zeilenende zurückspringen muss.
      fontSize: 18,
      lineHeight: 1.75,
      textWidth: 38,
      cursorStyle: "standard",
      defaultAlignment: "left",
      hyphenation: true,
      // 1em Abstand und kein Einzug: genau das, was der Browser bisher von
      // sich aus gemacht hat — bestehende Projekte sehen unverändert aus.
      paragraphStyle: "spaced",
      paragraphSpacing: 1,
      paragraphIndent: 1.5,
      language: "de",
      spellcheck: true,
    },
    layout: {
      binderVisible: true,
      binderWidth: 250,
      binderPosition: "left",
      researchVisible: false,
      researchWidth: 250,
      researchPosition: "right",
    },
    shortcuts: Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.default])),
  };
}

/** Geladenes JSON (unbekannter Herkunft) defensiv über die Defaults legen. */
export function mergeSettings(loaded: unknown): AppSettings {
  const d = defaultSettings();
  if (!loaded || typeof loaded !== "object") return d;
  const l = loaded as Partial<AppSettings>;
  return {
    theme:
      THEME_OPTIONS.some((t) => t.id === l.theme) || findPreset(l.theme)
        ? (l.theme as ThemeId)
        : d.theme,
    customTheme: { ...d.customTheme, ...(l.customTheme ?? {}) },
    background: { ...d.background, ...(l.background ?? {}) },
    editor: { ...d.editor, ...(l.editor ?? {}) },
    layout: { ...d.layout, ...(l.layout ?? {}) },
    // Defaults zuerst: neue Aktionen bekommen ihr Standard-Kürzel.
    shortcuts: { ...d.shortcuts, ...(l.shortcuts ?? {}) },
  };
}

/** Wahrgenommene Helligkeit eines #rrggbb-Werts — reicht, um „hell oder
 *  dunkel?" zu entscheiden. */
function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

const COLOR_VARS: Record<keyof ThemeColors, string> = {
  bg: "--bg",
  text: "--text",
  panel: "--panel",
  border: "--border",
  accent: "--accent",
  accentText: "--accent-text",
  card: "--card",
  highlight: "--highlight",
};

/** Überträgt die Einstellungen auf CSS-Variablen bzw. das data-theme-Attribut. */
export function applySettings(s: AppSettings) {
  const root = document.documentElement;

  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", s.theme);

  // Eigenes und vorgefertigte Themes: Farben inline setzen; sonst
  // Inline-Overrides entfernen, damit die Stylesheet-Themes greifen.
  const preset = findPreset(s.theme);
  const inline = s.theme === "custom" ? s.customTheme : preset?.colors;
  for (const key of Object.keys(COLOR_VARS) as (keyof ThemeColors)[]) {
    if (inline) root.style.setProperty(COLOR_VARS[key], inline[key]);
    else root.style.removeProperty(COLOR_VARS[key]);
  }

  // Inline-Themes treffen keinen data-theme-Selektor im Stylesheet — Hell oder
  // Dunkel muss darum hier gesetzt werden: --scheme für die Elemente des
  // Betriebssystems (Auswahllisten, Bildlaufleisten, Farbwähler), data-scheme
  // für die dunklen Schatten. Bei eigenen Themes wird geraten.
  const scheme = preset?.scheme ?? (s.theme === "custom" ? (isDark(s.customTheme.bg) ? "dark" : "light") : null);
  if (scheme) {
    root.style.setProperty("--scheme", scheme);
    root.dataset.scheme = scheme;
  } else {
    root.style.removeProperty("--scheme");
    delete root.dataset.scheme;
  }

  root.style.setProperty("--editor-font", s.editor.fontFamily);
  root.style.setProperty("--editor-size", `${s.editor.fontSize}px`);
  root.style.setProperty("--editor-lineheight", String(s.editor.lineHeight));
  root.style.setProperty("--editor-width", `${s.editor.textWidth}rem`);
  root.style.setProperty(
    "--caret",
    s.editor.cursorStyle === "accent" ? "var(--accent)" : "currentColor",
  );
  root.style.setProperty("--editor-align", s.editor.defaultAlignment);
  root.style.setProperty("--editor-hyphens", s.editor.hyphenation ? "auto" : "manual");
  // Absatzabstand und Einzug schließen einander aus — der nicht gewählte Wert
  // wird auf 0 gesetzt, statt beide Regeln zu verzweigen.
  const indented = s.editor.paragraphStyle === "indent";
  root.style.setProperty("--editor-para-spacing", indented ? "0" : `${s.editor.paragraphSpacing}em`);
  root.style.setProperty("--editor-para-indent", indented ? `${s.editor.paragraphIndent}em` : "0");
  // Silbentrennung folgt der Dokumentsprache; index.html trägt "de" nur als
  // Wert für die Zeit vor dem ersten Lauf dieser Funktion.
  root.lang = s.editor.language;
  root.style.setProperty("--binder-width", `${s.layout.binderWidth}px`);
  root.style.setProperty("--research-width", `${s.layout.researchWidth}px`);

  applyBackground(s.background);
}

// ---------------------------------------------------------------------------
// Hintergrundbild
// ---------------------------------------------------------------------------

/** Das Bild selbst rendert `DocBackdrop` als eigene Ebene im Pane — von hier
 *  kommt nur die Deckkraft der Manuskriptseite, die in die Papierfarbe eingeht
 *  (siehe --editor-paper in styles/tokens.css). */
function applyBackground(bg: BackgroundSettings) {
  const pct = Number.isFinite(bg.paperOpacity)
    ? Math.min(100, Math.max(0, bg.paperOpacity))
    : 100;
  document.documentElement.style.setProperty("--paper-opacity", `${pct}%`);
}
