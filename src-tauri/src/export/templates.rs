//! Formatierungsvorlagen: zwei eingebaute, eigene je Projekt in
//! `export-templates.json`.

use serde::{Deserialize, Serialize};
use std::fs;

use super::model::Align;
use crate::project::{with_project, AppState, OpenProject};

pub const TEMPLATES_FILE: &str = "export-templates.json";

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarginsMm {
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportTemplate {
    pub id: String,
    pub name: String,
    /// Eingebaute Vorlagen sind nicht lösch- oder überschreibbar.
    #[serde(default)]
    pub built_in: bool,
    /// "times" | "georgia" | "arial" | "courier"
    pub font: String,
    pub font_size_pt: f32,
    /// 1.0 / 1.15 / 1.5 / 2.0
    pub line_spacing: f32,
    pub margins_mm: MarginsMm,
    /// Kopfzeile mit Platzhaltern {titel} {autor} {seite}; leer = keine.
    pub header: String,
    /// Trenner zwischen Szenen ohne Überschrift (z. B. "* * *"); leer = Leerraum.
    pub scene_separator: String,
    pub chapter_start_new_page: bool,
    pub include_scene_titles: bool,
    /// Grundausrichtung für Absätze ohne eigene Ausrichtung: "left" | "justify".
    /// Leer = links. serde(default) hält ältere export-templates.json gültig.
    #[serde(default)]
    pub alignment: String,
    /// Silbentrennung im ePub. PDF und DOCX trennen nicht — bei DOCX
    /// entscheidet das Textverarbeitungsprogramm, der PDF-Satz (pdf.rs) bricht
    /// nur an Leerzeichen um.
    #[serde(default)]
    pub hyphenation: bool,
    /// BCP-47-Sprachcode für die ePub-Metadaten und xml:lang; leer = "de".
    /// Ohne ihn trennt kein E-Reader.
    #[serde(default)]
    pub language: String,
}

impl ExportTemplate {
    /// Grundausrichtung der Vorlage; unbekannte Werte fallen auf links zurück.
    pub(super) fn base_align(&self) -> Align {
        Align::parse(&self.alignment).unwrap_or(Align::Left)
    }

    pub(super) fn lang(&self) -> &str {
        if self.language.trim().is_empty() {
            "de"
        } else {
            self.language.trim()
        }
    }
}

pub(super) fn builtin_templates() -> Vec<ExportTemplate> {
    vec![
        ExportTemplate {
            id: "builtin-standard".into(),
            name: "Standard".into(),
            built_in: true,
            font: "georgia".into(),
            font_size_pt: 11.0,
            line_spacing: 1.15,
            margins_mm: MarginsMm {
                top: 20.0,
                bottom: 20.0,
                left: 25.0,
                right: 25.0,
            },
            header: "{titel}".into(),
            scene_separator: "* * *".into(),
            chapter_start_new_page: true,
            include_scene_titles: false,
            alignment: "justify".into(),
            hyphenation: true,
            language: "de".into(),
        },
        // Deutsche Verlagskonvention: Times New Roman 12 pt, 1,5-zeilig,
        // Standardränder mit breiterem Korrekturrand rechts.
        ExportTemplate {
            id: "builtin-normseite".into(),
            name: "Normseite (deutsch)".into(),
            built_in: true,
            font: "times".into(),
            font_size_pt: 12.0,
            line_spacing: 1.5,
            margins_mm: MarginsMm {
                top: 25.0,
                bottom: 25.0,
                left: 25.0,
                right: 40.0,
            },
            header: "{autor} · {titel} — Seite {seite}".into(),
            scene_separator: "* * *".into(),
            chapter_start_new_page: true,
            include_scene_titles: false,
            // Die Normseite ist per Konvention Flattersatz und ungetrennt.
            alignment: "left".into(),
            hyphenation: false,
            language: "de".into(),
        },
    ]
}

#[derive(Serialize, Deserialize, Default)]
pub(super) struct TemplatesFile {
    templates: Vec<ExportTemplate>,
}

pub(super) fn load_custom_templates(p: &OpenProject) -> Vec<ExportTemplate> {
    fs::read_to_string(p.abs(TEMPLATES_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<TemplatesFile>(&raw).ok())
        .map(|f| f.templates)
        .unwrap_or_default()
}

pub(super) fn store_custom_templates(
    p: &OpenProject,
    templates: Vec<ExportTemplate>,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&TemplatesFile { templates })
        .map_err(|e| format!("Vorlagen serialisieren: {e}"))?;
    crate::fsutil::write_atomic(&p.abs(TEMPLATES_FILE), json)
        .map_err(|e| format!("Vorlagen schreiben: {e}"))
}

pub(super) fn all_templates(p: &OpenProject) -> Vec<ExportTemplate> {
    let mut all = builtin_templates();
    all.extend(load_custom_templates(p));
    all
}

#[tauri::command]
pub fn list_export_templates(state: tauri::State<AppState>) -> Result<Vec<ExportTemplate>, String> {
    with_project(&state, |p| Ok(all_templates(p)))
}

/// Speichert eine Vorlage als projektbezogene Custom-Vorlage. Eingebaute
/// Vorlagen werden nie überschrieben — Speichern unter Builtin-ID erzeugt
/// eine neue Kopie.
#[tauri::command]
pub fn save_export_template(
    template: ExportTemplate,
    state: tauri::State<AppState>,
) -> Result<Vec<ExportTemplate>, String> {
    with_project(&state, |p| {
        let mut t = template;
        t.built_in = false;
        if t.name.trim().is_empty() {
            return Err("Vorlagenname ist leer".into());
        }
        let is_builtin_id = builtin_templates().iter().any(|b| b.id == t.id);
        if t.id.is_empty() || is_builtin_id {
            t.id = format!("tpl-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        }
        let mut customs = load_custom_templates(p);
        match customs.iter_mut().find(|c| c.id == t.id) {
            Some(existing) => *existing = t,
            None => customs.push(t),
        }
        store_custom_templates(p, customs)?;
        Ok(all_templates(p))
    })
}

#[tauri::command]
pub fn delete_export_template(
    id: String,
    state: tauri::State<AppState>,
) -> Result<Vec<ExportTemplate>, String> {
    with_project(&state, |p| {
        let mut customs = load_custom_templates(p);
        customs.retain(|c| c.id != id);
        store_custom_templates(p, customs)?;
        Ok(all_templates(p))
    })
}
