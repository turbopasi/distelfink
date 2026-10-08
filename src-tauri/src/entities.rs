//! Personen & Orte: eine JSON-Datei pro Eintrag in `characters/` bzw.
//! `locations/`, daneben das Freitext-Dokument (`{id}.md`) und ein Bild
//! (`{id}-img.{ext}`).

use crate::fsutil::write_atomic;
use crate::images;
use crate::project::{make_id, validate_id, with_project, AppState, OpenProject, WriteResult};
use crate::trash;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntityField {
    pub label: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<EntityField>,
    /// Szenen, in denen die Person / der Ort vorkommt.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scene_ids: Vec<String>,
    /// Dateiname des Bilds im Entity-Ordner (z. B. "anna-3f2a1b-img.png").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

fn entity_dir(kind: &str) -> Result<&'static str, String> {
    match kind {
        "characters" => Ok("characters"),
        "locations" => Ok("locations"),
        _ => Err(format!("Unbekannte Entity-Art: {kind}")),
    }
}

fn entity_rel_path(dir: &str, id: &str) -> String {
    format!("{dir}/{id}.json")
}

/// Freitext-Dokument einer Person / eines Orts (liegt neben der JSON-Metadatei).
pub(crate) fn entity_doc_rel(dir: &str, id: &str) -> String {
    format!("{dir}/{id}.md")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityList {
    pub entities: Vec<Entity>,
    /// Projektrelative Pfade der Dateien, die sich nicht lesen ließen.
    pub broken: Vec<String>,
}

/// Eine kaputte Datei (Sync mittendrin, Handarbeit) darf nicht die ganze
/// Liste mitreißen: sie wird übersprungen und gemeldet.
#[tauri::command(async)]
pub fn list_entities(kind: String, state: tauri::State<AppState>) -> Result<EntityList, String> {
    let dir = entity_dir(&kind)?;
    with_project(&state, |p| Ok(read_entity_dir(&p.abs(dir), dir)))
}

fn read_entity_dir(abs_dir: &std::path::Path, dir: &str) -> EntityList {
    let mut list = EntityList {
        entities: Vec::new(),
        broken: Vec::new(),
    };
    let entries = match fs::read_dir(abs_dir) {
        Ok(e) => e,
        Err(_) => return list, // Ordner fehlt (altes Projekt) → leer
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let parsed = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Entity>(&raw).ok());
        match parsed {
            Some(entity) => list.entities.push(entity),
            None => list
                .broken
                .push(format!("{dir}/{}", entry.file_name().to_string_lossy())),
        }
    }
    list.entities.sort_by_key(|e| e.name.to_lowercase());
    list.broken.sort();
    list
}

#[tauri::command]
pub fn save_entity(
    kind: String,
    mut entity: Entity,
    state: tauri::State<AppState>,
) -> Result<Entity, String> {
    let dir = entity_dir(&kind)?;
    with_project(&state, |p| {
        if entity.name.trim().is_empty() {
            return Err("Name darf nicht leer sein".into());
        }
        if entity.id.is_empty() {
            entity.id = make_id(&entity.name);
        } else {
            validate_id(&entity.id)?;
        }
        fs::create_dir_all(p.abs(dir)).map_err(|e| format!("{dir} anlegen: {e}"))?;
        let rel = entity_rel_path(dir, &entity.id);
        let json =
            serde_json::to_string_pretty(&entity).map_err(|e| format!("Serialisierung: {e}"))?;
        write_atomic(&p.abs(&rel), json).map_err(|e| format!("{rel} schreiben: {e}"))?;
        p.note_mtime(&rel);
        p.search_dirty = true;
        Ok(entity.clone())
    })
}

