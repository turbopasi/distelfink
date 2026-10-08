//! Writer: PDF.

use std::fs;
use std::path::Path;

use super::model::*;
use super::templates::ExportTemplate;

// ---------------------------------------------------------------------------
// Writer: PDF
// ---------------------------------------------------------------------------

/// Kandidaten-Dateisätze [Regular, Bold, Italic, BoldItalic] je Schriftwahl,
/// in Prioritätsreihenfolge (Windows-Systemfonts, dann Linux-Äquivalente).
pub(super) fn font_candidates(font: &str) -> Vec<[String; 4]> {
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
    let dejavu_dirs = [
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/dejavu",
    ];

    let mut c: Vec<[String; 4]> = Vec::new();
    match font {
        "georgia" => {
            c.push(win([
                "georgia.ttf",
                "georgiab.ttf",
                "georgiai.ttf",
                "georgiaz.ttf",
            ]));
        }
        "arial" => {
            c.push(win([
                "arial.ttf",
                "arialbd.ttf",
                "ariali.ttf",
                "arialbi.ttf",
            ]));
            for d in liberation_dirs {
                c.push(linux(
                    d,
                    [
                        "LiberationSans-Regular.ttf",
                        "LiberationSans-Bold.ttf",
                        "LiberationSans-Italic.ttf",
                        "LiberationSans-BoldItalic.ttf",
                    ],
                ));
            }
            for d in dejavu_dirs {
                c.push(linux(
                    d,
                    [
                        "DejaVuSans.ttf",
                        "DejaVuSans-Bold.ttf",
                        "DejaVuSans-Oblique.ttf",
                        "DejaVuSans-BoldOblique.ttf",
                    ],
                ));
            }
        }
        "courier" => {
            c.push(win(["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"]));
            for d in liberation_dirs {
                c.push(linux(
                    d,
                    [
                        "LiberationMono-Regular.ttf",
                        "LiberationMono-Bold.ttf",
                        "LiberationMono-Italic.ttf",
                        "LiberationMono-BoldItalic.ttf",
                    ],
                ));
            }
        }
        _ => {}
    }
    // Serifen-Fallback-Kette gilt für "times", "georgia" und Unbekanntes.
    if font != "arial" && font != "courier" {
        c.push(win([
            "times.ttf",
            "timesbd.ttf",
            "timesi.ttf",
            "timesbi.ttf",
        ]));
        for d in liberation_dirs {
            c.push(linux(
                d,
                [
                    "LiberationSerif-Regular.ttf",
                    "LiberationSerif-Bold.ttf",
                    "LiberationSerif-Italic.ttf",
                    "LiberationSerif-BoldItalic.ttf",
                ],
            ));
        }
        for d in dejavu_dirs {
            c.push(linux(
                d,
                [
                    "DejaVuSerif.ttf",
                    "DejaVuSerif-Bold.ttf",
                    "DejaVuSerif-Italic.ttf",
                    "DejaVuSerif-BoldItalic.ttf",
                ],
            ));
        }
    }
    c
}

pub(super) fn load_pdf_fonts(
    font: &str,
) -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
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
    Err(
        "Keine passende Schriftart auf dem System gefunden (für PDF-Export wird \
         z. B. Times New Roman, Liberation Serif oder DejaVu Serif benötigt)"
            .into(),
    )
}

pub(super) fn write_pdf(
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

    doc.render_to_file(out_path)
        .map_err(|e| format!("PDF schreiben: {e}"))
}
