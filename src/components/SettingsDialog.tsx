import { useEffect, useState } from "react";
import { api } from "../api";
import {
  COLOR_FIELDS,
  DARK_COLORS,
  FONT_OPTIONS,
  LANGUAGE_OPTIONS,
  LIGHT_COLORS,
  SHORTCUT_ACTIONS,
  THEME_OPTIONS,
  eventToCombo,
  findPreset,
  formatCombo,
  type AppSettings,
  type ThemeId,
} from "../settings";
import { PRESET_THEMES } from "../presetThemes";
import { useStore } from "../store";

type Tab = "appearance" | "editor" | "layout" | "shortcuts";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Darstellung" },
  { id: "editor", label: "Editor" },
  { id: "layout", label: "Layout" },
  { id: "shortcuts", label: "Tastaturkürzel" },
];

export function SettingsOverlay() {
  const open = useStore((s) => s.settingsOpen);
  if (!open) return null;
  return <SettingsDialog />;
}

function SettingsDialog() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div className="quicknav-overlay" onMouseDown={() => setSettingsOpen(false)}>
      <div className="history settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="history-header">
          <strong>Einstellungen</strong>
          <span className="spacer" />
          <button onClick={() => setSettingsOpen(false)}>Schließen</button>
        </div>
        <div className="settings-body">
          <nav className="settings-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "appearance" && <AppearanceTab />}
            {tab === "editor" && <EditorTab />}
            {tab === "layout" && <LayoutTab />}
            {tab === "shortcuts" && <ShortcutsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Kleine Helfer: aktuelle Einstellungen + Patch-Funktion. */
function useSettings() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  return { settings, updateSettings };
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const { settings, updateSettings } = useSettings();

  const pickTheme = (theme: ThemeId) => updateSettings({ theme });

  return (
    <>
      <h3>Theme</h3>
      <div className="theme-grid">
        {THEME_OPTIONS.map((t) => (
          <button
            key={t.id}
            className={`theme-swatch-button ${settings.theme === t.id ? "on" : ""}`}
            onClick={() => pickTheme(t.id)}
          >
            <span className="theme-preview" aria-hidden="true">
              {t.preview.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            {t.label}
          </button>
        ))}
      </div>
      {settings.theme === "custom" && <CustomThemeEditor />}
      <h3>Weitere Themes</h3>
      <p className="muted small">Farbpaletten nach den Themes von daisyUI.</p>
      {(["light", "dark"] as const).map((scheme) => (
        <div key={scheme} className="theme-group">
          <h4>{scheme === "light" ? "Hell" : "Dunkel"}</h4>
          <div className="theme-grid">
            {PRESET_THEMES.filter((t) => t.scheme === scheme).map((t) => (
              <button
                key={t.id}
                className={`theme-swatch-button ${settings.theme === t.id ? "on" : ""}`}
                onClick={() => pickTheme(t.id)}
              >
                <span className="theme-preview" aria-hidden="true">
                  {[t.colors.bg, t.colors.card, t.colors.accent].map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <BackgroundEditor />
    </>
  );
}

/** Hintergrundbild und Deckkraft der Dokumentenfläche. */
function BackgroundEditor() {
  const { settings, updateSettings } = useSettings();
  const bg = settings.background;
  const patch = (p: Partial<AppSettings["background"]>) =>
    updateSettings({ background: { ...bg, ...p } });

  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!bg.image) {
      setPreview(null);
      return;
    }
    let alive = true;
    void api
      .readBackgroundImage(bg.image)
      .then((url) => {
        if (alive) setPreview(url);
      })
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [bg.image]);

  async function chooseImage() {
    try {
      const name = await api.importBackgroundImage();
      if (name) patch({ image: name });
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  async function removeImage() {
    patch({ image: "" });
    await api.clearBackgroundImage().catch(() => {});
  }

  return (
    <>
      <h3>Hintergrund der Dokumente</h3>
      <div className="settings-row">
        <span>Bild</span>
        {preview ? (
          <img className="background-preview" src={preview} alt="" />
        ) : (
          <span className="muted small">Kein Bild — es gilt der Theme-Hintergrund</span>
        )}
        <span className="spacer" />
        <button onClick={() => void chooseImage()}>{bg.image ? "Ändern …" : "Wählen …"}</button>
        {bg.image && <button onClick={() => void removeImage()}>Entfernen</button>}
      </div>
      <label className="settings-row">
        <span>Darstellung</span>
        <select
          value={bg.fit}
          onChange={(e) => patch({ fit: e.target.value as "cover" | "tile" })}
          disabled={!bg.image}
        >
          <option value="cover">Proportional füllen</option>
          <option value="tile">In Originalgröße wiederholen</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Deckkraft des Bildes</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={bg.opacity}
          disabled={!bg.image}
          onChange={(e) => patch({ opacity: clamp(e.target.valueAsNumber, 0, 100, 100) })}
        />
        <span className="muted small">{bg.opacity} %</span>
      </label>
      <label className="settings-row">
        <span>Deckkraft der Schreibfläche</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={bg.paperOpacity}
          onChange={(e) => patch({ paperOpacity: clamp(e.target.valueAsNumber, 0, 100, 100) })}
        />
        <span className="muted small">{bg.paperOpacity} %</span>
      </label>
      {bg.image && bg.paperOpacity >= 100 && (
        <p className="muted small">
          Die Schreibfläche ist derzeit vollständig deckend — das Bild ist deshalb nur
          neben der Manuskriptseite zu sehen. Für ein Bild hinter dem Text die Deckkraft
          der Schreibfläche verringern.
        </p>
      )}
      <p className="muted small">
        Das Bild liegt hinter der Manuskriptseite — je durchsichtiger die Schreibfläche,
        desto mehr davon scheint hinter dem Text durch. Es gilt für alle Dokumente aus dem
        Binder sowie für die Planungsdokumente.
      </p>
    </>
  );
}

function CustomThemeEditor() {
  const { settings, updateSettings } = useSettings();

  const setColor = (key: keyof AppSettings["customTheme"], value: string) =>
    updateSettings({ customTheme: { ...settings.customTheme, [key]: value } });

  return (
    <fieldset className="export-template">
      <legend>Eigenes Theme</legend>
      <div className="row" style={{ justifyContent: "flex-start" }}>
        <button onClick={() => updateSettings({ customTheme: { ...LIGHT_COLORS } })}>
          Von Hell übernehmen
        </button>
        <button onClick={() => updateSettings({ customTheme: { ...DARK_COLORS } })}>
          Von Dunkel übernehmen
        </button>
        <select
          value=""
          onChange={(e) => {
            const preset = findPreset(e.target.value);
            if (preset) updateSettings({ customTheme: { ...preset.colors } });
          }}
        >
          <option value="">Von weiterem Theme übernehmen …</option>
          {PRESET_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {COLOR_FIELDS.map((f) => (
        <label key={f.key} className="settings-row">
          <span>{f.label}</span>
          <input
            type="color"
            value={settings.customTheme[f.key]}
            onChange={(e) => setColor(f.key, e.target.value)}
          />
          <code className="muted small">{settings.customTheme[f.key]}</code>
        </label>
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function EditorTab() {
  const { settings, updateSettings } = useSettings();
  const ed = settings.editor;
  const patch = (p: Partial<AppSettings["editor"]>) =>
    updateSettings({ editor: { ...ed, ...p } });

  return (
    <>
      <h3>Schreib-Editor</h3>
      <label className="settings-row">
        <span>Schriftart</span>
        <select value={ed.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-row">
        <span>Schriftgröße</span>
        <input
          type="number"
          min={12}
          max={28}
          value={ed.fontSize}
          onChange={(e) => patch({ fontSize: clamp(e.target.valueAsNumber, 12, 28, 17) })}
        />
        <span className="muted small">px</span>
      </label>
      <label className="settings-row">
        <span>Zeilenabstand</span>
        <input
          type="number"
          min={1.2}
          max={2.6}
          step={0.1}
          value={ed.lineHeight}
          onChange={(e) => patch({ lineHeight: clamp(e.target.valueAsNumber, 1.2, 2.6, 1.7) })}
        />
      </label>
      <label className="settings-row">
        <span>Textbreite</span>
        <input
          type="number"
          min={28}
          max={80}
          value={ed.textWidth}
          onChange={(e) => patch({ textWidth: clamp(e.target.valueAsNumber, 28, 80, 48) })}
        />
        <span className="muted small">rem (≈ Zeichen pro Zeile × 0,6)</span>
      </label>
      <label className="settings-row">
        <span>Absatzformat</span>
        <select
          value={ed.paragraphStyle}
          onChange={(e) => patch({ paragraphStyle: e.target.value as "spaced" | "indent" })}
        >
          <option value="spaced">Abstand zwischen Absätzen</option>
          <option value="indent">Erstzeileneinzug (Romansatz)</option>
        </select>
      </label>
      {ed.paragraphStyle === "spaced" ? (
        <label className="settings-row">
          <span>Absatzabstand</span>
          <input
            type="number"
            min={0}
            max={2.5}
            step={0.1}
            value={ed.paragraphSpacing}
            onChange={(e) => patch({ paragraphSpacing: clamp(e.target.valueAsNumber, 0, 2.5, 1) })}
          />
          <span className="muted small">em</span>
        </label>
      ) : (
        <label className="settings-row">
          <span>Einzug</span>
          <input
            type="number"
            min={0}
            max={4}
            step={0.5}
            value={ed.paragraphIndent}
            onChange={(e) => patch({ paragraphIndent: clamp(e.target.valueAsNumber, 0, 4, 1.5) })}
          />
          <span className="muted small">em</span>
        </label>
      )}
      <label className="settings-row">
        <span>Cursor-Stil</span>
        <select
          value={ed.cursorStyle}
          onChange={(e) => patch({ cursorStyle: e.target.value as "standard" | "accent" })}
        >
          <option value="standard">Standard (Textfarbe)</option>
          <option value="accent">Akzentfarbe</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Grundausrichtung</span>
        <select
          value={ed.defaultAlignment}
          onChange={(e) => patch({ defaultAlignment: e.target.value as "left" | "justify" })}
        >
          <option value="left">Linksbündig</option>
          <option value="justify">Blocksatz</option>
        </select>
        <span className="muted small">gilt für Absätze ohne eigene Ausrichtung</span>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={ed.hyphenation}
          onChange={(e) => patch({ hyphenation: e.target.checked })}
        />
        <span>Automatische Silbentrennung (empfohlen bei Blocksatz)</span>
      </label>
      <label className="settings-row">
        <span>Sprache</span>
        <select value={ed.language} onChange={(e) => patch({ language: e.target.value })}>
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="muted small">steuert Silbentrennung und Rechtschreibprüfung</span>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={ed.spellcheck}
          onChange={(e) => patch({ spellcheck: e.target.checked })}
        />
        <span>Rechtschreibprüfung</span>
      </label>
      <p className="muted small">
        Diese Einstellungen wirken auf den Schreib-Editor und die Planungsdokumente — nicht auf den
        Export (dort gelten die Formatierungsvorlagen).
      </p>
    </>
  );
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function LayoutTab() {
  const { settings, updateSettings } = useSettings();
  const lay = settings.layout;
  const patch = (p: Partial<AppSettings["layout"]>) =>
    updateSettings({ layout: { ...lay, ...p } });

  return (
    <>
      <h3>Panels</h3>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={lay.binderVisible}
          onChange={(e) => patch({ binderVisible: e.target.checked })}
        />
        <span>Binder (Ordner-/Dokumentenliste) anzeigen</span>
      </label>
      <label className="settings-row">
        <span>Binder-Position</span>
        <select
          value={lay.binderPosition}
          onChange={(e) => patch({ binderPosition: e.target.value as "left" | "right" })}
        >
          <option value="left">Links</option>
          <option value="right">Rechts</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Binder-Breite</span>
        <input
          type="number"
          min={160}
          max={500}
          value={lay.binderWidth}
          onChange={(e) => patch({ binderWidth: clamp(e.target.valueAsNumber, 160, 500, 250) })}
        />
        <span className="muted small">px — auch per Ziehen am Trennsteg verstellbar</span>
      </label>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={lay.researchVisible}
          onChange={(e) => patch({ researchVisible: e.target.checked })}
        />
        <span>Planungsleiste (Personen, Orte, Module) anzeigen</span>
      </label>
      <label className="settings-row">
        <span>Planungsleiste-Position</span>
        <select
          value={lay.researchPosition}
          onChange={(e) => patch({ researchPosition: e.target.value as "left" | "right" })}
        >
          <option value="left">Links</option>
          <option value="right">Rechts</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Planungsleiste-Breite</span>
        <input
          type="number"
          min={160}
          max={500}
          value={lay.researchWidth}
          onChange={(e) => patch({ researchWidth: clamp(e.target.valueAsNumber, 160, 500, 250) })}
        />
        <span className="muted small">px — auch per Ziehen am Trennsteg verstellbar</span>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tastaturkürzel
// ---------------------------------------------------------------------------

function ShortcutsTab() {
  const { settings, updateSettings } = useSettings();
  /** Aktion, für die gerade ein neues Kürzel aufgenommen wird. */
  const [recording, setRecording] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // reine Modifier-Taste — weiter warten
      const s = useStore.getState().settings;
      const taken = SHORTCUT_ACTIONS.find(
        (a) => a.id !== recording && s.shortcuts[a.id] === combo,
      );
      if (taken) {
        setConflict(`${formatCombo(combo)} ist bereits mit „${taken.label}“ belegt.`);
        return;
      }
      updateSettings({ shortcuts: { ...s.shortcuts, [recording]: combo } });
      setConflict(null);
      setRecording(null);
    };
    // capture: true, damit die globalen App-Shortcuts nicht mitfeuern.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, updateSettings]);

  const reset = (id: string) => {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)!.default;
    updateSettings({ shortcuts: { ...settings.shortcuts, [id]: def } });
    setConflict(null);
  };

  return (
    <>
      <h3>Tastaturkürzel</h3>
      {conflict && <p className="shortcut-conflict">{conflict}</p>}
      <table className="shortcut-table">
        <tbody>
          {SHORTCUT_ACTIONS.map((a) => {
            const combo = settings.shortcuts[a.id] ?? a.default;
            const isRecording = recording === a.id;
            return (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>
                  {isRecording ? (
                    <em className="muted">Taste drücken … (Esc bricht ab)</em>
                  ) : (
                    <kbd>{formatCombo(combo)}</kbd>
                  )}
                </td>
                <td className="shortcut-actions">
                  <button
                    onClick={() => {
                      setConflict(null);
                      setRecording(isRecording ? null : a.id);
                    }}
                  >
                    {isRecording ? "Abbrechen" : "Ändern"}
                  </button>
                  {combo !== a.default && (
                    <button onClick={() => reset(a.id)}>Zurücksetzen</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Kürzel gelten app-weit. Innerhalb des Editors haben Textbefehle (z. B. Strg+B für
        Fett) Vorrang.
      </p>
    </>
  );
}
