//! Projekt-Dateiformat (`.autorproj`) und zugehörige Tauri-Commands.
//!
//! Ein Projekt ist ein Ordner mit vielen kleinen Klartextdateien (sync- und
//! git-freundlich). `project.json` hält Metadaten + Binder-Baum; Szenentexte
//! liegen als einzelne Markdown-Dateien flach in `manuscript/`, benannt nach
//! ihrer stabilen Node-ID. Dateien werden beim Umsortieren im Binder NICHT
//! umbenannt oder verschoben — das vermeidet Sync-Konflikte.

use crate::fsutil::write_atomic;
use crate::trash;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

pub const FORMAT_VERSION: u32 = 1;
pub const PROJECT_FILE: &str = "project.json";

// ---------------------------------------------------------------------------
// Datenmodell
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Chapter,
    Scene,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BinderNode {
    pub id: String,
    pub kind: NodeKind,
    pub title: String,
    /// Kurzbeschreibung für die Corkboard-Karteikarte.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub synopsis: String,
    /// "draft" | "revision" | "done"
    #[serde(default = "default_status", skip_serializing_if = "is_default_status")]
    pub status: String,
    /// Farbcodierung als CSS-Farbe (z. B. "#e6b33f").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Kartenbild fürs Corkboard: projektrelativer Pfad unter `images/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default)]
    pub children: Vec<BinderNode>,
}

fn default_status() -> String {
    "draft".into()
}

fn is_default_status(s: &str) -> bool {
    s == "draft"
}

impl BinderNode {
    fn new(id: String, kind: NodeKind, title: String) -> Self {
        BinderNode {
            id,
            kind,
            title,
            synopsis: String::new(),
            status: default_status(),
            color: None,
            tags: Vec::new(),
            image: None,
            children: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub format_version: u32,
    pub title: String,
    pub author: String,
    pub created: String,
    pub binder: Vec<BinderNode>,
}

/// Zustand des aktuell geöffneten Projekts (im Tauri-State gemanagt).
pub struct OpenProject {
    pub root: PathBuf,
    pub meta: ProjectMeta,
    /// Letzter bekannter mtime (ms) pro projektrelativer Datei — Grundlage
    /// der Erkennung externer Änderungen (Dropbox, zweite Maschine, …).
    pub known_mtimes: HashMap<String, u64>,
    /// true, wenn sich seit dem letzten Suchindex-Aufbau etwas geändert hat.
    pub search_dirty: bool,
}

#[derive(Default)]
pub struct AppState(pub Mutex<Option<OpenProject>>);

impl AppState {
    /// Sperrt den Zustand. Ein Panic in einem früheren Command vergiftet den
    /// Mutex; ohne das `into_inner` ließe sich danach bis zum Neustart nichts
    /// mehr speichern — genau dann, wenn ungesicherter Text im Editor steht.
    pub(crate) fn lock(&self) -> MutexGuard<'_, Option<OpenProject>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub meta: ProjectMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum WriteResult {
    /// Erfolgreich geschrieben.
    Ok,
    /// Datei wurde seit letztem bekannten Stand extern verändert;
    /// nicht geschrieben (außer `force`).
    Conflict,
}

/// Wie `WriteResult`, für Dateien, die als Ganzes gespeichert werden und deren
/// normalisierten Stand die Oberfläche zurückbekommt (Zeitstrahl, Mindboards).
#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Saved<T> {
    Ok { data: T },
    /// Datei wurde seit letztem bekannten Stand extern verändert; nicht
    /// geschrieben (außer `force`).
    Conflict,
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

pub(crate) fn mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// IDs sind slug + Zufallssuffix; nur [a-z0-9-] — schützt zugleich vor
/// Pfad-Traversal, da IDs direkt Dateinamen bilden.
fn validate_id(id: &str) -> Result<(), String> {
    if !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        Ok(())
    } else {
        Err(format!("Ungültige Node-ID: {id:?}"))
    }
}

pub(crate) fn make_id(title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ä' => "ae".into(),
            'ö' => "oe".into(),
            'ü' => "ue".into(),
            'ß' => "ss".into(),
            c if c.is_ascii_lowercase() || c.is_ascii_digit() => c.to_string(),
            _ => "-".into(),
        })
        .collect();
    let slug: String = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(24)
        .collect();
    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..6];
    if slug.is_empty() {
        format!("node-{suffix}")
    } else {
        format!("{}-{suffix}", slug.trim_end_matches('-'))
    }
}

