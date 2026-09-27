//! Zentrale App-Einstellungen (Phase 7): Theming, Editor, Layout, Tastaturkürzel.
//!
//! Die Einstellungen sind app-weit, nicht projektgebunden, und liegen als
//! `settings.json` im App-Config-Verzeichnis (z. B. `%APPDATA%/<app>` unter
//! Windows). Das Backend behandelt sie als opakes JSON — Schema und Defaults
//! gehören dem Frontend (`src/settings.ts`), damit neue Optionen keine
//! Rust-Änderung brauchen.

use crate::images;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("App-Config-Verzeichnis nicht ermittelbar: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Config-Verzeichnis nicht anlegbar: {e}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("Einstellungen nicht lesbar: {e}"))?;
    // Korrupte Datei → Null zurückgeben, Frontend fällt auf Defaults zurück.
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    crate::fsutil::write_atomic(&path, text)
        .map_err(|e| format!("Einstellungen nicht speicherbar: {e}"))
}

// ---------------------------------------------------------------------------
// Hintergrundbild der Dokumentenfläche
// ---------------------------------------------------------------------------
//
// Das Bild gehört zur App, nicht zum Projekt: es liegt neben der settings.json
// im App-Config-Verzeichnis. Gespeichert wird in den Einstellungen nur der
// Dateiname; die Anzeige holt sich das Bild als data-URL (wie die
// Dokument-Bilder — vermeidet Asset-Protocol-Scopes).

fn background_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("App-Config-Verzeichnis nicht ermittelbar: {e}"))?
        .join("backgrounds");
    fs::create_dir_all(&dir).map_err(|e| format!("Hintergrund-Verzeichnis nicht anlegbar: {e}"))?;
    Ok(dir)
}

/// Prüft, dass der Name auf eine Datei direkt im backgrounds-Verzeichnis zeigt.
fn background_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !name.starts_with("hintergrund-")
    {
        return Err(format!("Ungültiger Bildname: {name}"));
    }
    if !images::is_image_ext(&images::ext_lower(name)) {
        return Err(format!("Ungültiger Bildname: {name}"));
    }
    Ok(background_dir(app)?.join(name))
}

/// Kopiert eine Bilddatei (Dateidialog) ins App-Config-Verzeichnis und liefert
/// ihren Dateinamen. Ältere Hintergrundbilder werden dabei entfernt — es gibt
/// immer nur eines.
#[tauri::command]
pub fn import_background_image(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let ext = images::image_ext_of(&source_path)?;
    let dir = background_dir(&app)?;
    // Zeitstempel im Namen: so lädt die Anzeige nach einem Wechsel garantiert
    // das neue Bild und nicht den zwischengespeicherten Vorgänger.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!("hintergrund-{stamp}.{ext}");
    fs::copy(&source_path, dir.join(&name)).map_err(|e| format!("Bild kopieren: {e}"))?;
    remove_other_backgrounds(&dir, &name);
    Ok(name)
}

/// Liefert das Hintergrundbild als data-URL (None, wenn die Datei fehlt).
#[tauri::command]
pub fn read_background_image(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = background_file(&app, &name)?;
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    Ok(Some(images::data_url(&bytes, &images::ext_lower(&name))))
}

/// Entfernt das gespeicherte Hintergrundbild wieder.
#[tauri::command]
pub fn clear_background_image(app: tauri::AppHandle) -> Result<(), String> {
    let dir = background_dir(&app)?;
    remove_other_backgrounds(&dir, "");
    Ok(())
}

/// Löscht alle Hintergrundbilder außer `keep`.
fn remove_other_backgrounds(dir: &std::path::Path, keep: &str) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != keep && name.starts_with("hintergrund-") {
            let _ = fs::remove_file(entry.path());
        }
    }
}
