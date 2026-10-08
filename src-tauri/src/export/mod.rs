//! Export/Compile (Phase 6): Binder-Struktur + Szenen zu einem finalen Dokument
//! zusammenführen — als DOCX, PDF, ePub, Markdown oder reiner Text.
//!
//! Ablauf: ausgewählte Binder-Teile werden in ein neutrales Dokumentmodell
//! kompiliert (Kapitel → Blöcke aus Überschriften/Absätzen/Szenentrennern),
//! danach rendert ein formatspezifischer Writer. Formatierungsvorlagen
//! (Schrift, Ränder, Kopfzeile, …) sind projektbezogen in
//! `export-templates.json` gespeichert; zwei Vorlagen sind fest eingebaut,
//! darunter die Normseiten-Vorlage nach deutscher Verlagskonvention.

mod docx;
mod epub;
mod markdown;
mod model;
mod pdf;
pub(crate) mod templates;

use serde::Deserialize;
use std::collections::HashSet;
use std::fs;

use crate::project::{catch_panic, detached_project, AppState};
use docx::write_docx;
use epub::write_epub;
use markdown::write_markdown;
use model::compile_chapters;
use pdf::write_pdf;
use templates::ExportTemplate;

// ---------------------------------------------------------------------------
// Export-Command
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Docx,
    Pdf,
    Epub,
    Markdown,
    Txt,
}

impl ExportFormat {
    /// Für den Dateifilter im Speichern-Dialog.
    fn label(self) -> &'static str {
        match self {
            ExportFormat::Docx => "Word (DOCX)",
            ExportFormat::Pdf => "PDF",
            ExportFormat::Epub => "ePub (E-Book)",
            ExportFormat::Markdown => "Markdown",
            ExportFormat::Txt => "Reiner Text (TXT)",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            ExportFormat::Docx => "docx",
            ExportFormat::Pdf => "pdf",
            ExportFormat::Epub => "epub",
            ExportFormat::Markdown => "md",
            ExportFormat::Txt => "txt",
        }
    }
}