pub(crate) fn validate_id_pub(id: &str) -> Result<(), String> {
    validate_id(id)
}

pub(crate) fn scene_rel_path(id: &str) -> String {
    format!("manuscript/{id}.md")
}

fn find_node<'a>(nodes: &'a [BinderNode], id: &str) -> Option<&'a BinderNode> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(found) = find_node(&n.children, id) {
            return Some(found);
        }
    }
    None
}

fn find_node_mut<'a>(nodes: &'a mut [BinderNode], id: &str) -> Option<&'a mut BinderNode> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(found) = find_node_mut(&mut n.children, id) {
            return Some(found);
        }
    }
    None
}

/// Entfernt den Node mit `id` aus dem Baum und gibt ihn zurück.
fn remove_node(nodes: &mut Vec<BinderNode>, id: &str) -> Option<BinderNode> {
    if let Some(pos) = nodes.iter().position(|n| n.id == id) {
        return Some(nodes.remove(pos));
    }
    for n in nodes.iter_mut() {
        if let Some(found) = remove_node(&mut n.children, id) {
            return Some(found);
        }
    }
    None
}

/// Klont einen Teilbaum mit frischen IDs. `scene_copies` sammelt die Paare
/// (alte, neue Szenen-ID), damit der Aufrufer die Dateien mitkopieren kann.
fn clone_subtree(node: &BinderNode, scene_copies: &mut Vec<(String, String)>) -> BinderNode {
    let mut clone = node.clone();
    clone.id = make_id(&node.title);
    if node.kind == NodeKind::Scene {
        scene_copies.push((node.id.clone(), clone.id.clone()));
    }
    clone.children = node
        .children
        .iter()
        .map(|c| clone_subtree(c, scene_copies))
        .collect();
    clone
}

/// Hängt `node` direkt hinter das Geschwisterkind `after_id`. Wird `after_id`
/// nicht gefunden, kommt der Node unverbraucht zurück (`Err`).
fn insert_after(
    nodes: &mut Vec<BinderNode>,
    after_id: &str,
    node: BinderNode,
) -> Result<(), BinderNode> {
    if let Some(pos) = nodes.iter().position(|n| n.id == after_id) {
        nodes.insert(pos + 1, node);
        return Ok(());
    }
    let mut node = node;
    for n in nodes.iter_mut() {
        match insert_after(&mut n.children, after_id, node) {
            Ok(()) => return Ok(()),
            Err(back) => node = back,
        }
    }
    Err(node)
}

pub(crate) fn collect_scene_ids(node: &BinderNode, out: &mut Vec<String>) {
    if node.kind == NodeKind::Scene {
        out.push(node.id.clone());
    }
    for c in &node.children {
        collect_scene_ids(c, out);
    }
}

fn is_descendant(nodes: &[BinderNode], ancestor_id: &str, id: &str) -> bool {
    match find_node(nodes, ancestor_id) {
        Some(n) => find_node(&n.children, id).is_some(),
        None => false,
    }
}

impl OpenProject {
    pub(crate) fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    /// Merkt sich den aktuellen mtime einer Datei als "bekannt".
    pub(crate) fn note_mtime(&mut self, rel: &str) {
        if let Some(mt) = mtime_ms(&self.abs(rel)) {
            self.known_mtimes.insert(rel.into(), mt);
        }
    }

    /// true, wenn `rel` seit dem letzten eigenen Lesen/Schreiben von außen
    /// verändert wurde. Dateien ohne bekannten Stand gelten als unverändert.
    pub(crate) fn changed_externally(&self, rel: &str) -> bool {
        match (self.known_mtimes.get(rel), mtime_ms(&self.abs(rel))) {
            (Some(known), Some(current)) => current != *known,
            _ => false,
        }
    }