/// Dupliziert einen Eintrag samt Freitext-Dokument und Bild.
#[tauri::command]
pub fn duplicate_entity(
    kind: String,
    id: String,
    state: tauri::State<AppState>,
) -> Result<Entity, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = entity_rel_path(dir, &id);
        let raw = fs::read_to_string(p.abs(&rel)).map_err(|e| format!("{rel} lesen: {e}"))?;
        let mut entity: Entity =
            serde_json::from_str(&raw).map_err(|e| format!("{rel} ungültig: {e}"))?;
        entity.name = format!("{} (Kopie)", entity.name);
        entity.id = make_id(&entity.name);

        // Der Bilddateiname trägt die ID — also unter neuem Namen mitkopieren.
        if let Some(image) = entity.image.clone() {
            let ext = image.rsplit('.').next().unwrap_or("png");
            let copy_name = format!("{}-img.{ext}", entity.id);
            entity.image = fs::copy(p.abs(dir).join(&image), p.abs(dir).join(&copy_name))
                .ok()
                .map(|_| copy_name);
        }

        let new_rel = entity_rel_path(dir, &entity.id);
        let json =
            serde_json::to_string_pretty(&entity).map_err(|e| format!("Serialisierung: {e}"))?;
        write_atomic(&p.abs(&new_rel), json).map_err(|e| format!("{new_rel} schreiben: {e}"))?;
        p.note_mtime(&new_rel);

        let doc_src = p.abs(&entity_doc_rel(dir, &id));
        if doc_src.exists() {
            let doc_rel = entity_doc_rel(dir, &entity.id);
            fs::copy(&doc_src, p.abs(&doc_rel)).map_err(|e| format!("{doc_rel} schreiben: {e}"))?;
            p.note_mtime(&doc_rel);
        }
        p.search_dirty = true;
        Ok(entity)
    })
}

#[tauri::command]
pub fn delete_entity(
    kind: String,
    id: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = entity_rel_path(dir, &id);
        // Der Name steht in der JSON-Datei; ohne ihn hieße der Eintrag im
        // Papierkorb nur noch wie seine ID.
        let entity = fs::read_to_string(p.abs(&rel))
            .ok()
            .and_then(|raw| serde_json::from_str::<Entity>(&raw).ok());
        let title = entity
            .as_ref()
            .map(|e| e.name.clone())
            .unwrap_or_else(|| id.clone());
        // Das Bild gehört zum Eintrag: mit in den Papierkorb, sonst bliebe es
        // nach dem Leeren verwaist liegen und fehlte beim Wiederherstellen.
        let image = entity
            .and_then(|e| e.image)
            .filter(|name| !name.contains(['/', '\\']) && !name.contains(".."));

        let mut rels = vec![rel, entity_doc_rel(dir, &id)];
        rels.extend(image.map(|name| format!("{dir}/{name}")));
        let mut files = Vec::new();
        for rel in &rels {
            if let Some(f) = trash::move_to_trash(p, rel)? {
                files.push(f);
            }
        }
        trash::record(
            p,
            trash::TrashItem {
                key: trash::new_key(),
                kind: kind.clone(),
                id: id.clone(),
                title,
                deleted_at: trash::now_ms(),
                files,
                node: None,
                parent_id: None,
                index: 0,
            },
        )?;
        p.search_dirty = true;
        Ok(())
    })
}

/// Patcht nur die Metadaten eines Eintrags (Name, Szenen-Verknüpfungen) —
/// liest den aktuellen Stand von Platte, damit das Frontend nie versehentlich
/// alte Formulardaten (description/fields) zurückschreibt.
#[tauri::command]
pub fn update_entity_meta(
    kind: String,
    id: String,
    name: Option<String>,
    scene_ids: Option<Vec<String>>,
    state: tauri::State<AppState>,
) -> Result<Entity, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = entity_rel_path(dir, &id);
        let raw = fs::read_to_string(p.abs(&rel)).map_err(|e| format!("{rel} lesen: {e}"))?;
        let mut entity: Entity =
            serde_json::from_str(&raw).map_err(|e| format!("{rel} ungültig: {e}"))?;
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err("Name darf nicht leer sein".into());
            }
            entity.name = name;
        }
        if let Some(scene_ids) = scene_ids {
            entity.scene_ids = scene_ids;
        }
        let json =
            serde_json::to_string_pretty(&entity).map_err(|e| format!("Serialisierung: {e}"))?;
        write_atomic(&p.abs(&rel), json).map_err(|e| format!("{rel} schreiben: {e}"))?;
        p.note_mtime(&rel);
        p.search_dirty = true;
        Ok(entity)
    })
}

