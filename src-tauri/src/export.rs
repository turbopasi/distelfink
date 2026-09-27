//! Export/Compile (Phase 6): Binder-Struktur + Szenen zu einem finalen Dokument
//! zusammenführen — als DOCX, PDF, ePub, Markdown oder reiner Text.
//!
//! Ablauf: ausgewählte Binder-Teile werden in ein neutrales Dokumentmodell
//! kompiliert (Kapitel → Blöcke aus Überschriften/Absätzen/Szenentrennern),
//! danach rendert ein formatspezifischer Writer. Formatierungsvorlagen
//! (Schrift, Ränder, Kopfzeile, …) sind projektbezogen in
//! `export-templates.json` gespeichert; zwei Vorlagen sind fest eingebaut,
//! darunter die Normseiten-Vorlage nach deutscher Verlagskonvention.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::project::{
    catch_panic, detached_project, scene_rel_path, with_project, AppState, BinderNode, NodeKind,
    OpenProject,
};

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
    /// Silbentrennung im ePub. PDF und DOCX trennen nicht — dort entscheidet
    /// das Textverarbeitungsprogramm bzw. genpdf, nicht wir.
    #[serde(default)]
    pub hyphenation: bool,
    /// BCP-47-Sprachcode für die ePub-Metadaten und xml:lang; leer = "de".
    /// Ohne ihn trennt kein E-Reader.
    #[serde(default)]
    pub language: String,
}

impl ExportTemplate {
    /// Grundausrichtung der Vorlage; unbekannte Werte fallen auf links zurück.
    fn base_align(&self) -> Align {
        Align::parse(&self.alignment).unwrap_or(Align::Left)
    }

    fn lang(&self) -> &str {
        if self.language.trim().is_empty() { "de" } else { self.language.trim() }
    }
}

