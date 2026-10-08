//! Writer: DOCX.

use std::fs;
use std::path::Path;

use super::model::*;
use super::templates::ExportTemplate;

// ---------------------------------------------------------------------------
// Writer: DOCX
// ---------------------------------------------------------------------------

pub(super) fn docx_font_name(font: &str) -> &'static str {
    match font {
        "times" => "Times New Roman",
        "georgia" => "Georgia",
        "arial" => "Arial",
        "courier" => "Courier New",
        _ => "Times New Roman",
    }
}

pub(super) fn mm_to_twips(mm: f32) -> i32 {
    (mm / 25.4 * 1440.0).round() as i32
}

pub(super) fn write_docx(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    title: &str,
    author: &str,
    out_path: &Path,
) -> Result<(), String> {
    use docx_rs::*;

    let font = docx_font_name(&tpl.font);
    let fonts = || {
        RunFonts::new()
            .ascii(font)
            .hi_ansi(font)
            .cs(font)
            .east_asia(font)
    };
    let half_points = (tpl.font_size_pt * 2.0).round() as usize;
    let line = (tpl.line_spacing * 240.0).round() as u32;
    let spacing = || {
        LineSpacing::new()
            .line_rule(LineSpacingType::Auto)
            .line(line as i32)
    };

    let body_run = |i: &Inline| {
        let mut r = Run::new()
            .add_text(&i.text)
            .fonts(fonts())
            .size(half_points);
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
                        par = par
                            .add_run(Run::new().add_text(before).fonts(fonts()).size(half_points));
                    }
                    par = par.add_page_num(PageNum::new());
                    rest = after;
                }
                None => {
                    if !rest.is_empty() {
                        par =
                            par.add_run(Run::new().add_text(rest).fonts(fonts()).size(half_points));
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

    let file = fs::File::create(out_path).map_err(|e| format!("Datei anlegen: {e}"))?;
    docx.build()
        .pack(file)
        .map_err(|e| format!("DOCX schreiben: {e}"))?;
    Ok(())
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