/// Liest das Freitext-Dokument einer Person / eines Orts. Alt-Einträge, die
/// noch Beschreibung + freie Felder im JSON tragen (früheres Formular),
/// werden beim ersten Zugriff nach Markdown migriert.
#[tauri::command(async)]
pub fn read_entity_doc(
    kind: String,
    id: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = entity_doc_rel(dir, &id);
        let path = p.abs(&rel);
        if !path.exists() {
            let json_rel = entity_rel_path(dir, &id);
            let raw = fs::read_to_string(p.abs(&json_rel))
                .map_err(|e| format!("{json_rel} lesen: {e}"))?;
            let mut entity: Entity =
                serde_json::from_str(&raw).map_err(|e| format!("{json_rel} ungültig: {e}"))?;

            let mut doc = entity.description.trim().to_string();
            if !entity.fields.is_empty() {
                if !doc.is_empty() {
                    doc.push_str("\n\n");
                }
                for f in &entity.fields {
                    doc.push_str(&format!("- **{}:** {}\n", f.label, f.value));
                }
            }
            write_atomic(&path, &doc).map_err(|e| format!("{rel} schreiben: {e}"))?;

            // Formulardaten aus dem JSON entfernen — das Dokument ist jetzt die Quelle.
            entity.description = String::new();
            entity.fields = Vec::new();
            let json = serde_json::to_string_pretty(&entity)
                .map_err(|e| format!("Serialisierung: {e}"))?;
            write_atomic(&p.abs(&json_rel), json)
                .map_err(|e| format!("{json_rel} schreiben: {e}"))?;

            p.note_mtime(&json_rel);
            p.note_mtime(&rel);
            p.search_dirty = true;
            return Ok(doc);
        }
        let content = fs::read_to_string(&path).map_err(|e| format!("{rel} lesen: {e}"))?;
        p.note_mtime(&rel);
        Ok(content)
    })
}

#[tauri::command]
pub fn write_entity_doc(
    kind: String,
    id: String,
    content: String,
    force: bool,
    state: tauri::State<AppState>,
) -> Result<WriteResult, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = entity_doc_rel(dir, &id);
        let path = p.abs(&rel);
        if !force && p.changed_externally(&rel) {
            return Ok(WriteResult::Conflict);
        }
        write_atomic(&path, &content).map_err(|e| format!("{rel} schreiben: {e}"))?;
        p.note_mtime(&rel);
        p.search_dirty = true;
        Ok(WriteResult::Ok)
    })
}

/// Legt das Bild eines Eintrags ab (`{id}-img.{ext}`), trägt es im JSON ein
/// und entfernt ein vorheriges Bild mit anderer Endung.
fn store_entity_image(
    p: &mut OpenProject,
    dir: &str,
    entity: &mut Entity,
    bytes: &[u8],
    ext: &str,
) -> Result<(), String> {
    let image_name = format!("{}-img.{ext}", entity.id);
    write_atomic(&p.abs(dir).join(&image_name), bytes)
        .map_err(|e| format!("Bild speichern: {e}"))?;
    if let Some(old) = entity.image.replace(image_name.clone()) {
        if old != image_name && !old.contains(['/', '\\']) && !old.contains("..") {
            let _ = fs::remove_file(p.abs(dir).join(old));
        }
    }
    let rel = entity_rel_path(dir, &entity.id);
    let json = serde_json::to_string_pretty(entity).map_err(|e| format!("Serialisierung: {e}"))?;
    write_atomic(&p.abs(&rel), json).map_err(|e| format!("{rel} schreiben: {e}"))?;
    p.note_mtime(&rel);
    Ok(())
}