    pub(crate) fn write_meta(&mut self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.meta)
            .map_err(|e| format!("Serialisierung fehlgeschlagen: {e}"))?;
        let path = self.abs(PROJECT_FILE);
        write_atomic(&path, json).map_err(|e| format!("project.json schreiben: {e}"))?;
        self.note_mtime(PROJECT_FILE);
        self.search_dirty = true;
        Ok(())
    }

    /// Übernimmt eine von außen geänderte project.json (Sync von einem zweiten
    /// Rechner), bevor der Binder geändert wird. Sonst schriebe die nächste
    /// Binder-Änderung den alten Stand aus dem Speicher zurück, und dort neu
    /// angelegte Szenen verschwänden aus dem Binder. Ist die Datei gerade
    /// unlesbar (Sync mittendrin), bricht die Änderung ab, statt sie zu
    /// überschreiben.
    pub(crate) fn refresh_meta(&mut self) -> Result<(), String> {
        if !self.changed_externally(PROJECT_FILE) {
            return Ok(());
        }
        self.meta = read_meta(&self.root)?;
        self.note_mtime(PROJECT_FILE);
        self.search_dirty = true;
        // Szenen, die dabei hinzugekommen sind, bekommen einen bekannten Stand —
        // sonst liefe ihr erstes Speichern ohne Konfliktprüfung.
        let mut ids = Vec::new();
        for n in &self.meta.binder {
            collect_scene_ids(n, &mut ids);
        }
        for id in ids {
            let rel = scene_rel_path(&id);
            if !self.known_mtimes.contains_key(&rel) {
                self.note_mtime(&rel);
            }
        }
        Ok(())
    }

    fn snapshot_mtimes(&mut self) {
        self.known_mtimes.clear();
        let mut ids = Vec::new();
        for n in &self.meta.binder {
            collect_scene_ids(n, &mut ids);
        }
        for id in ids {
            self.note_mtime(&scene_rel_path(&id));
        }
        self.note_mtime(PROJECT_FILE);
        self.note_mtime("timeline.json");
        for id in crate::mindboard::board_ids(&self.root) {
            self.note_mtime(&format!("{}/{id}.json", crate::mindboard::DIR));
        }
    }

    pub(crate) fn info(&self) -> ProjectInfo {
        ProjectInfo {
            root: self.root.to_string_lossy().into_owned(),
            meta: self.meta.clone(),
        }
    }
}

pub(crate) fn with_project<T>(
    state: &tauri::State<AppState>,
    f: impl FnOnce(&mut OpenProject) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.lock();
    let project = guard.as_mut().ok_or("Kein Projekt geöffnet")?;
    f(project)
}

/// Wie `with_project`, für Änderungen am Binder: übernimmt vorher externe
/// Änderungen an project.json (siehe `refresh_meta`).
fn with_binder<T>(
    state: &tauri::State<AppState>,
    f: impl FnOnce(&mut OpenProject) -> Result<T, String>,
) -> Result<T, String> {
    with_project(state, |p| {
        p.refresh_meta()?;
        f(p)
    })
}

/// Liest und prüft project.json.
fn read_meta(root: &Path) -> Result<ProjectMeta, String> {
    let raw = fs::read_to_string(root.join(PROJECT_FILE))
        .map_err(|e| format!("project.json lesen: {e}"))?;
    let meta: ProjectMeta =
        serde_json::from_str(&raw).map_err(|e| format!("project.json ungültig: {e}"))?;
    if meta.format_version > FORMAT_VERSION {
        return Err(format!(
            "Projektformat v{} ist neuer als diese App-Version unterstützt (v{FORMAT_VERSION})",
            meta.format_version
        ));
    }
    Ok(meta)
}

/// Entfernt Zwischendateien, die ein Absturz beim Speichern hinterlassen hat.
fn remove_stale_tmp_files(root: &Path) {
    for dir in ["", "manuscript", "characters", "locations", crate::mindboard::DIR, trash::TRASH_DIR]
    {
        crate::fsutil::remove_stale_tmp_files(&root.join(dir));
    }
}

