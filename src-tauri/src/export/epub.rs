//! Writer: ePub.

use std::fs;
use std::path::Path;

use super::model::*;
use super::templates::ExportTemplate;

// ---------------------------------------------------------------------------
// Writer: ePub
// ---------------------------------------------------------------------------

pub(super) fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub(super) fn inlines_to_xhtml(inlines: &[Inline]) -> String {
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

pub(super) fn chapter_to_xhtml(ch: &CompChapter, tpl: &ExportTemplate) -> String {
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

pub(super) fn write_epub(
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
