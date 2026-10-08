//! Datei-Dialoge im Backend. Commands, die Dateien außerhalb des Projekts
//! lesen oder schreiben, bekommen den Pfad nie von der Oberfläche, sondern
//! aus einem Dialog, den jemand selbst bestätigt hat — selbst fremder Code in
//! der WebView könnte so keine beliebige Datei lesen oder überschreiben.
//!
//! Die Dialoge blockieren, bis gewählt ist: die Commands, die sie öffnen,
//! laufen deshalb asynchron (nicht auf dem Hauptthread).

use std::path::PathBuf;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::images::IMAGE_EXTS;

fn into_path(chosen: Option<FilePath>) -> Result<Option<PathBuf>, String> {
    chosen
        .map(|f| f.into_path().map_err(|e| format!("Dateiauswahl: {e}")))
        .transpose()
}

/// Bilddatei zum Öffnen wählen; None = abgebrochen.
pub(crate) fn pick_image(window: &tauri::Window, title: &str) -> Result<Option<PathBuf>, String> {
    into_path(
        window
            .dialog()
            .file()
            .set_parent(window)
            .set_title(title)
            .add_filter("Bilder", &IMAGE_EXTS)
            .blocking_pick_file(),
    )
}

/// Speicherort wählen; None = abgebrochen.
pub(crate) fn pick_save(
    window: &tauri::Window,
    title: &str,
    file_name: &str,
    filter: (&str, &str),
) -> Result<Option<PathBuf>, String> {
    into_path(
        window
            .dialog()
            .file()
            .set_parent(window)
            .set_title(title)
            .set_file_name(file_name)
            .add_filter(filter.0, &[filter.1])
            .blocking_save_file(),
    )
}