// ---------------------------------------------------------------------------
// Commands: Projekt-Lebenszyklus
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_project(
    parent_dir: String,
    name: String,
    title: String,
    author: String,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    let safe_name: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .to_string();
    if safe_name.is_empty() {
        return Err("Projektname ist leer".into());
    }
    let root = Path::new(&parent_dir).join(format!("{safe_name}.autorproj"));
    if root.exists() {
        return Err(format!("Ordner existiert bereits: {}", root.display()));
    }

    for dir in ["manuscript", "characters", "locations", ".cache"] {
        fs::create_dir_all(root.join(dir)).map_err(|e| format!("Ordner anlegen ({dir}): {e}"))?;
    }
    // Die .gitignore legt `versioning::ensure_repo` unten an.
    fs::write(root.join("timeline.json"), "{\n  \"events\": []\n}\n")
        .map_err(|e| format!("timeline.json schreiben: {e}"))?;

    let scene_id = make_id("Szene 1");
    fs::write(root.join(scene_rel_path(&scene_id)), "")
        .map_err(|e| format!("Szenendatei anlegen: {e}"))?;

    let meta = ProjectMeta {
        format_version: FORMAT_VERSION,
        title: if title.trim().is_empty() { safe_name.clone() } else { title },
        author,
        created: chrono::Local::now().to_rfc3339(),
        binder: vec![{
            let mut chapter =
                BinderNode::new(make_id("Kapitel 1"), NodeKind::Chapter, "Kapitel 1".into());
            chapter
                .children
                .push(BinderNode::new(scene_id, NodeKind::Scene, "Szene 1".into()));
            chapter
        }],
    };

    let mut project = OpenProject {
        root,
        meta,
        known_mtimes: HashMap::new(),
        search_dirty: true,
    };
    project.write_meta()?;
    project.snapshot_mtimes();
    // Ebene C: Versionierung ab dem ersten Moment.
    crate::versioning::ensure_repo(&project.root, &project.meta.author, "Projekt angelegt")?;
    let info = project.info();
    *state.lock() = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn open_project(path: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    let root = PathBuf::from(&path);
    if !root.join(PROJECT_FILE).is_file() {
        return Err(format!(
            "Kein Projekt: {} enthält keine {PROJECT_FILE}",
            root.display()
        ));
    }
    let meta = read_meta(&root)?;
    remove_stale_tmp_files(&root);
    let mut project = OpenProject {
        root,
        meta,
        known_mtimes: HashMap::new(),
        search_dirty: true,
    };
    project.snapshot_mtimes();
    // Ebene C: Repo bei Altprojekten nachrüsten; externen Stand als Basis sichern.
    crate::versioning::ensure_repo(
        &project.root,
        &project.meta.author,
        "Automatischer Sicherungspunkt (Projekt geöffnet)",
    )?;
    let info = project.info();
    *state.lock() = Some(project);
    Ok(info)
}

/// Kopiert einen Ordnerbaum. `.cache/` bleibt aussen vor: reiner Wegwerf-Inhalt,
/// der in der Kopie ohnehin neu aufgebaut wird. `.git/` wandert mit, damit die
/// Kopie den kompletten Verlauf behaelt.
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Ordner anlegen ({}): {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Lesen ({}): {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("Eintrag lesen: {e}"))?;
        let name = entry.file_name();
        if name == ".cache" {
            continue;
        }
        let src = entry.path();
        let dst = to.join(&name);
        if src.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("Kopieren ({}): {e}", src.display()))?;
        }
    }
    Ok(())
}

/// „Speichern unter": legt eine vollstaendige Kopie des offenen Projekts an und
/// arbeitet ab sofort in der Kopie weiter — das Original bleibt auf dem Stand,
/// den es beim Kopieren hatte. Die Oberflaeche schreibt vorher alles Offene raus.
#[tauri::command]
pub fn save_project_as(
    parent_dir: String,
    name: String,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    let safe_name: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .to_string();
    if safe_name.is_empty() {
        return Err("Projektname ist leer".into());
    }
    let target = Path::new(&parent_dir).join(format!("{safe_name}.autorproj"));
    if target.exists() {
        return Err(format!("Ordner existiert bereits: {}", target.display()));
    }

    let source = {
        let guard = state.lock();
        guard.as_ref().ok_or("Kein Projekt geöffnet")?.root.clone()
    };
    if target.starts_with(&source) {
        return Err("Das Ziel darf nicht im Projekt selbst liegen".into());
    }
    copy_tree(&source, &target)?;

    // Die Kopie traegt den neuen Namen als Titel; alles andere bleibt gleich.
    let mut meta = read_meta(&target)?;
    meta.title = safe_name;

    let mut project = OpenProject {
        root: target,
        meta,
        known_mtimes: HashMap::new(),
        search_dirty: true,
    };
    project.write_meta()?;
    project.snapshot_mtimes();
    crate::versioning::ensure_repo(&project.root, &project.meta.author, "Projekt kopiert")?;
    let info = project.info();
    *state.lock() = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn close_project(state: tauri::State<AppState>) -> Result<(), String> {
    *state.lock() = None;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands: Szenen lesen/schreiben
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_scene(id: String, state: tauri::State<AppState>) -> Result<String, String> {
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = scene_rel_path(&id);
        let content =
            fs::read_to_string(p.abs(&rel)).map_err(|e| format!("Szene lesen ({id}): {e}"))?;
        if let Some(mt) = mtime_ms(&p.abs(&rel)) {
            p.known_mtimes.insert(rel, mt);
        }
        Ok(content)
    })
}

