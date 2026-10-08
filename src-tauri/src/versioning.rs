//! Ebene C: interne Git-Versionierung des Projektordners (Phase 5).
//!
//! Beim Anlegen/Öffnen eines Projekts wird im Projektordner ein `.git`-Repo
//! initialisiert — für den Nutzer unsichtbar, kein Git-Wissen nötig.
//! Sicherungspunkte entstehen automatisch (Intervall, Öffnen/Schließen) und
//! manuell per Button; die Verlaufsansicht listet pro Datei alle Versionen
//! und kann jede davon wiederherstellen.
//!
//! Erweiterungspunkt (bewusst NICHT im MVP): eigenes Remote (privates
//! GitHub-/GitLab-Repo) als zusätzliches Cloud-Backup der Historie. Dafür
//! müsste `git2` mit https/ssh-Features gebaut und hier Push-Logik ergänzt
//! werden — alle übrigen Abläufe bleiben unverändert.

use git2::{IndexAddOption, Oid, Repository, Signature, Sort};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::project::{detached_project, with_project, AppState};

/// Obergrenze für die Verlaufsliste einer Datei.
const MAX_HISTORY: usize = 300;

/// Schreibende Git-Zugriffe nacheinander: ein automatischer und ein manueller
/// Sicherungspunkt gleichzeitig stolperten sonst über Gits `index.lock`.
/// Reihenfolge der Sperren: erst diese, dann (kurz) der Projekt-Lock — nie
/// umgekehrt, sonst droht ein Deadlock.
static GIT_LOCK: Mutex<()> = Mutex::new(());

fn git_lock() -> MutexGuard<'static, ()> {
    GIT_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub commit_id: String,
    /// Commit-Zeitpunkt in Millisekunden seit Unix-Epoche.
    pub timestamp_ms: i64,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Repo-Grundfunktionen
// ---------------------------------------------------------------------------

fn open_or_init(root: &Path) -> Result<Repository, String> {
    match Repository::open(root) {
        Ok(repo) => Ok(repo),
        Err(_) => {
            Repository::init(root).map_err(|e| format!("Git-Repo initialisieren: {}", e.message()))
        }
    }
}

fn signature(author: &str) -> Result<Signature<'static>, String> {
    let name = author.trim();
    let name = if name.is_empty() { "Autor" } else { name };
    Signature::now(name, "autor@distelfink.local")
        .map_err(|e| format!("Git-Signatur: {}", e.message()))
}

/// Stellt alle Änderungen (inkl. Löschungen, ohne `.gitignore`-Ausschlüsse)
/// bereit und committet sie. Gibt `false` zurück, wenn nichts zu sichern war.
fn commit_all(repo: &Repository, author: &str, message: &str) -> Result<bool, String> {
    let gerr = |ctx: &str| {
        let ctx = ctx.to_string();
        move |e: git2::Error| format!("{ctx}: {}", e.message())
    };

    let mut index = repo.index().map_err(gerr("Git-Index öffnen"))?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(gerr("Änderungen bereitstellen"))?;
    // add_all erfasst keine gelöschten Dateien — update_all trägt sie nach.
    index
        .update_all(["*"].iter(), None)
        .map_err(gerr("Löschungen bereitstellen"))?;
    index.write().map_err(gerr("Git-Index schreiben"))?;
    let tree_id = index.write_tree().map_err(gerr("Git-Tree schreiben"))?;

    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(parent) = &head {
        if parent.tree_id() == tree_id {
            return Ok(false);
        }
    }

    let tree = repo.find_tree(tree_id).map_err(gerr("Git-Tree lesen"))?;
    let sig = signature(author)?;
    let parents: Vec<_> = head.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(gerr("Sicherungspunkt erstellen"))?;
    Ok(true)
}

/// Beim Anlegen/Öffnen eines Projekts: Repo sicherstellen, `.gitignore`
/// nachziehen (ältere Projekte) und den aktuellen Stand als Basis committen.
pub(crate) fn ensure_repo(root: &Path, author: &str, message: &str) -> Result<(), String> {
    ensure_gitignore(root)?;
    let _git = git_lock();
    let repo = open_or_init(root)?;
    commit_all(&repo, author, message)?;
    Ok(())
}

/// Einträge, die jede Projekt-`.gitignore` haben muss: Cache und Papierkorb
/// gehören nicht in den Verlauf, liegengebliebene Zwischendateien vom
/// Speichern (`fsutil::write_atomic`) auch nicht.
fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    let current = fs::read_to_string(&path).unwrap_or_default();
    let tmp_pattern = format!("*{}", crate::fsutil::TMP_SUFFIX);
    let missing: Vec<&str> = [".cache/", ".trash/", tmp_pattern.as_str()]
        .into_iter()
        .filter(|entry| !current.lines().any(|l| l.trim() == *entry))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    for entry in missing {
        next.push_str(entry);
        next.push('\n');
    }
    fs::write(&path, next).map_err(|e| format!(".gitignore schreiben: {e}"))
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen für Verlauf/Wiederherstellung
// ---------------------------------------------------------------------------

