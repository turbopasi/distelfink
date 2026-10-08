//! Volltextsuche über das gesamte Projekt (Phase 4).
//!
//! SQLite-FTS5-Index in `.cache/index.sqlite` — reiner Cache: wird bei Bedarf
//! (fehlend, korrupt oder veraltet) komplett aus den Klartextdateien neu
//! aufgebaut und gehört weder in Git noch in den Sync.

use crate::entities::{self, EntityKind};
use crate::layout::{CACHE_DIR, TIMELINE_FILE};
use crate::project::{
    catch_panic, scene_rel_path, scene_titles, with_project, AppState, OpenProject,
};
use rusqlite::Connection;
use serde::Serialize;
use std::fs;
use std::sync::Mutex;

/// Zwei Suchen kurz hintereinander (Tippen im Suchfeld) teilen sich eine
/// Indexdatei — ohne diese Sperre bauten sie sie gleichzeitig neu auf.
static SEARCH_LOCK: Mutex<()> = Mutex::new(());

/// Was ein Treffer in Suche und Fundstellen ist. Im Suchindex steht die Art
/// als Text (`as_str`), zur Oberfläche geht sie genauso.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Scene,
    Character,
    Location,
    Event,
}

impl ItemKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ItemKind::Scene => "scene",
            ItemKind::Character => "character",
            ItemKind::Location => "location",
            ItemKind::Event => "event",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// `ItemKind::as_str`, so wie es im Index steht.
    pub kind: String,
    pub id: String,
    pub title: String,
    /// Fundstellen-Ausschnitt mit <b>-Markierung.
    pub snippet: String,
}

/// Baut den FTS-Index vollständig neu auf — in einer einzigen Transaktion.
/// Ohne sie schriebe SQLite jede Zeile einzeln fest, jede mit eigenem Sync auf
/// die Platte; bei ein paar hundert Szenen dauerte das Sekunden.
fn rebuild_index(p: &OpenProject, conn: &Connection) -> Result<(), String> {
    let err = |e: rusqlite::Error| format!("Suchindex: {e}");
    let tx = conn.unchecked_transaction().map_err(err)?;
    fill_index(p, &tx)?;
    tx.commit().map_err(err)
}

fn fill_index(p: &OpenProject, conn: &Connection) -> Result<(), String> {
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
    for (id, title) in scene_titles(&p.meta.binder) {
        let body = fs::read_to_string(p.abs(&scene_rel_path(&id))).unwrap_or_default();
        insert
            .execute((ItemKind::Scene.as_str(), &id, &title, &body))
            .map_err(err)?;
    }

    // Personen & Orte: Name + Beschreibung + freie Felder
    for kind in EntityKind::ALL {
        for entity in entities::read_all(&p.root, kind).entities {
            let mut body = entity.description.clone();
            for f in &entity.fields {
                body.push('\n');
                body.push_str(&f.label);
                body.push_str(": ");
                body.push_str(&f.value);
            }
            // Freitext-Dokument (neben dem JSON) — bei migrierten Einträgen
            // die eigentliche Quelle.
            if let Ok(doc) = fs::read_to_string(p.abs(&entities::entity_doc_rel(kind, &entity.id)))
            {
                body.push('\n');
                body.push_str(&doc);
            }
            insert
                .execute((kind.item_kind().as_str(), &entity.id, &entity.name, &body))
                .map_err(err)?;
        }
    }

    // Zeitstrahl-Ereignisse
    if let Ok(raw) = fs::read_to_string(p.abs(TIMELINE_FILE)) {
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
                    insert
                        .execute((ItemKind::Event.as_str(), id, title, &body))
                        .map_err(err)?;
                }
            }
        }
    }

    // Mindboards: Name als Titel, Notiztexte als Inhalt
    for board in crate::mindboard::read_all(p) {
        let body = crate::mindboard::search_body(&board);
        insert
            .execute(("mindboard", &board.id, &board.name, &body))
            .map_err(err)?;
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

#[tauri::command(async)]
pub fn search_project(
    query: String,
    state: tauri::State<AppState>,
) -> Result<Vec<SearchHit>, String> {
    let fts_query = build_fts_query(&query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let _search = SEARCH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // Den Aufbau-Bedarf übernehmen und gleich zurücksetzen: was während des
    // Aufbaus gespeichert wird, setzt ihn wieder und löst den nächsten aus.
    let p = &with_project(&state, |p| {
        let detached = p.detached();
        p.search_dirty = false;
        Ok(detached)
    })?;

    let result = catch_panic("Die Suche", || {
        let cache_dir = p.abs(CACHE_DIR);
        fs::create_dir_all(&cache_dir).map_err(|e| format!("{CACHE_DIR} anlegen: {e}"))?;
        let db_path = cache_dir.join("index.sqlite");

        let mut conn = Connection::open(&db_path).map_err(|e| format!("Suchindex öffnen: {e}"))?;

        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE name = 'docs'",
                (),
                |row| row.get(0),
            )
            .unwrap_or(false);

        let needs_rebuild = p.search_dirty || !table_exists;
        if needs_rebuild && rebuild_index(p, &conn).is_err() {
            // Cache evtl. korrupt → Datei verwerfen und einmal neu versuchen.
            drop(conn);
            let _ = fs::remove_file(&db_path);
            conn = Connection::open(&db_path).map_err(|e| format!("Suchindex neu anlegen: {e}"))?;
            rebuild_index(p, &conn)?;
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
    });
    if result.is_err() {
        // Der Index ist womöglich nicht (vollständig) aufgebaut — beim
        // nächsten Mal von vorn.
        let _ = with_project(&state, |p| {
            p.search_dirty = true;
            Ok(())
        });
    }
    result
}