#[tauri::command]
pub fn write_scene(
    id: String,
    content: String,
    force: bool,
    state: tauri::State<AppState>,
) -> Result<WriteResult, String> {
    validate_id(&id)?;
    with_project(&state, |p| {
        let rel = scene_rel_path(&id);
        let path = p.abs(&rel);
        // Externe Änderung? Nur blockieren, wenn wir einen früheren Stand kennen.
        if !force && p.changed_externally(&rel) {
            return Ok(WriteResult::Conflict);
        }
        write_atomic(&path, &content).map_err(|e| format!("Szene schreiben ({id}): {e}"))?;
        if let Some(mt) = mtime_ms(&path) {
            p.known_mtimes.insert(rel, mt);
        }
        p.search_dirty = true;
        Ok(WriteResult::Ok)
    })
}

// ---------------------------------------------------------------------------
// Commands: Binder-Mutationen (Rust ist Owner von project.json)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_node(
    parent_id: Option<String>,
    kind: NodeKind,
    title: String,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    with_binder(&state, |p| {
        let id = make_id(&title);
        if kind == NodeKind::Scene {
            fs::write(p.abs(&scene_rel_path(&id)), "")
                .map_err(|e| format!("Szenendatei anlegen: {e}"))?;
            let rel = scene_rel_path(&id);
            if let Some(mt) = mtime_ms(&p.abs(&rel)) {
                p.known_mtimes.insert(rel, mt);
            }
        }
        let node = BinderNode::new(id, kind, title);
        match parent_id {
            Some(pid) => find_node_mut(&mut p.meta.binder, &pid)
                .ok_or(format!("Parent nicht gefunden: {pid}"))?
                .children
                .push(node),
            None => p.meta.binder.push(node),
        }
        p.write_meta()?;
        Ok(p.info())
    })
}

#[tauri::command]
pub fn rename_node(
    id: String,
    title: String,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    with_binder(&state, |p| {
        find_node_mut(&mut p.meta.binder, &id)
            .ok_or(format!("Node nicht gefunden: {id}"))?
            .title = title;
        p.write_meta()?;
        Ok(p.info())
    })
}

#[tauri::command]
pub fn move_node(
    id: String,
    new_parent_id: Option<String>,
    index: usize,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    with_binder(&state, |p| {
        if let Some(pid) = &new_parent_id {
            if *pid == id || is_descendant(&p.meta.binder, &id, pid) {
                return Err("Node kann nicht in sich selbst verschoben werden".into());
            }
        }
        let node =
            remove_node(&mut p.meta.binder, &id).ok_or(format!("Node nicht gefunden: {id}"))?;
        let target = match &new_parent_id {
            Some(pid) => {
                &mut find_node_mut(&mut p.meta.binder, pid)
                    .ok_or(format!("Parent nicht gefunden: {pid}"))?
                    .children
            }
            None => &mut p.meta.binder,
        };
        target.insert(index.min(target.len()), node);
        p.write_meta()?;
        Ok(p.info())
    })
}