fn builtin_templates() -> Vec<ExportTemplate> {
    vec![
        ExportTemplate {
            id: "builtin-standard".into(),
            name: "Standard".into(),
            built_in: true,
            font: "georgia".into(),
            font_size_pt: 11.0,
            line_spacing: 1.15,
            margins_mm: MarginsMm { top: 20.0, bottom: 20.0, left: 25.0, right: 25.0 },
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
            margins_mm: MarginsMm { top: 25.0, bottom: 25.0, left: 25.0, right: 40.0 },
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
struct TemplatesFile {
    templates: Vec<ExportTemplate>,
}

fn load_custom_templates(p: &OpenProject) -> Vec<ExportTemplate> {
    fs::read_to_string(p.abs(TEMPLATES_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<TemplatesFile>(&raw).ok())
        .map(|f| f.templates)
        .unwrap_or_default()
}

fn store_custom_templates(p: &OpenProject, templates: Vec<ExportTemplate>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&TemplatesFile { templates })
        .map_err(|e| format!("Vorlagen serialisieren: {e}"))?;
    crate::fsutil::write_atomic(&p.abs(TEMPLATES_FILE), json).map_err(|e| format!("Vorlagen schreiben: {e}"))
}

fn all_templates(p: &OpenProject) -> Vec<ExportTemplate> {
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

// ---------------------------------------------------------------------------
// Dokumentmodell + Kompilierung
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Inline {
    text: String,
    bold: bool,
    italic: bool,
}

/// Absatzausrichtung. Markdown kennt keine — der Editor speichert sie als
/// `<div style="text-align: …">`-Wrapper (siehe src/components/TextAlignMarkdown.ts),
/// und genau den liest `parse_markdown` hier wieder aus.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Align {
    Left,
    Center,
    Right,
    Justify,
}

impl Align {
    fn parse(s: &str) -> Option<Align> {
        match s.trim() {
            "left" => Some(Align::Left),
            "center" => Some(Align::Center),
            "right" => Some(Align::Right),
            "justify" => Some(Align::Justify),
            _ => None,
        }
    }

    fn css(self) -> &'static str {
        match self {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
            Align::Justify => "justify",
        }
    }
}

/// OOXML schreibt Blocksatz als "both" — "justified" ist kein gültiger
/// ST_Jc-Wert, auch wenn docx-rs die Variante anbietet.
fn docx_align(a: Align) -> docx_rs::AlignmentType {
    use docx_rs::AlignmentType;
    match a {
        Align::Left => AlignmentType::Left,
        Align::Center => AlignmentType::Center,
        Align::Right => AlignmentType::Right,
        Align::Justify => AlignmentType::Both,
    }
}

/// Liest `text-align: <wert>` aus einem HTML-Schnipsel.
fn align_in_html(html: &str) -> Option<Align> {
    let rest = html.split("text-align:").nth(1)?;
    let value: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    Align::parse(&value)
}

enum Block {
    /// level 1 = Kapitel, 2 = Unterkapitel/Szene, 3 = tiefer.
    Heading { level: u8, text: String },
    /// `align` ist die *explizite* Ausrichtung des Absatzes; None heißt
    /// „Grundausrichtung der Vorlage".
    Paragraph { inlines: Vec<Inline>, align: Option<Align> },
    /// Szenentrenner (Text kommt aus der Vorlage).
    Separator,
}

/// Ein Export-Kapitel = ein Top-Level-Eintrag des Binders (Kapitel oder
/// lose Szene). ePub macht daraus je eine Inhaltsdatei; PDF/DOCX beginnen
/// hier optional eine neue Seite.
struct CompChapter {
    /// Titel fürs Inhaltsverzeichnis (immer vorhanden).
    toc_title: String,
    /// Überschrift im Fließtext (None z. B. bei loser Szene ohne Szenentitel).
    heading: Option<String>,
    blocks: Vec<Block>,
}

fn parse_markdown(md: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut cur: Vec<Inline> = Vec::new();
    let mut heading_text = String::new();
    let mut in_heading: Option<u8> = None;
    let mut bold = 0u32;
    let mut italic = 0u32;

    // Verschachtelte Wrapper sind zwar nicht vorgesehen, ein Stapel kostet aber
    // nichts und macht ein unerwartetes `</div>` harmlos.
    let mut align_stack: Vec<Align> = Vec::new();

    let flush_para = |cur: &mut Vec<Inline>, blocks: &mut Vec<Block>, align: Option<Align>| {
        if !cur.is_empty() {
            blocks.push(Block::Paragraph { inlines: std::mem::take(cur), align });
        }
    };

    for ev in Parser::new(md) {
        match ev {
            Event::Start(Tag::Heading { level, .. }) => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
                heading_text.clear();
                in_heading = Some(match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    _ => 3,
                });
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(level) = in_heading.take() {
                    blocks.push(Block::Heading { level, text: std::mem::take(&mut heading_text) });
                }
            }
            Event::End(TagEnd::Paragraph) | Event::End(TagEnd::Item) => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
            }
            Event::Start(Tag::Item) => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
                cur.push(Inline { text: "• ".into(), bold: false, italic: false });
            }
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Text(t) | Event::Code(t) => {
                if in_heading.is_some() {
                    heading_text.push_str(&t);
                } else {
                    cur.push(Inline { text: t.to_string(), bold: bold > 0, italic: italic > 0 });
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if in_heading.is_some() {
                    heading_text.push(' ');
                } else {
                    cur.push(Inline { text: " ".into(), bold: bold > 0, italic: italic > 0 });
                }
            }
            Event::Rule => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
                blocks.push(Block::Separator);
            }
            // Die Ausrichtungs-Wrapper des Editors. Der Absatz dazwischen ist
            // gewöhnliches Markdown und läuft durch die Arme oben.
            Event::Html(h) | Event::InlineHtml(h) => {
                if let Some(a) = align_in_html(&h) {
                    align_stack.push(a);
                } else if h.contains("</div>") {
                    align_stack.pop();
                }
            }
            _ => {}
        }
    }
    flush_para(&mut cur, &mut blocks, align_stack.last().copied());
    blocks
}

