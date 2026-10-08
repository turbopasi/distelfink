//! Mindboards: freie Brainstorming-Flächen mit Notizen, Bildern, Verweisen
//! auf Personen/Orte/Szenen, Verbindungen und Hintergrundformen.
//!
//! Eine JSON-Datei pro Board in `mindboards/<id>.json`, als Ganzes geladen
//! und gespeichert (wie der Zeitstrahl). Die IDs von Notizen, Verbindungen
//! und Formen vergibt das Frontend — sie gelten nur innerhalb eines Boards,
//! und eine Verbindung muss schon im selben Schritt auf eine neue Notiz
//! zeigen können.

use crate::fsutil::write_atomic;
use crate::project::{make_id, validate_id, with_project, AppState, Saved};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;

use crate::layout::MINDBOARD_DIR as DIR;

fn rel_path(id: &str) -> String {
    format!("{DIR}/{id}.json")
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindNode {
    pub id: String,
    /// "text", "image", "person", "location" oder "scene".
    pub kind: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Umbruchbreite (Text) bzw. Bildbreite; 0 = automatisch.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub w: f64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// Projektrelativer Bildpfad ("images/…").
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub image: String,
    /// Person, Ort oder Szene, auf die die Notiz verweist.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ref_id: String,
    /// Farbcode aus COLOR_PRESETS; leer = Standard.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// "none", "line", "rounded" oder "cloud"; leer = "none".
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub border: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub font_size: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    /// "none", "end" oder "both"; leer = "none".
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub arrow: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindShape {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// Nimmt beim Verschieben die Notizen mit, die in ihr liegen.
    #[serde(default, skip_serializing_if = "is_false")]
    pub magnetic: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindView {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mindboard {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub nodes: Vec<MindNode>,
    #[serde(default)]
    pub edges: Vec<MindEdge>,
    #[serde(default)]
    pub shapes: Vec<MindShape>,
    /// Zuletzt gezeigter Ausschnitt, damit das Board dort wieder aufgeht.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<MindView>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MindboardInfo {
    pub id: String,
    pub name: String,
}

const MIN_ZOOM: f64 = 0.1;
const MAX_ZOOM: f64 = 4.0;

/// Räumt auf, was die Oberfläche nicht verhindern muss: Verbindungen ins
/// Leere, doppelte oder auf sich selbst zeigende Verbindungen, doppelte IDs
/// und unbrauchbare Zoomwerte.
fn normalize(board: &mut Mindboard) {
    let mut seen = HashSet::new();
    board
        .nodes
        .retain(|n| !n.id.is_empty() && seen.insert(n.id.clone()));
    let ids: HashSet<&str> = board.nodes.iter().map(|n| n.id.as_str()).collect();

    // Ein Knotenpaar trägt höchstens eine Verbindung, egal in welche Richtung.
    let mut pairs = HashSet::new();
    let mut edge_ids = HashSet::new();
    board.edges.retain(|e| {
        if e.from == e.to || !ids.contains(e.from.as_str()) || !ids.contains(e.to.as_str()) {
            return false;
        }
        let pair = if e.from < e.to {
            (e.from.clone(), e.to.clone())
        } else {
            (e.to.clone(), e.from.clone())
        };
        !e.id.is_empty() && edge_ids.insert(e.id.clone()) && pairs.insert(pair)
    });

    let mut shape_ids = HashSet::new();
    board
        .shapes
        .retain(|s| !s.id.is_empty() && shape_ids.insert(s.id.clone()));
    for s in board.shapes.iter_mut() {
        s.w = s.w.max(20.0);
        s.h = s.h.max(20.0);
    }

    if let Some(view) = board.view.as_mut() {
        if !view.zoom.is_finite() || view.zoom <= 0.0 {
            view.zoom = 1.0;
        }
        view.zoom = view.zoom.clamp(MIN_ZOOM, MAX_ZOOM);
        if !view.x.is_finite() {
            view.x = 0.0;
        }
        if !view.y.is_finite() {
            view.y = 0.0;
        }
    }
}

fn read_board(p: &crate::project::OpenProject, id: &str) -> Result<Mindboard, String> {
    validate_id(id)?;
    let raw =
        fs::read_to_string(p.abs(&rel_path(id))).map_err(|e| format!("Mindboard lesen: {e}"))?;
    let mut board: Mindboard =
        serde_json::from_str(&raw).map_err(|e| format!("Mindboard ungültig: {e}"))?;
    board.id = id.to_string();
    normalize(&mut board);
    Ok(board)
}

fn write_board(p: &mut crate::project::OpenProject, board: &Mindboard) -> Result<(), String> {
    validate_id(&board.id)?;
    fs::create_dir_all(p.abs(DIR)).map_err(|e| format!("{DIR}/ anlegen: {e}"))?;
    let json = serde_json::to_string_pretty(board).map_err(|e| format!("Serialisierung: {e}"))?;
    let rel = rel_path(&board.id);
    write_atomic(&p.abs(&rel), json).map_err(|e| format!("{rel} schreiben: {e}"))?;
    p.note_mtime(&rel);
    p.search_dirty = true;
    Ok(())
}

/// IDs aller Boards im Projektordner.
pub(crate) fn board_ids(root: &std::path::Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root.join(DIR)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                return None;
            }
            path.file_stem().and_then(|s| s.to_str()).map(String::from)
        })
        .collect()
}

#[tauri::command(async)]
pub fn list_mindboards(state: tauri::State<AppState>) -> Result<Vec<MindboardInfo>, String> {
    with_project(&state, |p| {
        let mut list: Vec<MindboardInfo> = read_all(p)
            .into_iter()
            .map(|b| MindboardInfo {
                id: b.id,
                name: b.name,
            })
            .collect();
        list.sort_by_key(|b| b.name.to_lowercase());
        Ok(list)
    })
}

#[tauri::command]
pub fn create_mindboard(
    name: String,
    state: tauri::State<AppState>,
) -> Result<MindboardInfo, String> {
    with_project(&state, |p| {
        let name = if name.trim().is_empty() {
            "Mindboard".to_string()
        } else {
            name
        };
        let board = Mindboard {
            id: make_id(&name),
            name,
            ..Default::default()
        };
        write_board(p, &board)?;
        Ok(MindboardInfo {
            id: board.id,
            name: board.name,
        })
    })
}

#[tauri::command(async)]
pub fn load_mindboard(id: String, state: tauri::State<AppState>) -> Result<Mindboard, String> {
    with_project(&state, |p| {
        let board = read_board(p, &id)?;
        p.note_mtime(&rel_path(&id));
        Ok(board)
    })
}

/// Speichert ein Board. Wurde die Datei seit dem Laden von außen geändert
/// (Sync), bleibt sie unangetastet und die Oberfläche fragt nach — außer `force`.
#[tauri::command]
pub fn save_mindboard(
    mut board: Mindboard,
    force: bool,
    state: tauri::State<AppState>,
) -> Result<Saved<Mindboard>, String> {
    with_project(&state, |p| {
        validate_id(&board.id)?;
        if !force && p.changed_externally(&rel_path(&board.id)) {
            return Ok(Saved::Conflict);
        }
        // Der Name gehört der Seitenleiste (rename_mindboard): ein offenes
        // Board speichert sonst den Namen von vor dem Umbenennen zurück.
        // Und ein gelöschtes Board darf ein verspätetes Speichern nicht
        // wiederauferstehen lassen.
        let existing = read_board(p, &board.id)
            .map_err(|_| "Das Mindboard existiert nicht mehr.".to_string())?;
        board.name = existing.name;
        normalize(&mut board);
        write_board(p, &board)?;
        Ok(Saved::Ok { data: board })
    })
}

#[tauri::command]
pub fn rename_mindboard(
    id: String,
    name: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    with_project(&state, |p| {
        let mut board = read_board(p, &id)?;
        board.name = name;
        write_board(p, &board)
    })
}

#[tauri::command]
pub fn delete_mindboard(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    with_project(&state, |p| {
        validate_id(&id)?;
        let rel = rel_path(&id);
        fs::remove_file(p.abs(&rel)).map_err(|e| format!("{rel} löschen: {e}"))?;
        p.known_mtimes.remove(&rel);
        p.search_dirty = true;
        Ok(())
    })
}

/// Speichert den PNG-Export eines Boards. Den Ort wählt der Speichern-Dialog
/// hier im Backend — die Oberfläche kann so keinen beliebigen Pfad
/// beschreiben lassen. `false`, wenn der Dialog abgebrochen wurde.
/// Asynchron, weil der Dialog blockiert, bis gewählt ist.
#[tauri::command(async)]
pub fn export_mindboard_png(
    window: tauri::Window,
    file_name: String,
    data_base64: String,
) -> Result<bool, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Bilddaten ungültig: {e}"))?;
    let title = "Mindboard als Bild speichern";
    let Some(path) = crate::dialogs::pick_save(&window, title, &file_name, ("PNG-Bild", "png"))?
    else {
        return Ok(false);
    };
    fs::write(&path, bytes).map_err(|e| format!("Datei schreiben: {e}"))?;
    Ok(true)
}

