//! Writer: PDF. krilla schreibt die Datei; Zeilen- und Seitenumbruch,
//! Ausrichtung (auch Blocksatz) und Kopfzeile setzt dieser Writer selbst.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use krilla::geom::{Point, Size as PageSize};
use krilla::metadata::Metadata;
use krilla::page::PageSettings;
use krilla::paint::Fill;
use krilla::text::{Font, GlyphId, KrillaGlyph};
use krilla::{Data, Document};
use skrifa::instance::{LocationRef, Size};
use skrifa::{FontRef, MetadataProvider};

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

// ---------------------------------------------------------------------------
// Schriften
// ---------------------------------------------------------------------------

/// Ein Schriftschnitt: für krilla zum Zeichnen, für den Satz die Breiten.
/// Gemessen und gezeichnet wird mit denselben Werten — sonst ginge der
/// Blocksatz am Zeilenende nicht genau auf.
struct Face {
    font: Font,
    bytes: Arc<Vec<u8>>,
    units_per_em: f32,
    /// Ober- und Unterlänge in em (`descent` ist negativ).
    ascent: f32,
    descent: f32,
    glyphs: RefCell<HashMap<char, (GlyphId, f32)>>,
}

impl Face {
    fn load(path: &str) -> Result<Face, String> {
        let bytes = Arc::new(fs::read(path).map_err(|e| format!("Font lesen ({path}): {e}"))?);
        let font_ref =
            FontRef::from_index(&bytes, 0).map_err(|e| format!("Font ungültig ({path}): {e}"))?;
        let m = font_ref.metrics(Size::unscaled(), LocationRef::default());
        let units_per_em = f32::from(m.units_per_em.max(1));
        let font = Font::new(Data::from(bytes.clone()), 0)
            .ok_or_else(|| format!("Font ungültig ({path})"))?;
        Ok(Face {
            font,
            bytes,
            units_per_em,
            ascent: m.ascent / units_per_em,
            descent: m.descent / units_per_em,
            glyphs: RefCell::new(HashMap::new()),
        })
    }

    /// Glyph und Vorschub (in em) eines Zeichens. Fehlt es im Font, steht
    /// das Ersatzzeichen (Glyph 0) da — wie bei jedem anderen Programm.
    fn glyph(&self, ch: char) -> (GlyphId, f32) {
        if let Some(g) = self.glyphs.borrow().get(&ch) {
            return *g;
        }
        let g = FontRef::from_index(&self.bytes, 0)
            .ok()
            .map(|f| {
                let id = f.charmap().map(ch).unwrap_or_default();
                let advance = f
                    .glyph_metrics(Size::unscaled(), LocationRef::default())
                    .advance_width(id)
                    .unwrap_or(0.0);
                (GlyphId::new(id.to_u32()), advance / self.units_per_em)
            })
            .unwrap_or((GlyphId::new(0), 0.0));
        self.glyphs.borrow_mut().insert(ch, g);
        g
    }

    fn width(&self, text: &str, size: f32) -> f32 {
        text.chars().map(|c| self.glyph(c).1).sum::<f32>() * size
    }

    fn glyph_run(&self, text: &str) -> Vec<KrillaGlyph> {
        text.char_indices()
            .map(|(i, c)| {
                let (id, advance) = self.glyph(c);
                KrillaGlyph::new(id, advance, 0.0, 0.0, 0.0, i..i + c.len_utf8(), None)
            })
            .collect()
    }

    /// Zeilenhöhe bei `size` pt, vor dem Zeilenabstand der Vorlage.
    fn line_height(&self, size: f32) -> f32 {
        (self.ascent - self.descent) * size
    }
}

/// Die vier Schnitte einer Schriftwahl.
struct Fonts([Face; 4]);

impl Fonts {
    fn face(&self, style: Style) -> &Face {
        &self.0[usize::from(style.bold) + 2 * usize::from(style.italic)]
    }

    fn regular(&self) -> &Face {
        &self.0[0]
    }
}

fn load_pdf_fonts(font: &str) -> Result<Fonts, String> {
    for set in font_candidates(font) {
        if !set.iter().all(|p| Path::new(p).is_file()) {
            continue;
        }
        return Ok(Fonts([
            Face::load(&set[0])?,
            Face::load(&set[1])?,
            Face::load(&set[2])?,
            Face::load(&set[3])?,
        ]));
    }
    Err(
        "Keine passende Schriftart auf dem System gefunden (für PDF-Export wird \
         z. B. Times New Roman, Liberation Serif oder DejaVu Serif benötigt)"
            .into(),
    )
}

// ---------------------------------------------------------------------------
// Satz: Wörter → Zeilen
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
struct Style {
    bold: bool,
    italic: bool,
    size: f32,
}

