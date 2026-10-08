//! Aufbau eines Projektordners: die Namen der Dateien und Ordner an einer
//! Stelle. Die Ordner der Personen und Orte nennt `EntityKind::dir`.

/// Titel, Binder und Formatversion.
pub(crate) const PROJECT_FILE: &str = "project.json";
/// Eine Markdown-Datei pro Szene.
pub(crate) const MANUSCRIPT_DIR: &str = "manuscript";
/// Bilder in Dokumenten und auf Corkboard-Karten.
pub(crate) const IMAGES_DIR: &str = "images";
/// Eine JSON-Datei pro Mindboard.
pub(crate) const MINDBOARD_DIR: &str = "mindboards";
pub(crate) const TIMELINE_FILE: &str = "timeline.json";
/// Suchindex — regenerierbar, gehört weder in Git noch in den Sync.
pub(crate) const CACHE_DIR: &str = ".cache";
/// Papierkorb (siehe trash.rs).
pub(crate) const TRASH_DIR: &str = ".trash";

pub(crate) fn scene_rel_path(id: &str) -> String {
    format!("{MANUSCRIPT_DIR}/{id}.md")
}