/// Fragt nach dem Speicherort und exportiert die ausgewählten Binder-Teile
/// dorthin; liefert den geschriebenen Pfad (None = abgebrochen).
/// Die Vorlage kommt komplett vom Frontend — so wirken auch ungespeicherte
/// Anpassungen aus dem Export-Dialog.
#[tauri::command(async)]
pub fn export_project(
    window: tauri::Window,
    format: ExportFormat,
    template: ExportTemplate,
    include_ids: Vec<String>,
    state: tauri::State<AppState>,
) -> Result<Option<String>, String> {
    let p = &detached_project(&state)?;
    let ext = format.extension();
    let file_name = format!("{}.{ext}", p.meta.title);
    let filter = (format.label(), ext);
    let Some(mut path) =
        crate::dialogs::pick_save(&window, "Exportieren als …", &file_name, filter)?
    else {
        return Ok(None);
    };
    catch_panic("Der Export", || {
        let include: HashSet<String> = include_ids.into_iter().collect();
        let chapters = compile_chapters(p, &include, &template)?;
        let title = p.meta.title.clone();
        let author = p.meta.author.clone();

        // Endung sicherstellen (Save-Dialoge liefern sie nicht auf jeder Plattform).
        if path.extension().map(|e| e.to_string_lossy().to_lowercase()) != Some(ext.into()) {
            path.set_extension(ext);
        }

        match format {
            ExportFormat::Markdown => {
                fs::write(&path, write_markdown(&chapters, &template, false))
                    .map_err(|e| format!("Datei schreiben: {e}"))?;
            }
            ExportFormat::Txt => {
                fs::write(&path, write_markdown(&chapters, &template, true))
                    .map_err(|e| format!("Datei schreiben: {e}"))?;
            }
            ExportFormat::Docx => write_docx(&chapters, &template, &title, &author, &path)?,
            ExportFormat::Epub => write_epub(&chapters, &template, &title, &author, &path)?,
            ExportFormat::Pdf => write_pdf(&chapters, &template, &title, &author, &path)?,
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    })
}

#[cfg(test)]
mod tests {
    use super::markdown::{inline_to_md, inline_to_text};
    use super::model::{parse_markdown, Align, Block};
    use super::templates::builtin_templates;
    use super::*;
    use crate::project::{BinderNode, NodeKind, OpenProject, ProjectMeta, FORMAT_VERSION};
    use std::collections::HashMap;
    use std::path::Path;

    /// Legt ein Wegwerf-Projekt mit zwei Kapiteln und drei Szenen an.
    fn test_project(dir: &Path) -> (OpenProject, HashSet<String>) {
        fs::create_dir_all(dir.join("manuscript")).unwrap();
        let scenes = [
            (
                "szene-aaa111",
                "Es war **dunkel** und *kalt*.\n\nEin zweiter Absatz mit Umlauten: äöüß.",
            ),
            (
                "szene-bbb222",
                "## Zwischenüberschrift\n\nText nach der Überschrift.",
            ),
            ("szene-ccc333", "Dritte Szene, ***fett und kursiv***."),
        ];
        for (id, md) in scenes {
            fs::write(dir.join(format!("manuscript/{id}.md")), md).unwrap();
        }
        let scene = |id: &str, title: &str| BinderNode {
            id: id.into(),
            kind: NodeKind::Scene,
            title: title.into(),
            synopsis: String::new(),
            status: "draft".into(),
            color: None,
            tags: vec![],
            image: None,
            children: vec![],
        };
        let meta = ProjectMeta {
            format_version: FORMAT_VERSION,
            title: "Testroman".into(),
            author: "Test Autor".into(),
            created: String::new(),
            binder: vec![
                BinderNode {
                    id: "kap-1".into(),
                    kind: NodeKind::Chapter,
                    title: "Kapitel 1".into(),
                    synopsis: String::new(),
                    status: "draft".into(),
                    color: None,
                    tags: vec![],
                    image: None,
                    children: vec![
                        scene("szene-aaa111", "Anfang"),
                        scene("szene-bbb222", "Mitte"),
                    ],
                },
                BinderNode {
                    id: "kap-2".into(),
                    kind: NodeKind::Chapter,
                    title: "Kapitel 2".into(),
                    synopsis: String::new(),
                    status: "draft".into(),
                    color: None,
                    tags: vec![],
                    image: None,
                    children: vec![scene("szene-ccc333", "Ende")],
                },
            ],
        };
        let include = [
            "kap-1",
            "kap-2",
            "szene-aaa111",
            "szene-bbb222",
            "szene-ccc333",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let p = OpenProject {
            root: dir.to_path_buf(),
            meta,
            known_mtimes: HashMap::new(),
            search_dirty: false,
        };
        (p, include)
    }

    #[test]
    fn export_all_formats() {
        let dir = std::env::temp_dir().join(format!("autorproj-test-{}", uuid::Uuid::new_v4()));
        let (p, include) = test_project(&dir);
        let tpl = &builtin_templates()[1]; // Normseite
        let chapters = compile_chapters(&p, &include, tpl).unwrap();
        assert_eq!(chapters.len(), 2);

        let md = write_markdown(&chapters, tpl, false);
        assert!(md.contains("# Kapitel 1"));
        assert!(md.contains("**dunkel**"));
        assert!(md.contains("* * *")); // Szenentrenner zwischen Szene 1 und 2

        let txt = write_markdown(&chapters, tpl, true);
        assert!(txt.contains("KAPITEL 1"));
        assert!(txt.contains("dunkel") && !txt.contains("**"));

        write_docx(
            &chapters,
            tpl,
            "Testroman",
            "Test Autor",
            &dir.join("out.docx"),
        )
        .unwrap();
        write_epub(
            &chapters,
            tpl,
            "Testroman",
            "Test Autor",
            &dir.join("out.epub"),
        )
        .unwrap();
        write_pdf(
            &chapters,
            tpl,
            "Testroman",
            "Test Autor",
            &dir.join("out.pdf"),
        )
        .unwrap();
        for f in ["out.docx", "out.epub", "out.pdf"] {
            assert!(
                fs::metadata(dir.join(f)).unwrap().len() > 500,
                "{f} zu klein"
            );
        }

        // Auswahl wirkt: Kapitel 2 abgewählt → nur ein Export-Kapitel.
        let partial: HashSet<String> = ["kap-1", "szene-aaa111"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let chapters = compile_chapters(&p, &partial, tpl).unwrap();
        assert_eq!(chapters.len(), 1);
        assert!(!write_markdown(&chapters, tpl, false).contains("Dritte Szene"));

        fs::remove_dir_all(&dir).ok();
    }

    /// Planungs-Tags stehen als Markdown-Link mit eigenem Schema im Manuskript
    /// (`[Er](person:jonas-…)`) — im Export darf davon nur das Wort übrig bleiben.
    #[test]
    fn plan_tags_export_as_plain_text() {
        let blocks = parse_markdown(
            "Am Abend kam [Er](person:jonas-3f2a1b) durch [den Wald](location:wald-9c11ab).",
        );
        let Block::Paragraph { inlines, .. } = &blocks[0] else {
            panic!("kein Absatz");
        };
        assert_eq!(inline_to_text(inlines), "Am Abend kam Er durch den Wald.");
        let md = inline_to_md(inlines);
        assert!(!md.contains("person:"), "Tag-Ziel im Export: {md}");
        assert!(!md.contains("location:"), "Tag-Ziel im Export: {md}");
    }

    /// Der Editor speichert Ausrichtung als div-Wrapper (TextAlignMarkdown.ts).
    /// Bisher fiel der im Export unter den Tisch — jetzt trägt ihn der Absatz.
    #[test]
    fn alignment_survives_export() {
        let md = r#"Ohne.

<div style="text-align: center">

Mittig.

</div>

Wieder ohne.
"#;
        let blocks = parse_markdown(md);
        let aligns: Vec<Option<Align>> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Paragraph { align, .. } => Some(*align),
                _ => None,
            })
            .collect();
        assert_eq!(aligns, vec![None, Some(Align::Center), None]);
    }

    #[test]
    fn scene_titles_as_headings() {
        let dir = std::env::temp_dir().join(format!("autorproj-test-{}", uuid::Uuid::new_v4()));
        let (p, include) = test_project(&dir);
        let mut tpl = builtin_templates()[0].clone();
        tpl.include_scene_titles = true;
        let chapters = compile_chapters(&p, &include, &tpl).unwrap();
        let md = write_markdown(&chapters, &tpl, false);
        assert!(md.contains("## Anfang"));
        assert!(md.contains("## Ende"));
        fs::remove_dir_all(&dir).ok();
    }
}
