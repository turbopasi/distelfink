//! Writer: Markdown und reiner Text.

use super::model::*;
use super::templates::ExportTemplate;

// ---------------------------------------------------------------------------
// Writer: Markdown / TXT
// ---------------------------------------------------------------------------

pub(super) fn inline_to_md(inlines: &[Inline]) -> String {
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

pub(super) fn inline_to_text(inlines: &[Inline]) -> String {
    inlines.iter().map(|i| i.text.as_str()).collect()
}

pub(super) fn write_markdown(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    plain: bool,
) -> String {
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
                    let line = if plain {
                        inline_to_text(inlines)
                    } else {
                        inline_to_md(inlines)
                    };
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