fn load_entity(p: &OpenProject, dir: &str, id: &str) -> Result<Entity, String> {
    let rel = entity_rel_path(dir, id);
    let raw = fs::read_to_string(p.abs(&rel)).map_err(|e| format!("{rel} lesen: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("{rel} ungültig: {e}"))
}

/// Übernimmt ein Bild in den Entity-Ordner, auf Vorschaugröße verkleinert —
/// das Original bräuchte bei jedem Öffnen unnötig lange über die IPC.
/// Lesen und Verkleinern laufen außerhalb des Locks.
#[tauri::command(async)]
pub fn set_entity_image(
    kind: String,
    id: String,
    source_path: String,
    state: tauri::State<AppState>,
) -> Result<Entity, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    let ext = images::image_ext_of(&source_path)?;
    let original = fs::read(&source_path).map_err(|e| format!("Bild lesen: {e}"))?;
    let (bytes, ext) = match images::shrink_to_preview(&original) {
        Some((small, small_ext)) => (small, small_ext.to_string()),
        None => (original, ext),
    };
    with_project(&state, |p| {
        let mut entity = load_entity(p, dir, &id)?;
        store_entity_image(p, dir, &mut entity, &bytes, &ext)?;
        Ok(entity)
    })
}

/// Liefert das Entity-Bild als data-URL (base64) — vermeidet Asset-Protocol-Scopes.
/// Läuft abseits des Hauptthreads, und das (evtl. große) Bild wird erst nach
/// dem Lock gelesen: sonst wartet das Laden des Dokuments auf das Bild.
/// Ältere Projekte enthalten noch Originalbilder: die werden hier einmalig
/// durch die Vorschaugröße ersetzt.
#[tauri::command(async)]
pub fn get_entity_image(
    kind: String,
    id: String,
    state: tauri::State<AppState>,
) -> Result<Option<String>, String> {
    let dir = entity_dir(&kind)?;
    validate_id(&id)?;
    let found = with_project(&state, |p| {
        let rel = entity_rel_path(dir, &id);
        let raw = match fs::read_to_string(p.abs(&rel)) {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };
        let entity: Entity =
            serde_json::from_str(&raw).map_err(|e| format!("{rel} ungültig: {e}"))?;
        let Some(image) = entity.image else {
            return Ok(None);
        };
        // Der Name stammt aus einer Projektdatei — nur Dateien direkt im
        // Ordner des Eintrags, nichts außerhalb des Projekts.
        if image.contains(['/', '\\']) || image.contains("..") {
            return Err(format!("Ungültiger Bildname: {image}"));
        }
        Ok(Some((p.abs(dir).join(&image), image)))
    })?;
    let Some((path, image)) = found else {
        return Ok(None);
    };
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    if let Some((small, ext)) = images::shrink_to_preview(&bytes) {
        // Nur ersetzen, wenn der Eintrag inzwischen kein anderes Bild hat.
        // Scheitert das, wird eben beim nächsten Mal wieder verkleinert.
        let _ = with_project(&state, |p| {
            let mut entity = load_entity(p, dir, &id)?;
            if entity.image.as_deref() == Some(image.as_str()) {
                store_entity_image(p, dir, &mut entity, &small, ext)?;
            }
            Ok(())
        });
        return Ok(Some(images::data_url(&small, ext)));
    }
    Ok(Some(images::data_url(&bytes, &images::ext_lower(&image))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kaputte_datei_reisst_die_liste_nicht_mit() {
        let dir =
            std::env::temp_dir().join(format!("distelfink-entities-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("anna-aaa111.json"),
            r#"{"id":"anna-aaa111","name":"Anna"}"#,
        )
        .unwrap();
        fs::write(dir.join("bert-bbb222.json"), "{ halb geschr").unwrap();
        fs::write(dir.join("anna-aaa111.md"), "Text").unwrap();

        let list = read_entity_dir(&dir, "characters");

        assert_eq!(list.entities.len(), 1);
        assert_eq!(list.entities[0].name, "Anna");
        assert_eq!(list.broken, vec!["characters/bert-bbb222.json".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }
}