fn read_scene_blocks(p: &OpenProject, id: &str) -> Vec<Block> {
    // Fehlende Datei (extern gelöscht) bricht den Export nicht ab.
    let md = fs::read_to_string(p.abs(&scene_rel_path(id))).unwrap_or_default();
    parse_markdown(&md)
}

/// Sammelt die Blöcke aller ausgewählten Kinder eines Kapitels (rekursiv).
fn collect_child_blocks(
    p: &OpenProject,
    parent: &BinderNode,
    include: &HashSet<String>,
    tpl: &ExportTemplate,
    depth: u8,
    out: &mut Vec<Block>,
) {
    let mut prev_was_scene = false;
    for child in &parent.children {
        if !include.contains(&child.id) {
            continue;
        }
        match child.kind {
            NodeKind::Chapter => {
                prev_was_scene = false;
                out.push(Block::Heading { level: depth.min(3), text: child.title.clone() });
                collect_child_blocks(p, child, include, tpl, depth + 1, out);
            }
            NodeKind::Scene => {
                if tpl.include_scene_titles {
                    out.push(Block::Heading { level: depth.min(3), text: child.title.clone() });
                } else if prev_was_scene {
                    out.push(Block::Separator);
                }
                out.extend(read_scene_blocks(p, &child.id));
                prev_was_scene = true;
            }
        }
    }
}

fn compile_chapters(
    p: &OpenProject,
    include: &HashSet<String>,
    tpl: &ExportTemplate,
) -> Result<Vec<CompChapter>, String> {
    let mut chapters = Vec::new();
    for node in &p.meta.binder {
        if !include.contains(&node.id) {
            continue;
        }
        match node.kind {
            NodeKind::Chapter => {
                let mut blocks = Vec::new();
                collect_child_blocks(p, node, include, tpl, 2, &mut blocks);
                chapters.push(CompChapter {
                    toc_title: node.title.clone(),
                    heading: Some(node.title.clone()),
                    blocks,
                });
            }
            NodeKind::Scene => {
                chapters.push(CompChapter {
                    toc_title: node.title.clone(),
                    heading: tpl.include_scene_titles.then(|| node.title.clone()),
                    blocks: read_scene_blocks(p, &node.id),
                });
            }
        }
    }
    if chapters.is_empty() {
        return Err("Keine Inhalte für den Export ausgewählt".into());
    }
    Ok(chapters)
}

/// Ersetzt {titel} und {autor}; {seite} bleibt für die Writer stehen.
fn fill_placeholders(s: &str, title: &str, author: &str) -> String {
    s.replace("{titel}", title).replace("{autor}", author)
}

fn separator_text(tpl: &ExportTemplate) -> &str {
    if tpl.scene_separator.trim().is_empty() { "" } else { tpl.scene_separator.trim() }
}

// ---------------------------------------------------------------------------
// Writer: Markdown / TXT
// ---------------------------------------------------------------------------

fn inline_to_md(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for i in inlines {
        let mark = match (i.bold, i.italic) {
            (true, true) => "***",
            (true, false) => "**",
            (false, true) => "*",
            (false, false) => "",
        };
        // Marker nicht um reine Leerzeichen legen (ergäbe kaputtes Markdown).
        if i.text.trim().is_empty() {
            out.push_str(&i.text);
        } else {
            out.push_str(mark);
            out.push_str(&i.text);
            out.push_str(mark);
        }
    }
    out
}

fn inline_to_text(inlines: &[Inline]) -> String {
    inlines.iter().map(|i| i.text.as_str()).collect()
}

