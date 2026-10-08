//! Bildformate, die Distelfink annimmt, und ihre Auslieferung an die
//! Oberfläche als data-URL (vermeidet Asset-Protocol-Scopes).

use base64::Engine;
use std::path::Path;

const IMAGE_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// true für eine der unterstützten Endungen (klein geschrieben).
pub(crate) fn is_image_ext(ext: &str) -> bool {
    IMAGE_EXTS.contains(&ext)
}

/// Endung einer Bilddatei, klein geschrieben — oder der Grund, warum sie
/// nicht angenommen wird.
pub(crate) fn image_ext_of(path: &str) -> Result<String, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or("Datei hat keine Endung")?;
    if !is_image_ext(&ext) {
        return Err(format!("Nicht unterstütztes Bildformat: .{ext}"));
    }
    Ok(ext)
}

/// Endung eines Dateinamens (ohne Prüfung), klein geschrieben.
pub(crate) fn ext_lower(name: &str) -> String {
    name.rsplit('.').next().unwrap_or("").to_lowercase()
}

fn mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

/// Längste Kante eines Personen-/Ortsbilds. Angezeigt wird es mit höchstens
/// 140 px — 512 reicht auch für HiDPI und spätere größere Ansichten.
const PREVIEW_MAX: u32 = 512;

/// Verkleinert ein Bild auf Vorschaugröße. `None`, wenn es schon klein genug
/// ist (oder sich nicht dekodieren lässt) — dann bleibt das Original.
/// Ergebnis: Bytes + Endung; PNG bei Transparenz, sonst JPEG.
pub(crate) fn shrink_to_preview(bytes: &[u8]) -> Option<(Vec<u8>, &'static str)> {
    // Ein Decoder-Panic bei einer kaputten Datei darf das Bild nicht kosten.
    std::panic::catch_unwind(|| shrink(bytes)).ok().flatten()
}

fn shrink(bytes: &[u8]) -> Option<(Vec<u8>, &'static str)> {
    // Erst nur den Kopf lesen: kleine Bilder nicht unnötig dekodieren.
    let (w, h) = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    if w <= PREVIEW_MAX && h <= PREVIEW_MAX {
        return None;
    }
    let img = image::load_from_memory(bytes).ok()?;
    let small = img.resize(
        PREVIEW_MAX,
        PREVIEW_MAX,
        image::imageops::FilterType::Lanczos3,
    );
    let mut out = std::io::Cursor::new(Vec::new());
    if small.color().has_alpha() {
        small.write_to(&mut out, image::ImageFormat::Png).ok()?;
        Some((out.into_inner(), "png"))
    } else {
        let rgb = small.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
            .encode_image(&rgb)
            .ok()?;
        Some((out.into_inner(), "jpg"))
    }
}

/// Bilddaten als data-URL; der MIME-Typ folgt der Endung.
pub(crate) fn data_url(bytes: &[u8], ext: &str) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{b64}", mime(ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(img: image::DynamicImage, format: image::ImageFormat) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    #[test]
    fn kleine_bilder_bleiben_unveraendert() {
        let png = encode(
            image::DynamicImage::new_rgb8(300, 200),
            image::ImageFormat::Png,
        );
        assert!(shrink_to_preview(&png).is_none());
    }

    #[test]
    fn grosse_bilder_werden_verkleinert() {
        let png = encode(
            image::DynamicImage::new_rgb8(2000, 1000),
            image::ImageFormat::Png,
        );
        let (small, ext) = shrink_to_preview(&png).unwrap();
        assert_eq!(ext, "jpg");
        let img = image::load_from_memory(&small).unwrap();
        assert_eq!((img.width(), img.height()), (512, 256));
    }

    #[test]
    fn transparenz_bleibt_png() {
        let png = encode(
            image::DynamicImage::new_rgba8(1000, 1500),
            image::ImageFormat::Png,
        );
        let (small, ext) = shrink_to_preview(&png).unwrap();
        assert_eq!(ext, "png");
        let img = image::load_from_memory(&small).unwrap();
        assert!(img.color().has_alpha());
        assert_eq!(img.height(), 512);
    }

    #[test]
    fn kaputte_daten_behalten_das_original() {
        assert!(shrink_to_preview(b"kein Bild").is_none());
    }
}
