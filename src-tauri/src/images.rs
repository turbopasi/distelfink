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

/// Bilddaten als data-URL; der MIME-Typ folgt der Endung.
pub(crate) fn data_url(bytes: &[u8], ext: &str) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{b64}", mime(ext))
}