fn write_markdown(chapters: &[CompChapter], tpl: &ExportTemplate, plain: bool) -> String {
    let sep = separator_text(tpl);
    let mut out = String::new();
    for ch in chapters {
        if let Some(h) = &ch.heading {
            if plain {
                out.push_str(&h.to_uppercase());
                out.push_str("\n\n");
            } else {
                out.push_str(&format!("# {h}\n\n"));
            }
        }
        for b in &ch.blocks {
            match b {
                Block::Heading { level, text } => {
                    if plain {
                        out.push_str(text);
                        out.push_str("\n\n");
                    } else {
                        out.push_str(&format!("{} {text}\n\n", "#".repeat(*level as usize)));
                    }
                }
                Block::Paragraph { inlines, .. } => {
                    let line =
                        if plain { inline_to_text(inlines) } else { inline_to_md(inlines) };
                    out.push_str(line.trim_end());
                    out.push_str("\n\n");
                }
                Block::Separator => {
                    out.push_str(if sep.is_empty() { "\n" } else { sep });
                    out.push_str("\n\n");
                }
            }
        }
    }
    out.trim_end().to_string() + "\n"
}

// ---------------------------------------------------------------------------
// Writer: DOCX
// ---------------------------------------------------------------------------

fn docx_font_name(font: &str) -> &'static str {
    match font {
        "times" => "Times New Roman",
        "georgia" => "Georgia",
        "arial" => "Arial",
        "courier" => "Courier New",
        _ => "Times New Roman",
    }
}

fn mm_to_twips(mm: f32) -> i32 {
    (mm / 25.4 * 1440.0).round() as i32
}