/// Ein Wort. Die Auszeichnung kann mitten im Wort wechseln ("**fe**tt"),
/// daher mehrere Stücke.
#[derive(Clone, Debug)]
struct Word {
    pieces: Vec<(String, Style)>,
    width: f32,
    /// Breite des Leerraums danach (0 am Absatzende oder in einem geteilten Wort).
    space_after: f32,
}

/// Zerlegt einen Absatz in Wörter. Leerraum jeder Art trennt Wörter und
/// zählt als ein Leerzeichen.
fn words_of(runs: &[(String, Style)], fonts: &Fonts) -> Vec<Word> {
    let mut words = Vec::new();
    let mut cur: Vec<(String, Style)> = Vec::new();
    let finish = |cur: &mut Vec<(String, Style)>, words: &mut Vec<Word>| {
        if cur.is_empty() {
            return;
        }
        let pieces = std::mem::take(cur);
        let width = pieces
            .iter()
            .map(|(t, s)| fonts.face(*s).width(t, s.size))
            .sum();
        let last = pieces.last().map(|(_, s)| *s).unwrap();
        let space_after = fonts.face(last).width(" ", last.size);
        words.push(Word {
            pieces,
            width,
            space_after,
        });
    };
    for (text, style) in runs {
        for ch in text.chars() {
            if ch.is_whitespace() {
                finish(&mut cur, &mut words);
                continue;
            }
            match cur.last_mut() {
                Some((t, s)) if s == style => t.push(ch),
                _ => cur.push((ch.to_string(), *style)),
            }
        }
    }
    finish(&mut cur, &mut words);
    if let Some(last) = words.last_mut() {
        last.space_after = 0.0;
    }
    words
}

/// Ein Wort, das breiter ist als die Zeile, wird zeichenweise geteilt —
/// sonst liefe es über den Rand.
fn split_long(word: Word, max: f32, fonts: &Fonts) -> Vec<Word> {
    if word.width <= max {
        return vec![word];
    }
    let mut out: Vec<Word> = Vec::new();
    let mut cur = Word {
        pieces: Vec::new(),
        width: 0.0,
        space_after: 0.0,
    };
    for (text, style) in &word.pieces {
        let face = fonts.face(*style);
        for ch in text.chars() {
            let w = face.glyph(ch).1 * style.size;
            if cur.width + w > max && cur.width > 0.0 {
                out.push(std::mem::replace(
                    &mut cur,
                    Word {
                        pieces: Vec::new(),
                        width: 0.0,
                        space_after: 0.0,
                    },
                ));
            }
            match cur.pieces.last_mut() {
                Some((t, s)) if s == style => t.push(ch),
                _ => cur.pieces.push((ch.to_string(), *style)),
            }
            cur.width += w;
        }
    }
    cur.space_after = word.space_after;
    out.push(cur);
    out
}