/// Teil-Update der Szenen-/Kapitel-Metadaten. Nicht übergebene Felder bleiben
/// unverändert; `color: ""` löscht die Farbe.
#[tauri::command]
pub fn update_node_meta(
    id: String,
    synopsis: Option<String>,
    status: Option<String>,
    color: Option<String>,
    tags: Option<Vec<String>>,
    image: Option<String>,
    state: tauri::State<AppState>,
) -> Result<ProjectInfo, String> {
    with_binder(&state, |p| {
        let node = find_node_mut(&mut p.meta.binder, &id)
            .ok_or(format!("Node nicht gefunden: {id}"))?;
        if let Some(s) = synopsis {
            node.synopsis = s;
        }
        if let Some(img) = image {
            if !img.is_empty() && (!img.starts_with("images/") || img.contains("..")) {
                return Err(format!("Ungültiger Bildpfad: {img}"));
            }
            node.image = if img.is_empty() { None } else { Some(img) };
        }
        if let Some(s) = status {
            if !["draft", "revision", "done"].contains(&s.as_str()) {
                return Err(format!("Unbekannter Status: {s}"));
            }
            node.status = s;
        }
        if let Some(c) = color {
            node.color = if c.is_empty() { None } else { Some(c) };
        }
        if let Some(t) = tags {
            node.tags = t;
        }
        p.write_meta()?;
        Ok(p.info())
    })
}

/// Dupliziert einen Node samt Unterbaum. Die Kopie landet direkt hinter dem
/// Original; alle Szenendateien werden unter den neuen IDs mitkopiert.
#[tauri::command]
pub fn duplicate_node(id: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    validate_id(&id)?;
    with_binder(&state, |p| {
        // Erst klonen, dann den Lesezugriff auf den Baum wieder freigeben.
        let (clone, scene_copies) = {
            let source =
                find_node(&p.meta.binder, &id).ok_or(format!("Node nicht gefunden: {id}"))?;
            let mut scene_copies = Vec::new();
            let mut clone = clone_subtree(source, &mut scene_copies);
            clone.title = format!("{} (Kopie)", source.title);
            (clone, scene_copies)
        };

        for (old_id, new_id) in &scene_copies {
            let rel = scene_rel_path(new_id);
            let src = p.abs(&scene_rel_path(old_id));
            if src.exists() {
                fs::copy(&src, p.abs(&rel))
                    .map_err(|e| format!("Szene kopieren ({old_id}): {e}"))?;
            } else {
                fs::write(p.abs(&rel), "").map_err(|e| format!("Szenendatei anlegen: {e}"))?;
            }
            p.note_mtime(&rel);
        }

        insert_after(&mut p.meta.binder, &id, clone)
            .map_err(|_| format!("Node nicht gefunden: {id}"))?;
        p.write_meta()?;
        p.search_dirty = true;
        Ok(p.info())
    })
}

/// Löscht einen Node; die Dokumenttexte wandern in `.trash/`, und der Knoten
/// samt Unterbaum und Platz im Baum kommt in den Papierkorb-Index — sonst
/// ließe sich später nur die Datei zurückholen, nicht der Eintrag.
#[tauri::command]
pub fn delete_node(id: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    with_binder(&state, |p| {
        let (parent_id, index) = parent_and_index(&p.meta.binder, &id)
            .ok_or(format!("Node nicht gefunden: {id}"))?;
        let node =
            remove_node(&mut p.meta.binder, &id).ok_or(format!("Node nicht gefunden: {id}"))?;
        let mut scene_ids = Vec::new();
        collect_scene_ids(&node, &mut scene_ids);
        let mut files = Vec::new();
        for sid in scene_ids {
            if let Some(f) = trash::move_to_trash(p, &scene_rel_path(&sid))? {
                files.push(f);
            }
        }
        trash::record(
            p,
            trash::TrashItem {
                key: trash::new_key(),
                kind: match node.kind {
                    NodeKind::Chapter => "chapter".into(),
                    NodeKind::Scene => "scene".into(),
                },
                id: node.id.clone(),
                title: node.title.clone(),
                deleted_at: trash::now_ms(),
                files,
                node: Some(node),
                parent_id,
                index,
            },
        )?;
        p.write_meta()?;
        Ok(p.info())
    })
}

/// Elternordner und Platz eines Knotens — der Papierkorb merkt sich beides,
/// damit Wiederherstellen den Eintrag dorthin zurücklegt, wo er stand.
fn parent_and_index(
    nodes: &[BinderNode],
    id: &str,
) -> Option<(Option<String>, usize)> {
    if let Some(i) = nodes.iter().position(|n| n.id == id) {
        return Some((None, i));
    }
    for n in nodes {
        if let Some(i) = n.children.iter().position(|c| c.id == id) {
            return Some((Some(n.id.clone()), i));
        }
        if let Some(found) = parent_and_index(&n.children, id) {
            return Some(found);
        }
    }
    None
}