fn write_docx(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    title: &str,
    author: &str,
    out_path: &Path,
) -> Result<(), String> {
    use docx_rs::*;

    let font = docx_font_name(&tpl.font);
    let fonts = || RunFonts::new().ascii(font).hi_ansi(font).cs(font).east_asia(font);
    let half_points = (tpl.font_size_pt * 2.0).round() as usize;
    let line = (tpl.line_spacing * 240.0).round() as u32;
    let spacing = || LineSpacing::new().line_rule(LineSpacingType::Auto).line(line as i32);

    let body_run = |i: &Inline| {
        let mut r = Run::new().add_text(&i.text).fonts(fonts()).size(half_points);
        if i.bold {
            r = r.bold();
        }
        if i.italic {
            r = r.italic();
        }
        r
    };
    let heading_par = |level: u8, text: &str| {
        let size = half_points + (8 - 2 * level.min(3) as usize);
        Paragraph::new()
            .add_run(Run::new().add_text(text).fonts(fonts()).size(size).bold())
            .line_spacing(spacing())
    };

    let mut docx = Docx::new()
        .page_size(11906, 16838) // A4 in Twips
        .page_margin(
            PageMargin::new()
                .top(mm_to_twips(tpl.margins_mm.top))
                .bottom(mm_to_twips(tpl.margins_mm.bottom))
                .left(mm_to_twips(tpl.margins_mm.left))
                .right(mm_to_twips(tpl.margins_mm.right))
                .header(mm_to_twips((tpl.margins_mm.top - 12.0).max(6.0))),
        )
        .default_fonts(fonts())
        .default_size(half_points);

    if !tpl.header.trim().is_empty() {
        let text = fill_placeholders(&tpl.header, title, author);
        let mut par = Paragraph::new().align(AlignmentType::Right);
        // {seite} wird als echtes Seitenzahl-Feld eingesetzt.
        let mut rest = text.as_str();
        loop {
            match rest.split_once("{seite}") {
                Some((before, after)) => {
                    if !before.is_empty() {
                        par = par.add_run(
                            Run::new().add_text(before).fonts(fonts()).size(half_points),
                        );
                    }
                    par = par.add_page_num(PageNum::new());
                    rest = after;
                }
                None => {
                    if !rest.is_empty() {
                        par = par
                            .add_run(Run::new().add_text(rest).fonts(fonts()).size(half_points));
                    }
                    break;
                }
            }
        }
        docx = docx.header(Header::new().add_paragraph(par));
    }

    let sep = separator_text(tpl);
    let base_align = tpl.base_align();
    for (ci, ch) in chapters.iter().enumerate() {
        let mut first_in_chapter = true;
        let mut push = |docx: &mut Docx, mut par: Paragraph| {
            if first_in_chapter && ci > 0 && tpl.chapter_start_new_page {
                par = par.page_break_before(true);
            }
            first_in_chapter = false;
            *docx = std::mem::take(docx).add_paragraph(par);
        };

        if let Some(h) = &ch.heading {
            push(&mut docx, heading_par(1, h));
        }
        for b in &ch.blocks {
            match b {
                Block::Heading { level, text } => push(&mut docx, heading_par(*level, text)),
                Block::Paragraph { inlines, align } => {
                    let mut par = Paragraph::new()
                        .line_spacing(spacing())
                        .align(docx_align(align.unwrap_or(base_align)));
                    for i in inlines {
                        par = par.add_run(body_run(i));
                    }
                    push(&mut docx, par);
                }
                Block::Separator => {
                    let par = Paragraph::new()
                        .align(AlignmentType::Center)
                        .line_spacing(spacing())
                        .add_run(Run::new().add_text(sep).fonts(fonts()).size(half_points));
                    push(&mut docx, par);
                }
            }
        }
    }

    let file =
        fs::File::create(out_path).map_err(|e| format!("Datei anlegen: {e}"))?;
    docx.build().pack(file).map_err(|e| format!("DOCX schreiben: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Writer: ePub
// ---------------------------------------------------------------------------

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn inlines_to_xhtml(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for i in inlines {
        let esc = xml_escape(&i.text);
        match (i.bold, i.italic) {
            (true, true) => out.push_str(&format!("<strong><em>{esc}</em></strong>")),
            (true, false) => out.push_str(&format!("<strong>{esc}</strong>")),
            (false, true) => out.push_str(&format!("<em>{esc}</em>")),
            (false, false) => out.push_str(&esc),
        }
    }
    out
}

fn chapter_to_xhtml(ch: &CompChapter, tpl: &ExportTemplate) -> String {
    let sep = separator_text(tpl);
    let mut body = String::new();
    if let Some(h) = &ch.heading {
        body.push_str(&format!("<h1>{}</h1>\n", xml_escape(h)));
    }
    for b in &ch.blocks {
        match b {
            Block::Heading { level, text } => {
                let l = (*level).clamp(1, 3) + 1; // Kapiteltitel ist h1
                body.push_str(&format!("<h{l}>{}</h{l}>\n", xml_escape(text)));
            }
            Block::Paragraph { inlines, align } => {
                // Nur die *explizite* Ausrichtung wird inline gesetzt; die
                // Grundausrichtung steht einmal im Stylesheet.
                match align {
                    Some(a) => body.push_str(&format!(
                        "<p style=\"text-align: {}\">{}</p>\n",
                        a.css(),
                        inlines_to_xhtml(inlines)
                    )),
                    None => body.push_str(&format!("<p>{}</p>\n", inlines_to_xhtml(inlines))),
                }
            }
            Block::Separator => {
                if sep.is_empty() {
                    body.push_str("<p class=\"sep\">&#160;</p>\n");
                } else {
                    body.push_str(&format!("<p class=\"sep\">{}</p>\n", xml_escape(sep)));
                }
            }
        }
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"{lang}\" lang=\"{lang}\">\n<head><title>{}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>\n<body>\n{body}</body>\n</html>\n",
        xml_escape(&ch.toc_title),
        lang = xml_escape(tpl.lang())
    )
}

fn write_epub(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    title: &str,
    author: &str,
    out_path: &Path,
) -> Result<(), String> {
    use epub_builder::{EpubBuilder, EpubContent, EpubVersion, ReferenceType, ZipLibrary};
    let e = |e: &dyn std::fmt::Display| format!("ePub: {e}");

    let generic = match tpl.font.as_str() {
        "arial" => "sans-serif",
        "courier" => "monospace",
        _ => "serif",
    };
    // -epub-hyphens ist die Eigenschaft, auf die Apple Books und ältere Reader
    // hören; -webkit-hyphens deckt die WebKit-basierten ab.
    let hyphens = if tpl.hyphenation {
        "  hyphens: auto; -webkit-hyphens: auto; -epub-hyphens: auto;"
    } else {
        ""
    };
    let css = format!(
        "body {{ font-family: {generic}; line-height: {spacing}; margin: 1em;\n\
         {} text-align: {align}; }}\n\
         h1, h2, h3, h4 {{ font-weight: bold; text-align: left; hyphens: manual; }}\n\
         p {{ margin: 0 0 0.6em 0; }}\n\
         p.sep {{ text-align: center; margin: 1em 0; }}\n",
        hyphens,
        spacing = tpl.line_spacing,
        align = tpl.base_align().css()
    );

    let mut builder = EpubBuilder::new(ZipLibrary::new().map_err(|x| e(&x))?).map_err(|x| e(&x))?;
    builder.epub_version(EpubVersion::V30);
    builder.metadata("title", title).map_err(|x| e(&x))?;
    if !author.trim().is_empty() {
        builder.metadata("author", author).map_err(|x| e(&x))?;
    }
    builder.metadata("lang", tpl.lang()).map_err(|x| e(&x))?;
    builder.stylesheet(css.as_bytes()).map_err(|x| e(&x))?;

    for (i, ch) in chapters.iter().enumerate() {
        let xhtml = chapter_to_xhtml(ch, tpl);
        builder
            .add_content(
                EpubContent::new(format!("chapter-{i:03}.xhtml"), xhtml.as_bytes())
                    .title(&ch.toc_title)
                    .reftype(ReferenceType::Text),
            )
            .map_err(|x| e(&x))?;
    }

    let mut out: Vec<u8> = Vec::new();
    builder.generate(&mut out).map_err(|x| e(&x))?;
    fs::write(out_path, out).map_err(|x| format!("Datei schreiben: {x}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Writer: PDF
// ---------------------------------------------------------------------------

/// Kandidaten-Dateisätze [Regular, Bold, Italic, BoldItalic] je Schriftwahl,
/// in Prioritätsreihenfolge (Windows-Systemfonts, dann Linux-Äquivalente).
fn font_candidates(font: &str) -> Vec<[String; 4]> {
    let win = |base: [&str; 4]| -> [String; 4] {
        let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        base.map(|f| format!("{dir}\\Fonts\\{f}"))
    };
    let linux = |dir: &str, base: [&str; 4]| -> [String; 4] { base.map(|f| format!("{dir}/{f}")) };

    let liberation_dirs = [
        "/usr/share/fonts/truetype/liberation",
        "/usr/share/fonts/liberation",
        "/usr/share/fonts/truetype/liberation2",
    ];
    let dejavu_dirs = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"];

    let mut c: Vec<[String; 4]> = Vec::new();
    match font {
        "georgia" => {
            c.push(win(["georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"]));
        }
        "arial" => {
            c.push(win(["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"]));
            for d in liberation_dirs {
                c.push(linux(d, [
                    "LiberationSans-Regular.ttf",
                    "LiberationSans-Bold.ttf",
                    "LiberationSans-Italic.ttf",
                    "LiberationSans-BoldItalic.ttf",
                ]));
            }
            for d in dejavu_dirs {
                c.push(linux(d, [
                    "DejaVuSans.ttf",
                    "DejaVuSans-Bold.ttf",
                    "DejaVuSans-Oblique.ttf",
                    "DejaVuSans-BoldOblique.ttf",
                ]));
            }
        }
        "courier" => {
            c.push(win(["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"]));
            for d in liberation_dirs {
                c.push(linux(d, [
                    "LiberationMono-Regular.ttf",
                    "LiberationMono-Bold.ttf",
                    "LiberationMono-Italic.ttf",
                    "LiberationMono-BoldItalic.ttf",
                ]));
            }
        }
        _ => {}
    }
    // Serifen-Fallback-Kette gilt für "times", "georgia" und Unbekanntes.
    if font != "arial" && font != "courier" {
        c.push(win(["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"]));
        for d in liberation_dirs {
            c.push(linux(d, [
                "LiberationSerif-Regular.ttf",
                "LiberationSerif-Bold.ttf",
                "LiberationSerif-Italic.ttf",
                "LiberationSerif-BoldItalic.ttf",
            ]));
        }
        for d in dejavu_dirs {
            c.push(linux(d, [
                "DejaVuSerif.ttf",
                "DejaVuSerif-Bold.ttf",
                "DejaVuSerif-Italic.ttf",
                "DejaVuSerif-BoldItalic.ttf",
            ]));
        }
    }
    c
}

fn load_pdf_fonts(font: &str) -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    for set in font_candidates(font) {
        if !set.iter().all(|p| Path::new(p).is_file()) {
            continue;
        }
        let load = |path: &str| -> Result<genpdf::fonts::FontData, String> {
            let bytes = fs::read(path).map_err(|e| format!("Font lesen ({path}): {e}"))?;
            genpdf::fonts::FontData::new(bytes, None)
                .map_err(|e| format!("Font ungültig ({path}): {e}"))
        };
        return Ok(genpdf::fonts::FontFamily {
            regular: load(&set[0])?,
            bold: load(&set[1])?,
            italic: load(&set[2])?,
            bold_italic: load(&set[3])?,
        });
    }
    Err("Keine passende Schriftart auf dem System gefunden (für PDF-Export wird \
         z. B. Times New Roman, Liberation Serif oder DejaVu Serif benötigt)"
        .into())
}

fn write_pdf(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    title: &str,
    author: &str,
    out_path: &Path,
) -> Result<(), String> {
    use genpdf::elements::{Break, PageBreak, Paragraph};
    use genpdf::style::Style;
    use genpdf::{Alignment, Element, Margins};

    let family = load_pdf_fonts(&tpl.font)?;
    let mut doc = genpdf::Document::new(family);
    doc.set_title(title);
    doc.set_paper_size(genpdf::PaperSize::A4);
    let base_size = tpl.font_size_pt.round().clamp(6.0, 32.0) as u8;
    doc.set_font_size(base_size);
    doc.set_line_spacing(tpl.line_spacing as f64);

    let mut dec = genpdf::SimplePageDecorator::new();
    dec.set_margins(Margins::trbl(
        tpl.margins_mm.top as f64,
        tpl.margins_mm.right as f64,
        tpl.margins_mm.bottom as f64,
        tpl.margins_mm.left as f64,
    ));
    if !tpl.header.trim().is_empty() {
        let text = fill_placeholders(&tpl.header, title, author);
        let header_size = base_size.saturating_sub(2).max(6);
        dec.set_header(move |page| {
            Paragraph::new(text.replace("{seite}", &page.to_string()))
                .aligned(Alignment::Right)
                .styled(Style::new().with_font_size(header_size))
                .padded(Margins::trbl(0.0, 0.0, 4.0, 0.0))
        });
    }
    doc.set_page_decorator(dec);

    let sep = separator_text(tpl).to_string();
    let base_align = tpl.base_align();
    let para_gap = 1.5; // mm Abstand nach Absätzen

    for (ci, ch) in chapters.iter().enumerate() {
        if ci > 0 && tpl.chapter_start_new_page {
            doc.push(PageBreak::new());
        }
        if let Some(h) = &ch.heading {
            doc.push(
                Paragraph::new(h.as_str())
                    .styled(Style::new().bold().with_font_size(base_size + 4))
                    .padded(Margins::trbl(0.0, 0.0, 6.0, 0.0)),
            );
        }
        for b in &ch.blocks {
            match b {
                Block::Heading { level, text } => {
                    let size = base_size + (6 - 2 * (*level).min(3));
                    doc.push(
                        Paragraph::new(text.as_str())
                            .styled(Style::new().bold().with_font_size(size))
                            .padded(Margins::trbl(2.0, 0.0, 3.0, 0.0)),
                    );
                }
                Block::Paragraph { inlines, align } => {
                    // genpdf kennt keinen Blocksatz — Justify landet auf links.
                    let mut par = Paragraph::default().aligned(match align.unwrap_or(base_align) {
                        Align::Center => Alignment::Center,
                        Align::Right => Alignment::Right,
                        _ => Alignment::Left,
                    });
                    for i in inlines {
                        let mut style = Style::new();
                        if i.bold {
                            style = style.bold();
                        }
                        if i.italic {
                            style = style.italic();
                        }
                        par.push_styled(i.text.clone(), style);
                    }
                    doc.push(par.padded(Margins::trbl(0.0, 0.0, para_gap, 0.0)));
                }
                Block::Separator => {
                    if sep.is_empty() {
                        doc.push(Break::new(1.0));
                    } else {
                        doc.push(
                            Paragraph::new(sep.as_str())
                                .aligned(Alignment::Center)
                                .padded(Margins::trbl(2.0, 0.0, 2.0, 0.0)),
                        );
                    }
                }
            }
        }
    }

    doc.render_to_file(out_path).map_err(|e| format!("PDF schreiben: {e}"))
}

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

/// Exportiert die ausgewählten Binder-Teile in `out_path`.
/// Die Vorlage kommt komplett vom Frontend — so wirken auch ungespeicherte
/// Anpassungen aus dem Export-Dialog.
#[tauri::command(async)]
pub fn export_project(
    format: ExportFormat,
    template: ExportTemplate,
    include_ids: Vec<String>,
    out_path: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let p = &detached_project(&state)?;
    catch_panic("Der Export", || {
        let include: HashSet<String> = include_ids.into_iter().collect();
        let chapters = compile_chapters(p, &include, &template)?;
        let title = p.meta.title.clone();
        let author = p.meta.author.clone();

        // Endung sicherstellen (Save-Dialoge liefern sie nicht auf jeder Plattform).
        let ext = format.extension();
        let mut path = std::path::PathBuf::from(&out_path);
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
        Ok(path.to_string_lossy().into_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{BinderNode, ProjectMeta, FORMAT_VERSION};
    use std::collections::HashMap;

    /// Legt ein Wegwerf-Projekt mit zwei Kapiteln und drei Szenen an.
    fn test_project(dir: &Path) -> (OpenProject, HashSet<String>) {
        fs::create_dir_all(dir.join("manuscript")).unwrap();
        let scenes = [
            ("szene-aaa111", "Es war **dunkel** und *kalt*.\n\nEin zweiter Absatz mit Umlauten: äöüß."),
            ("szene-bbb222", "## Zwischenüberschrift\n\nText nach der Überschrift."),
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
            "kap-1", "kap-2", "szene-aaa111", "szene-bbb222", "szene-ccc333",
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

        write_docx(&chapters, tpl, "Testroman", "Test Autor", &dir.join("out.docx")).unwrap();
        write_epub(&chapters, tpl, "Testroman", "Test Autor", &dir.join("out.epub")).unwrap();
        write_pdf(&chapters, tpl, "Testroman", "Test Autor", &dir.join("out.pdf")).unwrap();
        for f in ["out.docx", "out.epub", "out.pdf"] {
            assert!(fs::metadata(dir.join(f)).unwrap().len() > 500, "{f} zu klein");
        }

        // Auswahl wirkt: Kapitel 2 abgewählt → nur ein Export-Kapitel.
        let partial: HashSet<String> =
            ["kap-1", "szene-aaa111"].iter().map(|s| s.to_string()).collect();
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
