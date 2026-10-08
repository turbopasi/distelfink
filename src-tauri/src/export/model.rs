//! Neutrales Dokumentmodell: ausgewählte Binder-Teile werden zu Kapiteln aus
//! Überschriften, Absätzen und Szenentrennern kompiliert.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use std::collections::HashSet;
use std::fs;

use super::templates::ExportTemplate;
use crate::project::{scene_rel_path, BinderNode, NodeKind, OpenProject};

// ---------------------------------------------------------------------------
// Dokumentmodell + Kompilierung
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(super) struct Inline {
    pub(super) text: String,
    pub(super) bold: bool,
    pub(super) italic: bool,
}

/// Absatzausrichtung. Markdown kennt keine — der Editor speichert sie als
/// `<div style="text-align: …">`-Wrapper (siehe src/components/TextAlignMarkdown.ts),
/// und genau den liest `parse_markdown` hier wieder aus.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Align {
    Left,
    Center,
    Right,
    Justify,
}

impl Align {
    pub(super) fn parse(s: &str) -> Option<Align> {
        match s.trim() {
            "left" => Some(Align::Left),
            "center" => Some(Align::Center),
            "right" => Some(Align::Right),
            "justify" => Some(Align::Justify),
            _ => None,
        }
    }

    pub(super) fn css(self) -> &'static str {
        match self {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
            Align::Justify => "justify",
        }
    }
}

/// Liest `text-align: <wert>` aus einem HTML-Schnipsel.
pub(super) fn align_in_html(html: &str) -> Option<Align> {
    let rest = html.split("text-align:").nth(1)?;
    let value: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    Align::parse(&value)
}

pub(super) enum Block {
    /// level 1 = Kapitel, 2 = Unterkapitel/Szene, 3 = tiefer.
    Heading { level: u8, text: String },
    /// `align` ist die *explizite* Ausrichtung des Absatzes; None heißt
    /// „Grundausrichtung der Vorlage".
    Paragraph {
        inlines: Vec<Inline>,
        align: Option<Align>,
    },
    /// Szenentrenner (Text kommt aus der Vorlage).
    Separator,
}

/// Ein Export-Kapitel = ein Top-Level-Eintrag des Binders (Kapitel oder
/// lose Szene). ePub macht daraus je eine Inhaltsdatei; PDF/DOCX beginnen
/// hier optional eine neue Seite.
pub(super) struct CompChapter {
    /// Titel fürs Inhaltsverzeichnis (immer vorhanden).
    pub(super) toc_title: String,
    /// Überschrift im Fließtext (None z. B. bei loser Szene ohne Szenentitel).
    pub(super) heading: Option<String>,
    pub(super) blocks: Vec<Block>,
}

pub(super) fn parse_markdown(md: &str) -> Vec<Block> {
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
            blocks.push(Block::Paragraph {
                inlines: std::mem::take(cur),
                align,
            });
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
                    blocks.push(Block::Heading {
                        level,
                        text: std::mem::take(&mut heading_text),
                    });
                }
            }
            Event::End(TagEnd::Paragraph) | Event::End(TagEnd::Item) => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
            }
            Event::Start(Tag::Item) => {
                flush_para(&mut cur, &mut blocks, align_stack.last().copied());
                cur.push(Inline {
                    text: "• ".into(),
                    bold: false,
                    italic: false,
                });
            }
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Text(t) | Event::Code(t) => {
                if in_heading.is_some() {
                    heading_text.push_str(&t);
                } else {
                    cur.push(Inline {
                        text: t.to_string(),
                        bold: bold > 0,
                        italic: italic > 0,
                    });
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if in_heading.is_some() {
                    heading_text.push(' ');
                } else {
                    cur.push(Inline {
                        text: " ".into(),
                        bold: bold > 0,
                        italic: italic > 0,
                    });
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

pub(super) fn read_scene_blocks(p: &OpenProject, id: &str) -> Vec<Block> {
    // Fehlende Datei (extern gelöscht) bricht den Export nicht ab.
    let md = fs::read_to_string(p.abs(&scene_rel_path(id))).unwrap_or_default();
    parse_markdown(&md)
}

/// Sammelt die Blöcke aller ausgewählten Kinder eines Kapitels (rekursiv).
pub(super) fn collect_child_blocks(
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
                out.push(Block::Heading {
                    level: depth.min(3),
                    text: child.title.clone(),
                });
                collect_child_blocks(p, child, include, tpl, depth + 1, out);
            }
            NodeKind::Scene => {
                if tpl.include_scene_titles {
                    out.push(Block::Heading {
                        level: depth.min(3),
                        text: child.title.clone(),
                    });
                } else if prev_was_scene {
                    out.push(Block::Separator);
                }
                out.extend(read_scene_blocks(p, &child.id));
                prev_was_scene = true;
            }
        }
    }
}

pub(super) fn compile_chapters(
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
pub(super) fn fill_placeholders(s: &str, title: &str, author: &str) -> String {
    s.replace("{titel}", title).replace("{autor}", author)
}

pub(super) fn separator_text(tpl: &ExportTemplate) -> &str {
    if tpl.scene_separator.trim().is_empty() {
        ""
    } else {
        tpl.scene_separator.trim()
    }
}