/// Legt einen Knoten aus dem Papierkorb zurück. Fehlt der ursprüngliche
/// Ordner, kommt er auf die oberste Ebene — lieber am falschen Platz als gar
/// nicht zurück.
pub(crate) fn restore_binder_node(
    p: &mut OpenProject,
    node: BinderNode,
    parent_id: Option<&str>,
    index: usize,
) -> Result<(), String> {
    let siblings = match parent_id.and_then(|pid| find_node_mut(&mut p.meta.binder, pid)) {
        Some(parent) => &mut parent.children,
        None => &mut p.meta.binder,
    };
    siblings.insert(index.min(siblings.len()), node);
    p.write_meta()
}

// ---------------------------------------------------------------------------
// Commands: Externe Änderungen
// ---------------------------------------------------------------------------

/// Vergleicht mtimes aller bekannten Dateien mit dem letzten bekannten Stand.
/// Aufruf bei Fenster-Fokus. Rückgabe: projektrelative Pfade mit Abweichung.
#[tauri::command]
pub fn check_external_changes(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    with_project(&state, |p| {
        let changed = p
            .known_mtimes
            .iter()
            .filter(|(rel, known)| mtime_ms(&p.abs(rel)) != Some(**known))
            .map(|(rel, _)| rel.clone())
            .collect();
        Ok(changed)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn scene(id: &str) -> BinderNode {
        BinderNode::new(id.into(), NodeKind::Scene, id.into())
    }

    fn open_test_project(binder: Vec<BinderNode>) -> OpenProject {
        let root = std::env::temp_dir().join(format!("distelfink-project-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("manuscript")).unwrap();
        let mut p = OpenProject {
            root,
            meta: ProjectMeta {
                format_version: FORMAT_VERSION,
                title: "Test".into(),
                author: String::new(),
                created: String::new(),
                binder,
            },
            known_mtimes: HashMap::new(),
            search_dirty: false,
        };
        p.write_meta().unwrap();
        p.snapshot_mtimes();
        p
    }

    /// Schreibt project.json wie ein Sync-Client von außen — mit sicher
    /// abweichender mtime, auch wenn der Test schneller ist als die Uhr.
    fn write_externally(p: &OpenProject, meta: &ProjectMeta) {
        let path = p.abs(PROJECT_FILE);
        fs::write(&path, serde_json::to_string(meta).unwrap()).unwrap();
        let later = SystemTime::now() + Duration::from_secs(5);
        fs::File::options().write(true).open(&path).unwrap().set_modified(later).unwrap();
    }

    #[test]
    fn binder_aenderung_behaelt_extern_angelegte_szenen() {
        let mut p = open_test_project(vec![scene("a-111111")]);
        let mut external = p.meta.clone();
        external.binder.push(scene("b-222222"));
        write_externally(&p, &external);

        p.refresh_meta().unwrap();
        find_node_mut(&mut p.meta.binder, "a-111111").unwrap().title = "Neu".into();
        p.write_meta().unwrap();

        let on_disk = read_meta(&p.root).unwrap();
        assert_eq!(on_disk.binder.len(), 2);
        assert_eq!(on_disk.binder[0].title, "Neu");
        assert!(!p.changed_externally(PROJECT_FILE));
        let _ = fs::remove_dir_all(&p.root);
    }

    #[test]
    fn unlesbare_projektdatei_bricht_die_aenderung_ab() {
        let mut p = open_test_project(vec![scene("a-111111")]);
        let path = p.abs(PROJECT_FILE);
        fs::write(&path, "{ halb geschrieben").unwrap();
        let later = SystemTime::now() + Duration::from_secs(5);
        fs::File::options().write(true).open(&path).unwrap().set_modified(later).unwrap();

        assert!(p.refresh_meta().is_err());
        // Nichts überschrieben — der Sync kann die Datei noch fertig schreiben.
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ halb geschrieben");
        let _ = fs::remove_dir_all(&p.root);
    }
}