/// Projektrelative Pfade aus dem Frontend: schlicht, vorwärts-slashed,
/// keine Traversal- oder Punkt-Komponenten (schließt `.git`/`.cache` aus).
fn validate_rel(rel: &str) -> Result<(), String> {
    let ok = !rel.is_empty()
        && rel.len() <= 256
        && !rel.contains('\\')
        && rel.split('/').all(|c| !c.is_empty() && !c.starts_with('.'));
    if ok {
        Ok(())
    } else {
        Err(format!("Ungültiger Pfad: {rel:?}"))
    }
}

/// Blob-ID der Datei `rel` im Tree des Commits (None = existierte dort nicht).
fn blob_id_at(commit: &git2::Commit, rel: &str) -> Option<Oid> {
    commit
        .tree()
        .ok()?
        .get_path(Path::new(rel))
        .ok()
        .map(|e| e.id())
}

fn version_content(repo: &Repository, commit_id: &str, rel: &str) -> Result<String, String> {
    let oid =
        Oid::from_str(commit_id).map_err(|_| format!("Ungültige Versions-ID: {commit_id:?}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Version nicht gefunden: {}", e.message()))?;
    let entry = commit
        .tree()
        .and_then(|t| t.get_path(Path::new(rel)))
        .map_err(|e| format!("Datei in dieser Version nicht gefunden: {}", e.message()))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Version lesen: {}", e.message()))?;
    Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Setzt einen Sicherungspunkt über das ganze Projekt. Ohne `message` als
/// automatischer Sicherungspunkt. Rückgabe: ob es etwas zu sichern gab.
#[tauri::command(async)]
pub fn snapshot(message: Option<String>, state: tauri::State<AppState>) -> Result<bool, String> {
    // Committet ohne den Projekt-Lock: Speichern läuft währenddessen weiter.
    let p = detached_project(&state)?;
    let msg = message
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "Automatischer Sicherungspunkt".into());
    let _git = git_lock();
    let repo = open_or_init(&p.root)?;
    commit_all(&repo, &p.meta.author, &msg)
}

/// Alle Versionen einer Datei (neueste zuerst): nur Commits, in denen sich
/// ihr Inhalt gegenüber dem Vorgänger geändert hat.
#[tauri::command(async)]
pub fn list_history(
    rel: String,
    state: tauri::State<AppState>,
) -> Result<Vec<VersionInfo>, String> {
    validate_rel(&rel)?;
    let p = detached_project(&state)?;
    let repo = open_or_init(&p.root)?;
    let mut walk = match repo.revwalk() {
        Ok(w) => w,
        Err(_) => return Ok(Vec::new()),
    };
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // Repo noch ohne Commits
    }
    let _ = walk.set_sorting(Sort::TIME);

    let mut versions = Vec::new();
    for oid in walk {
        let Ok(oid) = oid else { continue };
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let id = blob_id_at(&commit, &rel);
        let parent_id = commit.parent(0).ok().and_then(|par| blob_id_at(&par, &rel));
        if id.is_some() && id != parent_id {
            versions.push(VersionInfo {
                commit_id: oid.to_string(),
                timestamp_ms: commit.time().seconds() * 1000,
                message: commit.message().unwrap_or("").trim().to_string(),
            });
            if versions.len() >= MAX_HISTORY {
                break;
            }
        }
    }
    Ok(versions)
}

/// Inhalt der Datei `rel` zum Zeitpunkt des Commits `commit_id`.
#[tauri::command(async)]
pub fn get_version(
    commit_id: String,
    rel: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    validate_rel(&rel)?;
    let p = detached_project(&state)?;
    let repo = open_or_init(&p.root)?;
    version_content(&repo, &commit_id, &rel)
}

/// Stellt eine frühere Version wieder her. Vorher wird der aktuelle Stand
/// gesichert (nichts geht verloren), danach die Wiederherstellung committet.
/// Rückgabe: der wiederhergestellte Inhalt (fürs Neuladen im Editor).
#[tauri::command(async)]
pub fn restore_version(
    commit_id: String,
    rel: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    validate_rel(&rel)?;
    let p = detached_project(&state)?;
    let author = &p.meta.author;
    let _git = git_lock();
    let repo = open_or_init(&p.root)?;
    commit_all(&repo, author, "Sicherungspunkt vor Wiederherstellung")?;

    let content = version_content(&repo, &commit_id, &rel)?;
    // Nur das Zurückschreiben braucht den Projekt-Lock (bekannte mtime).
    with_project(&state, |live| {
        crate::fsutil::write_atomic(&live.abs(&rel), &content)
            .map_err(|e| format!("Wiederherstellen ({rel}): {e}"))?;
        live.note_mtime(&rel);
        live.search_dirty = true;
        Ok(())
    })?;

    let oid = Oid::from_str(&commit_id).unwrap_or(Oid::ZERO_SHA1);
    let stamp = repo
        .find_commit(oid)
        .ok()
        .and_then(|c| chrono::DateTime::from_timestamp(c.time().seconds(), 0))
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%d.%m.%Y %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| commit_id.chars().take(7).collect());
    commit_all(
        &repo,
        author,
        &format!("Wiederhergestellt: {rel} (Stand vom {stamp})"),
    )?;
    Ok(content)
}