/// Suchtext eines Boards: Notizen, Beschriftungen, Formtitel.
pub(crate) fn search_body(board: &Mindboard) -> String {
    let mut parts: Vec<&str> = Vec::new();
    parts.extend(board.nodes.iter().map(|n| n.text.as_str()));
    parts.extend(board.edges.iter().map(|e| e.label.as_str()));
    parts.extend(board.shapes.iter().map(|s| s.title.as_str()));
    parts.retain(|s| !s.is_empty());
    parts.join("\n")
}

/// Alle Boards eines Projekts, fürs Durchsuchen.
pub(crate) fn read_all(p: &crate::project::OpenProject) -> Vec<Mindboard> {
    board_ids(&p.root)
        .into_iter()
        .filter_map(|id| read_board(p, &id).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str) -> MindNode {
        MindNode {
            id: id.into(),
            kind: "text".into(),
            x: 0.0,
            y: 0.0,
            w: 0.0,
            text: String::new(),
            image: String::new(),
            ref_id: String::new(),
            color: String::new(),
            border: String::new(),
            font_size: 0.0,
            bold: false,
        }
    }

    fn edge(id: &str, from: &str, to: &str) -> MindEdge {
        MindEdge {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            arrow: String::new(),
            label: String::new(),
        }
    }

    #[test]
    fn entfernt_kanten_zu_geloeschten_notizen() {
        let mut b = Mindboard {
            nodes: vec![node("a"), node("b")],
            edges: vec![edge("e1", "a", "b"), edge("e2", "a", "weg")],
            ..Default::default()
        };
        normalize(&mut b);
        assert_eq!(b.edges.len(), 1);
        assert_eq!(b.edges[0].id, "e1");
    }

    #[test]
    fn verbindet_ein_paar_nur_einmal() {
        let mut b = Mindboard {
            nodes: vec![node("a"), node("b")],
            edges: vec![
                edge("e1", "a", "b"),
                edge("e2", "b", "a"),
                edge("e3", "a", "a"),
            ],
            ..Default::default()
        };
        normalize(&mut b);
        assert_eq!(b.edges.len(), 1);
    }

    #[test]
    fn begrenzt_den_zoom() {
        let mut b = Mindboard {
            view: Some(MindView {
                x: f64::NAN,
                y: 3.0,
                zoom: 99.0,
            }),
            ..Default::default()
        };
        normalize(&mut b);
        let v = b.view.unwrap();
        assert_eq!(v.zoom, MAX_ZOOM);
        assert_eq!(v.x, 0.0);
    }

    #[test]
    fn liest_alte_dateien_ohne_optionale_felder() {
        let raw = r#"{"name":"Ideen","nodes":[{"id":"a","kind":"text","x":1,"y":2}]}"#;
        let b: Mindboard = serde_json::from_str(raw).unwrap();
        assert_eq!(b.nodes[0].x, 1.0);
        assert!(b.edges.is_empty());
    }
}
