//! Papierkorb des Projekts.
//!
//! Gelöschte Dateien wandern nach `.trash/`. Die Datei allein reicht aber
//! nicht, um etwas zurückzuholen: Titel, Ordner und Platz im Baum stehen in
//! `project.json`, und die wird beim Löschen ohne
//! den Eintrag neu geschrieben. Deshalb hält `.trash/_index.json` fest, was
//! ein Eintrag war und wohin er gehört.
//!
//! `.trash/` ist in `.gitignore` — der Papierkorb gehört nicht in den Verlauf.

use crate::fsutil::write_atomic;
use crate::project::{
    restore_binder_node, validate_binder_ids, with_project, AppState, BinderNode, OpenProject,
    ProjectInfo,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::layout::TRASH_DIR;

const TRASH_INDEX: &str = ".trash/_index.json";

/// Eine Datei im Papierkorb und der Pfad, an den sie zurückgehört.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashFile {
    /// Dateiname innerhalb von `.trash/`.
    pub name: String,
    /// Projektrelativer Zielpfad beim Wiederherstellen.
    pub target: String,
}

/// Was ein Eintrag im Papierkorb war.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TrashKind {
    Chapter,
    Scene,
    Characters,
    Locations,
    Mindboard,
    /// Notizen kennt Distelfink nicht mehr; alte Einträge gibt es noch.
    Note,
    /// Von einer neueren App-Version (zweiter Rechner per Sync): bleibt beim
    /// Zurückschreiben des Index erhalten, statt verloren zu gehen.
    #[serde(untagged)]
    Other(String),
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    /// Schlüssel im Papierkorb (IDs allein reichen nicht: dieselbe ID kann
    /// gelöscht, neu angelegt und wieder gelöscht worden sein).
    pub key: String,
    pub kind: TrashKind,
    /// ID des Eintrags — bei Binder-Knoten die des Wurzelknotens.
    pub id: String,
    pub title: String,
    /// Zeitpunkt des Löschens, ms seit Epoch (das Frontend formatiert).
    pub deleted_at: u64,
    pub files: Vec<TrashFile>,
    /// Der Knoten samt Unterbaum — nur bei "chapter"/"scene". So kommt ein
    /// Ordner mit allem zurück, was in ihm lag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<BinderNode>,
    /// Ordner, in dem der Knoten lag (None = oberste Ebene).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Platz unter den Geschwistern.
    #[serde(default)]
    pub index: usize,
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn new_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