/// Bricht Wörter in Zeilen der Breite `max` um (erste passende Stelle).
fn break_lines(words: Vec<Word>, max: f32) -> Vec<Vec<Word>> {
    let mut lines: Vec<Vec<Word>> = Vec::new();
    let mut line: Vec<Word> = Vec::new();
    let mut width = 0.0;
    for word in words {
        let gap = line.last().map_or(0.0, |w: &Word| w.space_after);
        if !line.is_empty() && width + gap + word.width > max {
            lines.push(std::mem::take(&mut line));
            width = 0.0;
        } else {
            width += gap;
        }
        width += word.width;
        line.push(word);
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

// ---------------------------------------------------------------------------
// Satz: Zeilen → Seiten
// ---------------------------------------------------------------------------

const MM: f32 = 72.0 / 25.4;
const A4: (f32, f32) = (210.0 * MM, 297.0 * MM);

/// Ein gesetztes Stück Text: Grundlinie bei (`x`, `y`) in pt von links oben.
struct Run {
    x: f32,
    y: f32,
    text: String,
    style: Style,
}

struct Layout<'a> {
    fonts: &'a Fonts,
    line_spacing: f32,
    left: f32,
    width: f32,
    top: f32,
    bottom: f32,
    pages: Vec<Vec<Run>>,
    y: f32,
}

impl Layout<'_> {
    fn page_is_empty(&self) -> bool {
        self.pages.last().is_none_or(|p| p.is_empty())
    }

    fn new_page(&mut self) {
        self.pages.push(Vec::new());
        self.y = self.top;
    }

    /// Senkrechter Abstand in mm — am Seitenanfang entfällt er.
    fn space(&mut self, mm: f32) {
        if !self.page_is_empty() {
            self.y += mm * MM;
        }
    }

    fn lines(&self, runs: &[(String, Style)]) -> Vec<Vec<Word>> {
        let words: Vec<Word> = words_of(runs, self.fonts)
            .into_iter()
            .flat_map(|w| split_long(w, self.width, self.fonts))
            .collect();
        break_lines(words, self.width)
    }

    /// Schriftgröße und Höhe einer Zeile (nach ihrem größten Stück).
    fn line_metrics(&self, line: &[Word]) -> (f32, f32) {
        let size = line
            .iter()
            .flat_map(|w| w.pieces.iter().map(|(_, s)| s.size))
            .fold(0.0, f32::max);
        (
            size,
            self.fonts.regular().line_height(size) * self.line_spacing,
        )
    }

    /// Beginnt eine neue Seite, wenn `runs` samt `after` (Abstand und erste
    /// Zeilen des Folgetexts) hier nicht mehr passt — sonst bliebe eine
    /// Überschrift oder ein Szenentrenner allein am Seitenende stehen.
    fn keep_with_next(&mut self, runs: &[(String, Style)], after: f32) {
        let own: f32 = self
            .lines(runs)
            .iter()
            .map(|l| self.line_metrics(l).1)
            .sum();
        if self.y + own + after > self.bottom && !self.page_is_empty() {
            self.new_page();
        }
    }

    /// Setzt einen Absatz; `align` gilt für alle Zeilen, beim Blocksatz außer
    /// der letzten.
    fn paragraph(&mut self, runs: &[(String, Style)], align: Align) {
        let lines = self.lines(runs);
        let count = lines.len();
        for (i, line) in lines.into_iter().enumerate() {
            let last = i + 1 == count;
            let (size, height) = self.line_metrics(&line);
            if self.y + height > self.bottom && !self.page_is_empty() {
                self.new_page();
            }
            let baseline = self.y + self.fonts.regular().ascent * size;
            self.place_line(line, align, last, baseline);
            self.y += height;
        }
    }

    fn place_line(&mut self, line: Vec<Word>, align: Align, last: bool, baseline: f32) {
        let gaps = line.len().saturating_sub(1);
        let natural: f32 = line.iter().map(|w| w.width).sum::<f32>()
            + line.iter().take(gaps).map(|w| w.space_after).sum::<f32>();
        let extra = (self.width - natural).max(0.0);
        let (mut x, stretch) = match align {
            Align::Left => (self.left, 0.0),
            Align::Center => (self.left + extra / 2.0, 0.0),
            Align::Right => (self.left + extra, 0.0),
            Align::Justify if last || gaps == 0 => (self.left, 0.0),
            Align::Justify => (self.left, extra / gaps as f32),
        };
        let page = self.pages.last_mut().expect("Seite angelegt");
        for word in line {
            for (text, style) in word.pieces {
                let w = self.fonts.face(style).width(&text, style.size);
                page.push(Run {
                    x,
                    y: baseline,
                    text,
                    style,
                });
                x += w;
            }
            x += word.space_after + stretch;
        }
    }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

pub(super) fn write_pdf(
    chapters: &[CompChapter],
    tpl: &ExportTemplate,
    title: &str,
    author: &str,
    out_path: &Path,
) -> Result<(), String> {
    let fonts = load_pdf_fonts(&tpl.font)?;
    let base = tpl.font_size_pt.round().clamp(6.0, 32.0);
    let plain = |size: f32| Style {
        bold: false,
        italic: false,
        size,
    };
    let bold = |size: f32| Style {
        bold: true,
        ..plain(size)
    };

    let m = &tpl.margins_mm;
    let header = fill_placeholders(&tpl.header, title, author);
    let header = header.trim();
    let header_size = (base - 2.0).max(6.0);
    // Die Kopfzeile steht oben im Satzspiegel, der Text beginnt darunter.
    let header_height = if header.is_empty() {
        0.0
    } else {
        fonts.regular().line_height(header_size) + 4.0 * MM
    };
    let mut layout = Layout {
        fonts: &fonts,
        line_spacing: tpl.line_spacing.max(0.5),
        left: m.left * MM,
        width: (A4.0 - (m.left + m.right) * MM).max(20.0 * MM),
        top: m.top * MM + header_height,
        bottom: A4.1 - m.bottom * MM,
        pages: Vec::new(),
        y: 0.0,
    };
    layout.new_page();

    let sep = separator_text(tpl).to_string();
    let base_align = tpl.base_align();
    // Was nach einer Überschrift bzw. einem Trenner mindestens noch auf die
    // Seite passen muss: zwei Zeilen Text.
    let two_lines = 2.0 * fonts.regular().line_height(base) * layout.line_spacing;

    for (ci, ch) in chapters.iter().enumerate() {
        if ci > 0 && tpl.chapter_start_new_page && !layout.page_is_empty() {
            layout.new_page();
        }
        if let Some(h) = &ch.heading {
            let runs = [(h.clone(), bold(base + 4.0))];
            layout.keep_with_next(&runs, 6.0 * MM + two_lines);
            layout.paragraph(&runs, Align::Left);
            layout.space(6.0);
        }
        for b in &ch.blocks {
            match b {
                Block::Heading { level, text } => {
                    let size = base + f32::from(6 - 2 * (*level).min(3));
                    let runs = [(text.clone(), bold(size))];
                    layout.keep_with_next(&runs, 5.0 * MM + two_lines);
                    layout.space(2.0);
                    layout.paragraph(&runs, Align::Left);
                    layout.space(3.0);
                }
                Block::Paragraph { inlines, align } => {
                    let runs: Vec<(String, Style)> = inlines
                        .iter()
                        .map(|i| {
                            let style = Style {
                                bold: i.bold,
                                italic: i.italic,
                                size: base,
                            };
                            (i.text.clone(), style)
                        })
                        .collect();
                    layout.paragraph(&runs, align.unwrap_or(base_align));
                    layout.space(1.5);
                }
                Block::Separator => {
                    if sep.is_empty() {
                        layout.y += fonts.regular().line_height(base) * layout.line_spacing;
                    } else {
                        let runs = [(sep.clone(), plain(base))];
                        layout.keep_with_next(&runs, 4.0 * MM + two_lines);
                        layout.space(2.0);
                        layout.paragraph(&runs, Align::Center);
                        layout.space(2.0);
                    }
                }
            }
        }
    }

    // Zeichnen
    let mut doc = Document::new();
    let mut metadata = Metadata::new().title(title.to_string());
    if !author.trim().is_empty() {
        metadata = metadata.authors(vec![author.to_string()]);
    }
    doc.set_metadata(metadata);
    let page_size = PageSize::from_wh(A4.0, A4.1).expect("A4 ist eine gültige Seitengröße");
    for (index, runs) in layout.pages.iter().enumerate() {
        let mut page = doc.start_page_with(PageSettings::new(page_size));
        let mut surface = page.surface();
        surface.set_fill(Some(Fill::default()));
        let mut draw = |x: f32, y: f32, text: &str, style: Style| {
            let face = fonts.face(style);
            surface.draw_glyphs(
                Point::from_xy(x, y),
                &face.glyph_run(text),
                face.font.clone(),
                text,
                style.size,
                false,
            );
        };
        if !header.is_empty() {
            let text = header.replace("{seite}", &(index + 1).to_string());
            let width = fonts.regular().width(&text, header_size);
            let x = A4.0 - m.right * MM - width;
            let y = m.top * MM + fonts.regular().ascent * header_size;
            draw(x, y, &text, plain(header_size));
        }
        for run in runs {
            draw(run.x, run.y, &run.text, run.style);
        }
        surface.finish();
        page.finish();
    }
    let bytes = doc.finish().map_err(|e| format!("PDF erzeugen: {e:?}"))?;
    fs::write(out_path, bytes).map_err(|e| format!("PDF schreiben: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Style = Style {
        bold: false,
        italic: false,
        size: 10.0,
    };

    fn word(width: f32) -> Word {
        Word {
            pieces: vec![("x".into(), S)],
            width,
            space_after: 2.0,
        }
    }

    #[test]
    fn bricht_um_sobald_das_naechste_wort_nicht_mehr_passt() {
        // 30 + 2 + 30 = 62 passt in 65, mit dem dritten Wort nicht mehr.
        let lines = break_lines(vec![word(30.0), word(30.0), word(30.0)], 65.0);
        assert_eq!(lines.iter().map(Vec::len).collect::<Vec<_>>(), vec![2, 1]);
    }

    #[test]
    fn ueberschrift_bleibt_nicht_allein_am_seitenende() {
        let fonts = load_pdf_fonts("times").unwrap();
        let mut layout = Layout {
            fonts: &fonts,
            line_spacing: 1.0,
            left: 0.0,
            width: 400.0,
            top: 0.0,
            bottom: 100.0,
            pages: vec![],
            y: 0.0,
        };
        layout.new_page();
        layout.paragraph(&[("Text".into(), S)], Align::Left);
        let heading = [("Überschrift".into(), S)];

        // Oben auf der Seite ist genug Platz: bleibt auf Seite 1.
        layout.keep_with_next(&heading, 30.0);
        assert_eq!(layout.pages.len(), 1);

        // Kurz vor Schluss passt die Überschrift selbst noch, der Folgetext
        // nicht mehr: neue Seite.
        layout.y = 80.0;
        layout.keep_with_next(&heading, 30.0);
        assert_eq!(layout.pages.len(), 2);
        assert_eq!(layout.y, layout.top);
    }

    #[test]
    fn ein_zu_langes_wort_steht_allein_in_seiner_zeile() {
        let lines = break_lines(vec![word(10.0), word(100.0), word(10.0)], 50.0);
        assert_eq!(
            lines.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![1, 1, 1]
        );
    }
}
