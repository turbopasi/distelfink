//! Volltextsuche über das gesamte Projekt (Phase 4).
//!
//! SQLite-FTS5-Index in `.cache/index.sqlite` — reiner Cache: wird bei Bedarf
//! (fehlend, korrupt oder veraltet) komplett aus den Klartextdateien neu
//! aufgebaut und gehört weder in Git noch in den Sync.

use crate::project::{scene_rel_path, with_project, AppState, BinderNode};
use rusqlite::Connection;
use serde::Serialize;
use std::fs;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// "scene" | "character" | "location" | "event"
    pub kind: String,
    pub id: String,
    pub title: String,
    /// Fundstellen-Ausschnitt mit <b>-Markierung.
    pub snippet: String,
}

fn collect_scene_titles(nodes: &[BinderNode], out: &mut Vec<(String, String)>) {
    for n in nodes {
        if matches!(n.kind, crate::project::NodeKind::Scene) {
            out.push((n.id.clone(), n.title.clone()));
        }
        collect_scene_titles(&n.children, out);
    }
}

/// Baut den FTS-Index vollständig neu auf.
fn rebuild_index(
    p: &crate::project::OpenProject,
    conn: &Connection,
) -> Result<(), String> {
    let err = |e: rusqlite::Error| format!("Suchindex: {e}");
    conn.execute_batch(
        "DROP TABLE IF EXISTS docs;
         CREATE VIRTUAL TABLE docs USING fts5(
             kind UNINDEXED, id UNINDEXED, title, body,
             tokenize = 'unicode61 remove_diacritics 2'
         );",
    )
    .map_err(err)?;

    let mut insert = conn
        .prepare("INSERT INTO docs (kind, id, title, body) VALUES (?1, ?2, ?3, ?4)")
        .map_err(err)?;

    // Szenen: Titel aus dem Binder, Inhalt aus manuscript/<id>.md
    let mut titles = Vec::new();
    collect_scene_titles(&p.meta.binder, &mut titles);
    for (id, title) in titles {
        let body = fs::read_to_string(p.abs(&scene_rel_path(&id))).unwrap_or_default();
        insert.execute(("scene", &id, &title, &body)).map_err(err)?;
    }

    // Personen & Orte: Name + Beschreibung + freie Felder
    for (kind, dir) in [("character", "characters"), ("location", "locations")] {
        let Ok(entries) = fs::read_dir(p.abs(dir)) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(entity) = serde_json::from_str::<crate::research::Entity>(&raw) else {
                continue;
            };
            let mut body = entity.description.clone();
            for f in &entity.fields {
                body.push('\n');
                body.push_str(&f.label);
                body.push_str(": ");
                body.push_str(&f.value);
            }
            // Freitext-Dokument (neben dem JSON) — bei migrierten Einträgen
            // die eigentliche Quelle.
            if let Ok(doc) = fs::read_to_string(path.with_extension("md")) {
                body.push('\n');
                body.push_str(&doc);
            }
            insert
                .execute((kind, &entity.id, &entity.name, &body))
                .map_err(err)?;
        }
    }

    // Zeitstrahl-Ereignisse
    if let Ok(raw) = fs::read_to_string(p.abs("timeline.json")) {
        if let Ok(file) = serde_json::from_str::<serde_json::Value>(&raw) {
            for ev in file["events"].as_array().unwrap_or(&Vec::new()) {
                let id = ev["id"].as_str().unwrap_or_default();
                let title = ev["title"].as_str().unwrap_or_default();
                let body = format!(
                    "{}\n{}",
                    ev["when"].as_str().unwrap_or_default(),
                    ev["description"].as_str().unwrap_or_default()
                );
                if !id.is_empty() {
                    insert.execute(("event", id, title, &body)).map_err(err)?;
                }
            }
        }
    }

    Ok(())
}

/// FTS5-Query aus Nutzereingabe: jeder Begriff als Präfix-Phrase, implizit UND.
fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn search_project(
    query: String,
    state: tauri::State<AppState>,
) -> Result<Vec<SearchHit>, String> {
    with_project(&state, |p| {
        let fts_query = build_fts_query(&query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let cache_dir = p.abs(".cache");
        fs::create_dir_all(&cache_dir).map_err(|e| format!(".cache anlegen: {e}"))?;
        let db_path = cache_dir.join("index.sqlite");

        let mut conn =
            Connection::open(&db_path).map_err(|e| format!("Suchindex öffnen: {e}"))?;

        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE name = 'docs'",
                (),
                |row| row.get(0),
            )
            .unwrap_or(false);

        if p.search_dirty || !table_exists {
            if rebuild_index(p, &conn).is_err() {
                // Cache evtl. korrupt → Datei verwerfen und einmal neu versuchen.
                drop(conn);
                let _ = fs::remove_file(&db_path);
                conn = Connection::open(&db_path)
                    .map_err(|e| format!("Suchindex neu anlegen: {e}"))?;
                rebuild_index(p, &conn)?;
            }
            p.search_dirty = false;
        }

        let mut stmt = conn
            .prepare(
                "SELECT kind, id, title,
                        snippet(docs, 3, '<b>', '</b>', '…', 14)
                 FROM docs WHERE docs MATCH ?1 ORDER BY rank LIMIT 40",
            )
            .map_err(|e| format!("Suche: {e}"))?;
        let hits = stmt
            .query_map([&fts_query], |row| {
                Ok(SearchHit {
                    kind: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                })
            })
            .map_err(|e| format!("Suche: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(hits)
    })
}