pub(crate) fn load_index(p: &OpenProject) -> Vec<TrashItem> {
    fs::read_to_string(p.abs(TRASH_INDEX))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_index(p: &mut OpenProject, items: &[TrashItem]) -> Result<(), String> {
    fs::create_dir_all(p.abs(TRASH_DIR)).map_err(|e| format!(".trash anlegen: {e}"))?;
    let json = serde_json::to_string_pretty(items).map_err(|e| format!("Serialisierung: {e}"))?;
    write_atomic(&p.abs(TRASH_INDEX), json).map_err(|e| format!("{TRASH_INDEX} schreiben: {e}"))
}

/// Verschiebt eine Projektdatei in den Papierkorb. `Ok(None)`, wenn es sie
/// nicht (mehr) gibt — das ist kein Fehler, gelöscht werden soll sie ohnehin.
pub(crate) fn move_to_trash(p: &mut OpenProject, rel: &str) -> Result<Option<TrashFile>, String> {
    let src = p.abs(rel);
    if !src.exists() {
        p.known_mtimes.remove(rel);
        return Ok(None);
    }
    let dir = p.abs(TRASH_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!(".trash anlegen: {e}"))?;
    let base = Path::new(rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("datei");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut name = format!("{stamp}-{base}");
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{stamp}-{n}-{base}");
        n += 1;
    }
    fs::rename(&src, dir.join(&name))
        .map_err(|e| format!("In Papierkorb verschieben ({rel}): {e}"))?;
    p.known_mtimes.remove(rel);
    Ok(Some(TrashFile {
        name,
        target: rel.to_string(),
    }))
}

/// Ein Dateiname direkt in `.trash/` — ohne Pfadanteile.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

/// Ein projektrelativer Pfad, der im Projekt bleibt.
fn is_project_rel(rel: &str) -> bool {
    !rel.contains(['\\', ':'])
        && rel
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Der Index ist eine Datei im Projekt und kann von Hand oder durch ein
/// anderes Programm verändert sein. Seine Pfade dürfen nicht aus dem Projekt
/// hinausführen — Wiederherstellen und Löschen arbeiten direkt mit ihnen.
fn check_item(item: &TrashItem) -> Result<(), String> {
    for f in &item.files {
        if !is_plain_name(&f.name) || !is_project_rel(&f.target) {
            return Err(format!(
                "Ungültiger Papierkorb-Eintrag: {} → {}",
                f.name, f.target
            ));
        }
    }
    if let Some(node) = &item.node {
        validate_binder_ids(std::slice::from_ref(node))?;
    }
    Ok(())
}

/// Trägt einen gelöschten Eintrag in den Papierkorb-Index ein.
pub(crate) fn record(p: &mut OpenProject, item: TrashItem) -> Result<(), String> {
    let mut items = load_index(p);
    items.push(item);
    save_index(p, &items)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn list_trash(state: tauri::State<AppState>) -> Result<Vec<TrashItem>, String> {
    with_project(&state, |p| {
        let mut items = load_index(p);
        // Zuletzt Gelöschtes zuerst — danach sucht man.
        items.sort_by_key(|i| std::cmp::Reverse(i.deleted_at));
        Ok(items)
    })
}

/// Holt einen Eintrag zurück an seinen Platz. Fehlt der ursprüngliche Ordner,
/// landet er auf oberster Ebene, statt den Vorgang scheitern zu lassen.
#[tauri::command]
pub fn restore_trash(key: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    with_project(&state, |p| {
        // Der Knoten kommt in den Binder zurück — auf dessen aktuellen Stand.
        p.refresh_meta()?;
        let items = load_index(p);
        let pos = items
            .iter()
            .position(|i| i.key == key)
            .ok_or(format!("Nicht im Papierkorb: {key}"))?;
        let item = items[pos].clone();
        check_item(&item)?;

        // Erst prüfen, dann verschieben: ein halb wiederhergestellter Eintrag
        // wäre schlimmer als einer, der im Papierkorb bleibt.
        for f in &item.files {
            if p.abs(&f.target).exists() {
                return Err(format!(
                    "„{}“ kann nicht zurück: {} gibt es schon.",
                    item.title, f.target
                ));
            }
        }
        for f in &item.files {
            let dst = p.abs(&f.target);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Ordner anlegen: {e}"))?;
            }
            fs::rename(p.abs(TRASH_DIR).join(&f.name), &dst)
                .map_err(|e| format!("Zurückholen ({}): {e}", f.target))?;
            p.note_mtime(&f.target);
        }

        match &item.kind {
            TrashKind::Chapter | TrashKind::Scene => {
                let node = item
                    .node
                    .clone()
                    .ok_or("Eintrag ohne Knotendaten — kann nicht zurück".to_string())?;
                restore_binder_node(p, node, item.parent_id.as_deref(), item.index)?;
            }
            TrashKind::Characters | TrashKind::Locations | TrashKind::Mindboard => {
                // Die JSON-Datei ist der Eintrag; sie liegt wieder an Ort und Stelle.
            }
            // Notizen kennt Distelfink nicht mehr. Alte Papierkorb-Einträge
            // gibt es in Projekten von früher aber noch: die Markdown-Datei
            // wandert zurück nach notes/, wo sie lesbar liegen bleibt — nur
            // öffnen kann die App sie nicht mehr.
            TrashKind::Note => {}
            TrashKind::Other(other) => {
                return Err(format!("Unbekannte Art im Papierkorb: {other}"))
            }
        }

        let mut rest = items;
        rest.remove(pos);
        save_index(p, &rest)?;
        p.search_dirty = true;
        Ok(p.info())
    })
}

/// Löscht einen einzelnen Eintrag endgültig.
#[tauri::command]
pub fn delete_trash_item(key: String, state: tauri::State<AppState>) -> Result<(), String> {
    with_project(&state, |p| {
        let mut items = load_index(p);
        let pos = items
            .iter()
            .position(|i| i.key == key)
            .ok_or(format!("Nicht im Papierkorb: {key}"))?;
        for f in &items[pos].files {
            if is_plain_name(&f.name) {
                let _ = fs::remove_file(p.abs(TRASH_DIR).join(&f.name));
            }
        }
        items.remove(pos);
        save_index(p, &items)
    })
}

/// Leert den Papierkorb — auch Dateien, die vor dem Index dort gelandet sind.
#[tauri::command]
pub fn empty_trash(state: tauri::State<AppState>) -> Result<(), String> {
    with_project(&state, |p| {
        let dir = p.abs(TRASH_DIR);
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(&path);
                } else if path.file_name().and_then(|n| n.to_str()) != Some("_index.json") {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        save_index(p, &[])
    })
}

/// Zahl der Einträge — für die Zeile im Binder.
#[tauri::command(async)]
pub fn count_trash(state: tauri::State<AppState>) -> Result<usize, String> {
    with_project(&state, |p| Ok(load_index(p).len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pfade_bleiben_im_projekt() {
        assert!(is_project_rel("manuscript/szene-abc123.md"));
        assert!(is_project_rel("characters/anna-aaa111-img.png"));
        assert!(!is_project_rel("../outside.md"));
        assert!(!is_project_rel("manuscript/../../outside.md"));
        assert!(!is_project_rel("/etc/passwd"));
        assert!(!is_project_rel("C:/Windows/win.ini"));
        assert!(!is_project_rel("manuscript\\..\\x.md"));
        assert!(is_plain_name("20261008-120000-szene.md"));
        assert!(!is_plain_name("../szene.md"));
        assert!(!is_plain_name(".."));
    }

    #[test]
    fn unbekannte_arten_bleiben_erhalten() {
        let raw = r#"[{"key":"a","kind":"scene","id":"s-1","title":"S","deletedAt":1,"files":[]},
                      {"key":"b","kind":"zukunft","id":"z-1","title":"Z","deletedAt":2,"files":[]}]"#;
        let items: Vec<TrashItem> = serde_json::from_str(raw).unwrap();
        assert_eq!(items[0].kind, TrashKind::Scene);
        assert_eq!(items[1].kind, TrashKind::Other("zukunft".into()));
        let back = serde_json::to_string(&items).unwrap();
        assert!(back.contains(r#""kind":"zukunft""#), "{back}");
        assert!(back.contains(r#""kind":"scene""#), "{back}");
    }
}
