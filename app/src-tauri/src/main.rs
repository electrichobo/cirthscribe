#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Kolbítar shell. The Rust side owns the canonical document (the working
//! store); the web UI is an editing projection that submits versioned
//! batches. Pagination and PDF are computed here from the canonical store,
//! never from the WebView's DOM.
//!
//! Project files: a project is a `.cirth` file anywhere on disk (the app's
//! library folder, or any folder via Open / Save As). Each open file has a
//! working store in the app's data folder, keyed by the file's path, which
//! is the crash-recovery journal. Writing the file is conflict-safe: if the
//! file changed outside Kolbítar since we last read or wrote it, our
//! version goes to a "(conflict ...)" copy beside it and the other version
//! is left untouched.

use cirth_core::fixtures::Fixture;
use cirth_core::fsutil::FileStamp;
use cirth_core::layout::{self, PageMap, Profile};
use cirth_core::model::{Beat, Document};
use cirth_core::ops::{Ack, Batch};
use cirth_core::store::{Store, StoreError};
use cirth_core::revisions::{self, RevisionSet};
use cirth_core::{backup, fontcheck, pdf};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Manager, State};

struct Session {
    /// Key for this file's working store and backups (see `key_of`).
    key: String,
    store: Store,
    package: PathBuf,
    /// The file as we last read or wrote it; `None` until first written.
    stamp: Option<FileStamp>,
    /// Built on first use for the project's spelling language.
    speller: Option<cirth_core::spell::Speller>,
    /// Undo and redo for planning edits while this project is open (ADR 0003).
    planning: cirth_core::planning::PlanningHistory,
}

#[derive(Default)]
struct App {
    session: Mutex<Option<Session>>,
    data_dir: Mutex<PathBuf>,
    /// Free Writing workspace, opened on first use.
    free: Mutex<Option<cirth_core::freewrite::FreeStore>>,
}

#[derive(Serialize)]
struct Opened {
    /// Key of the project (library projects: the file name without extension).
    name: String,
    /// The project's title (Home shows it); `doc.title` is the open document's.
    project_title: String,
    /// The open document (an episode, or the project's first script).
    document_id: String,
    /// True for the project's first script (exports keep the project's file name).
    is_default: bool,
    doc: Document,
    beats: Vec<Beat>,
    recovered: bool,
    /// Upgraded from this older schema when opened.
    migrated_from: Option<i64>,
    /// Untouched copy of the older-format file, kept before upgrading.
    pre_migration_backup: Option<String>,
    saved_version: u64,
    work_path: String,
    package_path: String,
    open_ms: f64,
    /// What an import changed or could not keep (shown after opening).
    #[serde(default)]
    import_notes: Vec<String>,
}

fn fixture_source(name: &str) -> Result<&'static str, String> {
    Ok(match name {
        "long-120" => include_str!("../../../fixtures/long-120.json"),
        "page-boundaries" => include_str!("../../../fixtures/page-boundaries.json"),
        "unicode-marks" => include_str!("../../../fixtures/unicode-marks.json"),
        _ => return Err(format!("unknown fixture {name}")),
    })
}

fn err(e: StoreError) -> String {
    match e {
        StoreError::Stale { base, current } => format!("STALE:{base}:{current}"),
        other => other.to_string(),
    }
}

fn io_err(e: std::io::Error) -> String {
    e.to_string()
}

fn profile(name: &str) -> Profile {
    if name == "a4" { Profile::a4() } else { Profile::us_letter() }
}

// --- Paths and keys -----------------------------------------------------------

fn data_dir(app: &App) -> PathBuf {
    app.data_dir.lock().unwrap().clone()
}

fn library_dir(app: &App) -> PathBuf {
    data_dir(app).join("projects")
}

fn library_path(app: &App, name: &str) -> PathBuf {
    library_dir(app).join(format!("{name}.cirth"))
}

/// Absolute path for comparisons and display: the parent folder is
/// canonicalized (it exists even when the file does not yet), and the
/// Windows verbatim prefix (`\\?\`) is removed so paths read normally.
fn normalize(p: &Path) -> PathBuf {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let joined = match (abs.parent(), abs.file_name()) {
        (Some(dir), Some(name)) => std::fs::canonicalize(dir).map(|d| d.join(name)).unwrap_or(abs.clone()),
        _ => abs.clone(),
    };
    let s = joined.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        joined
    }
}

fn in_library(app: &App, pkg: &Path) -> bool {
    normalize(pkg).parent() == Some(normalize(&library_dir(app)).as_path())
}

/// Library projects keep their file name as key (unchanged since M0, so old
/// recovery files still match). Files elsewhere get `<name>-<path hash>` so
/// two `draft.cirth` in different folders never share recovery files.
fn key_of(app: &App, pkg: &Path) -> String {
    let stem = pkg.file_stem().unwrap_or_default().to_string_lossy().to_string();
    if in_library(app, pkg) {
        return stem;
    }
    let mut p = normalize(pkg).to_string_lossy().to_string();
    if cfg!(windows) {
        p = p.to_lowercase();
    }
    format!("{stem}-{:016x}", cirth_core::fsutil::fnv1a(p.as_bytes()))
}

fn work_path(app: &App, key: &str) -> PathBuf {
    data_dir(app).join("work").join(format!("{key}.work.db"))
}

/// Backup rules (see cirth_core::backup): keep 20, at most one per 10
/// minutes from autosave; an explicit Save always backs up a changed file.
fn backup_policy(app: &App) -> backup::BackupPolicy {
    backup::BackupPolicy { dir: data_dir(app).join("backups"), keep: 20, min_interval: std::time::Duration::from_secs(600) }
}

// --- Recent files ---------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct Recent {
    path: String,
    opened_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn recents_file(app: &App) -> PathBuf {
    data_dir(app).join("recent.json")
}

fn load_recents(app: &App) -> Vec<Recent> {
    std::fs::read(recents_file(app)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn store_recents(app: &App, list: &[Recent]) -> Result<(), String> {
    let path = recents_file(app);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(list).unwrap_or_default()).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &path).map_err(io_err)
}

/// Remember a file opened from outside the library (newest first, 30 kept).
fn remember(app: &App, pkg: &Path) -> Result<(), String> {
    if in_library(app, pkg) {
        return Ok(());
    }
    let path = normalize(pkg).display().to_string();
    let mut list: Vec<Recent> = load_recents(app).into_iter().filter(|r| r.path != path).collect();
    list.insert(0, Recent { path, opened_ms: now_ms() });
    list.truncate(30);
    store_recents(app, &list)
}

#[tauri::command]
async fn forget_recent(app: State<'_, App>, path: String) -> Result<(), String> {
    let list: Vec<Recent> = load_recents(&app).into_iter().filter(|r| r.path != path).collect();
    store_recents(&app, &list)
}

// --- Opening --------------------------------------------------------------------

fn opened(s: &Session, recovered: bool, migrated_from: Option<i64>, pre_migration_backup: Option<PathBuf>, t0: Instant) -> Result<Opened, String> {
    let document_id = s.store.current_document().map_err(err)?;
    Ok(Opened {
        name: s.key.clone(),
        project_title: s.store.load_document(&s.store.default_document().map_err(err)?).map_err(err)?.title,
        is_default: document_id == s.store.default_document().map_err(err)?,
        document_id,
        doc: s.store.load().map_err(err)?,
        beats: s.store.beats().map_err(err)?,
        recovered,
        migrated_from,
        import_notes: Vec::new(),
        pre_migration_backup: pre_migration_backup.map(|p| p.display().to_string()),
        saved_version: s.store.saved_version().map_err(err)?,
        work_path: s.store.path().display().to_string(),
        package_path: s.package.display().to_string(),
        open_ms: t0.elapsed().as_secs_f64() * 1e3,
    })
}

// --- Navigator (M3 step 3) --------------------------------------------------------

#[derive(Serialize)]
struct ProjectScene {
    document_id: String,
    document_title: String,
    scene_id: String,
    heading: String,
    /// Page, length in eighths and position in its own document (the overview map).
    page: String,
    eighths: u32,
    position: f64,
}

/// What the navigator needs besides the open script: scene labels and their
/// names, the speaking characters (this document or the whole project) and,
/// for the whole project, every document's scenes.
#[derive(Serialize)]
struct NavigatorInfo {
    labels: std::collections::HashMap<String, String>,
    label_names: Vec<(String, String)>,
    characters: Vec<cirth_core::navigator::CharacterStat>,
    project_scenes: Vec<ProjectScene>,
}

#[tauri::command]
async fn navigator_info(app: State<'_, App>, project: bool) -> Result<NavigatorInfo, String> {
    with_session(&app, |s| {
        let docs: Vec<(String, String, Vec<cirth_core::model::Block>)> = if project {
            s.store.all_documents().map_err(err)?
        } else {
            let id = s.store.current_document().map_err(err)?;
            let d = s.store.load().map_err(err)?;
            vec![(id, d.title, d.blocks)]
        };
        // A character entry's aliases count under its name.
        let mut names = std::collections::HashMap::new();
        for e in s.store.entities().map_err(err)?.into_iter().filter(|e| e.kind == "character") {
            for n in std::iter::once(&e.name).chain(e.aliases.iter()) {
                names.insert(n.trim().to_uppercase(), e.name.trim().to_uppercase());
            }
        }
        let characters = cirth_core::navigator::characters_named(&docs.iter().map(|(id, _, b)| (id.clone(), b.clone())).collect::<Vec<_>>(), &names);
        let project_scenes = if project {
            let mut out = Vec::new();
            for (id, title, blocks) in &docs {
                // Each document laid out on its own page size, for lengths and positions.
                let prof = if s.store.document_profile(id).map_err(err)? == "a4" { Profile::a4() } else { Profile::us_letter() };
                let map = layout::paginate(blocks, &prof, 0);
                let stats = cirth_core::navigator::scene_stats(blocks, &map);
                for (b, st) in blocks.iter().filter(|b| b.kind == cirth_core::model::BlockKind::Heading && b.scene_id.is_some()).zip(stats) {
                    out.push(ProjectScene { document_id: id.clone(), document_title: title.clone(), scene_id: st.scene_id, heading: b.text(), page: st.page, eighths: st.eighths, position: st.position });
                }
            }
            out
        } else {
            Vec::new()
        };
        Ok(NavigatorInfo { labels: s.store.scene_labels().map_err(err)?, label_names: s.store.label_names().map_err(err)?, characters, project_scenes })
    })
}

#[tauri::command]
async fn set_label_name(app: State<'_, App>, key: String, name: String) -> Result<(), String> {
    with_session(&app, |s| s.store.set_label_name(&key, &name).map_err(err))
}

// --- Project bible (M3 step 7) ----------------------------------------------------

#[derive(Serialize)]
struct BibleEntry {
    #[serde(flatten)]
    entity: cirth_core::bible::Entity,
    occurrences: Vec<cirth_core::bible::Evidence>,
}

/// Where a scene is, for showing evidence: its document and heading.
#[derive(Serialize)]
struct Place {
    document_id: String,
    document_title: String,
    heading: String,
}

#[derive(Serialize)]
struct BibleState {
    entries: Vec<BibleEntry>,
    candidates: Vec<cirth_core::bible::Candidate>,
    places: std::collections::HashMap<String, Place>,
}

fn bible_docs(s: &Session) -> Result<(Vec<(String, Vec<cirth_core::model::Block>)>, std::collections::HashMap<String, Place>), String> {
    let all = s.store.all_documents().map_err(err)?;
    let mut places = std::collections::HashMap::new();
    for (id, title, blocks) in &all {
        for b in blocks.iter().filter(|b| b.scene_id.is_some()) {
            places.insert(b.scene_id.clone().unwrap(), Place { document_id: id.clone(), document_title: title.clone(), heading: b.text() });
        }
    }
    Ok((all.into_iter().map(|(id, _, b)| (id, b)).collect(), places))
}

/// The bible as it stands: entries with their occurrences (refreshed from
/// every script), and candidates with their evidence.
#[tauri::command]
async fn bible_state(app: State<'_, App>) -> Result<BibleState, String> {
    with_session(&app, |s| {
        let (docs, places) = bible_docs(s)?;
        let entities = s.store.entities().map_err(err)?;
        let (candidates, mut occ) = cirth_core::bible::derive(&entities, &s.store.rejected().map_err(err)?, &docs);
        let entries = entities.into_iter().map(|e| BibleEntry { occurrences: occ.remove(&e.id).unwrap_or_default(), entity: e }).collect();
        Ok(BibleState { entries, candidates, places })
    })
}

/// What renaming an entry would change (cues or headings) and leave alone.
#[tauri::command]
async fn bible_rename_preview(app: State<'_, App>, id: String, from: String, to: String) -> Result<cirth_core::bible::RenamePlan, String> {
    with_session(&app, |s| {
        let e = s.store.entity(&id).map_err(err)?.ok_or("no such entry")?;
        let (docs, _) = bible_docs(s)?;
        Ok(cirth_core::bible::rename_plan(&e, &from, &to, &docs))
    })
}

/// Apply the rename the preview showed; refused if the script changed since.
/// The UI reloads the open script and updates the entry (a planning step).
#[tauri::command]
async fn bible_rename_apply(app: State<'_, App>, id: String, from: String, to: String, expect: usize) -> Result<usize, String> {
    with_session(&app, |s| {
        let e = s.store.entity(&id).map_err(err)?.ok_or("no such entry")?;
        let (docs, _) = bible_docs(s)?;
        let plan = cirth_core::bible::rename_plan(&e, &from, &to, &docs);
        if plan.changes.len() != expect {
            return Err("the script changed since the preview; preview the rename again".into());
        }
        s.store.apply_rename(&plan).map_err(err)?;
        Ok(plan.changes.len())
    })
}

// --- Story timeline (M3 step 8) ---------------------------------------------------

#[derive(Serialize)]
struct TimelineState {
    events: Vec<cirth_core::timeline::StoryEvent>,
    places: std::collections::HashMap<String, Place>,
    /// Events the scripts show out of story order (flashbacks).
    flashbacks: Vec<String>,
    /// The open script's scenes now, and in story order (for "apply to script order").
    current_order: Vec<String>,
    story_order: Vec<String>,
}

#[tauri::command]
async fn timeline_state(app: State<'_, App>) -> Result<TimelineState, String> {
    with_session(&app, |s| {
        let (docs, places) = bible_docs(s)?;
        let events = s.store.story_events().map_err(err)?;
        let mut index = std::collections::HashMap::new();
        for (_, blocks) in &docs {
            for b in blocks.iter().filter(|b| b.scene_id.is_some()) {
                let n = index.len();
                index.insert(b.scene_id.clone().unwrap(), n);
            }
        }
        let current_order: Vec<String> = s.store.load().map_err(err)?.scenes().into_iter().map(|x| x.scene_id).collect();
        let story_order = cirth_core::timeline::chronological_order(&events, &current_order);
        Ok(TimelineState { flashbacks: cirth_core::timeline::flashbacks(&events, &index), events, places, current_order, story_order })
    })
}

// --- Episodes and series (M3 step 2) -------------------------------------------

/// The project's folders and documents, in order (cirth_core::store::TreeItem).
#[tauri::command]
async fn project_tree(app: State<'_, App>) -> Result<Vec<cirth_core::store::TreeItem>, String> {
    with_session(&app, |s| s.store.project_tree().map_err(err))
}

/// Open another document of the open project: the editor, scene list,
/// board, numbering, revisions and exports follow it. The UI saves first.
/// The planning history belongs to the document it was made in.
#[tauri::command]
async fn open_document(app: State<'_, App>, id: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    with_session(&app, |s| {
        s.store.set_current_document(&id).map_err(err)?;
        s.planning = Default::default();
        opened(s, false, None, None, t0)
    })
}

#[tauri::command]
async fn create_folder(app: State<'_, App>, title: String, parent: Option<String>) -> Result<String, String> {
    with_session(&app, |s| s.store.create_folder(&title, parent.as_deref()).map_err(err))
}

#[tauri::command]
async fn create_episode(app: State<'_, App>, title: String, folder: Option<String>) -> Result<String, String> {
    with_session(&app, |s| s.store.create_episode(&title, folder.as_deref()).map_err(err))
}

#[tauri::command]
async fn rename_item(app: State<'_, App>, id: String, title: String) -> Result<(), String> {
    with_session(&app, |s| s.store.rename_item(&id, &title).map_err(err))
}

#[tauri::command]
async fn move_item(app: State<'_, App>, id: String, parent: Option<String>, index: usize) -> Result<(), String> {
    with_session(&app, |s| s.store.move_item(&id, parent.as_deref(), index).map_err(err))
}

/// Open an existing project file, recovering unsaved working-store commits
/// and upgrading older formats (with a kept copy).
fn open_file(app: &App, pkg: &Path, t0: Instant) -> Result<Opened, String> {
    let mut guard = app.session.lock().unwrap();
    *guard = None; // release any lock on a previous project
    if !pkg.exists() {
        return Err(format!("file not found: {}", pkg.display()));
    }
    let key = key_of(app, pkg);
    let work = work_path(app, &key);
    std::fs::create_dir_all(work.parent().unwrap()).map_err(io_err)?;
    let o = Store::open_package(pkg, &work, Some(&backup_policy(app).dir)).map_err(err)?;
    let s = Session { key, store: o.store, package: normalize(pkg), stamp: Some(FileStamp::of(pkg).map_err(io_err)?), speller: None, planning: Default::default() };
    let out = opened(&s, o.recovered, o.migrated_from, o.pre_migration_backup, t0)?;
    remember(app, &s.package)?;
    *guard = Some(s);
    Ok(out)
}

#[tauri::command]
async fn open_path(app: State<'_, App>, path: String) -> Result<Opened, String> {
    open_file(&app, Path::new(&path), Instant::now())
}

/// Open a project from the library by name.
#[tauri::command]
async fn open_project(app: State<'_, App>, name: String) -> Result<Opened, String> {
    open_file(&app, &library_path(&app, &name), Instant::now())
}

/// Start a new project file from a fresh working store and write it.
fn start_new(app: &App, pkg: PathBuf, doc: &Document, beats: &[Beat], t0: Instant) -> Result<Opened, String> {
    let mut guard = app.session.lock().unwrap();
    *guard = None;
    let key = key_of(app, &pkg);
    let work = work_path(app, &key);
    std::fs::create_dir_all(work.parent().unwrap()).map_err(io_err)?;
    std::fs::create_dir_all(pkg.parent().unwrap()).map_err(io_err)?;
    cirth_core::store::remove_store_files(&work).map_err(err)?;
    let mut store = Store::open(&work).map_err(err)?;
    store.seed(doc).map_err(err)?;
    for b in beats {
        store.put_beat(b).map_err(err)?;
    }
    store.save_package(&pkg).map_err(err)?;
    let s = Session { key, store, stamp: Some(FileStamp::of(&pkg).map_err(io_err)?), package: normalize(&pkg), speller: None, planning: Default::default() };
    let out = opened(&s, false, None, None, t0)?;
    *guard = Some(s);
    Ok(out)
}

/// Open a sample. If its file exists it is reopened (with recovery);
/// otherwise, or with `reset`, it is seeded from the fixture.
#[tauri::command]
async fn open_fixture(app: State<'_, App>, name: String, reset: bool) -> Result<Opened, String> {
    let t0 = Instant::now();
    let pkg = library_path(&app, &name);
    if pkg.exists() && !reset {
        return open_file(&app, &pkg, t0);
    }
    let fx: Fixture = serde_json::from_str(fixture_source(&name)?).map_err(|e| e.to_string())?;
    let doc = fx.to_document()?;
    // Starter beats for the first scenes so the board has something to show.
    let beats: Vec<Beat> = doc
        .scenes()
        .iter()
        .take(12)
        .enumerate()
        .map(|(i, sc)| Beat { id: cirth_core::model::new_id(), logline: String::new(), summary: format!("Beat {}: (summary is authored planning text)", i + 1), scene_id: Some(sc.scene_id.clone()), pos: i as f64, ..Default::default() })
        .collect();
    start_new(&app, pkg, &doc, &beats, t0)
}

const SAMPLES: [&str; 3] = ["unicode-marks", "page-boundaries", "long-120"];

fn slug(title: &str) -> String {
    let s: String = title.trim().chars().map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "untitled".into() } else { s.chars().take(60).collect() }
}

/// New empty project in the library, starting with one scene heading. Never
/// overwrites: a name already in the library gets a numeric suffix.
#[tauri::command]
async fn create_project(app: State<'_, App>, title: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let title = if title.trim().is_empty() { "Untitled".to_string() } else { title.trim().to_string() };
    let name = unused_library_name(&app, &title);
    let doc = Document { title, version: 0, blocks: vec![cirth_core::model::Block::new(cirth_core::model::BlockKind::Heading, "")] };
    start_new(&app, library_path(&app, &name), &doc, &[], t0)
}

/// A library file name for `title` that no project or sample uses yet.
fn unused_library_name(app: &App, title: &str) -> String {
    let base = slug(title);
    let mut name = base.clone();
    let mut n = 2;
    while library_path(app, &name).exists() || SAMPLES.contains(&name.as_str()) {
        name = format!("{base}-{n}");
        n += 1;
    }
    name
}

/// File > Import Fountain…: a new library project from a .fountain file
/// (the file itself is only read). The import report comes back with it.
#[tauri::command]
async fn import_fountain(app: State<'_, App>, path: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let bytes = std::fs::read(&path).map_err(io_err)?;
    let text = String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text. Save it as UTF-8 in your editor and try again.".to_string())?;
    let stem = Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Imported".into());
    let r = cirth_core::fountain::import(&text, &stem);
    let name = unused_library_name(&app, &r.document.title);
    let mut out = start_new(&app, library_path(&app, &name), &r.document, &[], t0)?;
    if !r.title_page.is_empty() || !r.scene_numbers.is_empty() {
        with_session(&app, |s| {
            let doc = s.store.current_document().map_err(err)?;
            if !r.title_page.is_empty() {
                s.store.set_title_page(&doc, &r.title_page).map_err(err)?;
            }
            if !r.scene_numbers.is_empty() {
                s.store.lock_scene_numbers_with(&doc, &r.scene_numbers).map_err(err)?;
            }
            s.store.save_package(&s.package).map_err(err)?;
            Ok(())
        })?;
    }
    out.import_notes = r.notes;
    Ok(out)
}

/// File > Import Final Draft…: a new library project from a .fdx file
/// (the file itself is only read). The import report comes back with it.
#[tauri::command]
async fn import_fdx(app: State<'_, App>, path: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let bytes = std::fs::read(&path).map_err(io_err)?;
    let text = String::from_utf8(bytes).map_err(|_| "This .fdx file is not UTF-8 XML, so it cannot be read.".to_string())?;
    let stem = Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Imported".into());
    let r = cirth_core::fdx::import(&text, &stem)?;
    let name = unused_library_name(&app, &r.document.title);
    let mut out = start_new(&app, library_path(&app, &name), &r.document, &[], t0)?;
    if !r.title_page.is_empty() || !r.scene_numbers.is_empty() {
        with_session(&app, |s| {
            let doc = s.store.current_document().map_err(err)?;
            if !r.title_page.is_empty() {
                s.store.set_title_page(&doc, &r.title_page).map_err(err)?;
            }
            if !r.scene_numbers.is_empty() {
                s.store.lock_scene_numbers_with(&doc, &r.scene_numbers).map_err(err)?;
            }
            s.store.save_package(&s.package).map_err(err)?;
            Ok(())
        })?;
    }
    out.import_notes = r.notes;
    Ok(out)
}

/// File > Export > Final Draft…: the current document and its title page.
#[tauri::command]
async fn export_fdx(app: State<'_, App>, path: String) -> Result<FountainExported, String> {
    let (doc, tp) = with_session(&app, |s| Ok((s.store.load().map_err(err)?, s.store.title_page(&s.store.current_document().map_err(err)?).map_err(err)?)))?;
    let numbers = with_session(&app, |s| s.store.scene_numbers(&s.store.current_document().map_err(err)?).map_err(err))?;
    let out = cirth_core::fdx::export(&doc.blocks, &tp, &numbers);
    let target = normalize(Path::new(&path));
    let tmp = target.with_extension("fdx.tmp");
    std::fs::write(&tmp, &out.text).map_err(io_err)?;
    cirth_core::fsutil::sync_file(&tmp).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &target).map_err(io_err)?;
    Ok(FountainExported { path: target.display().to_string(), notes: out.notes })
}

/// File > Export > Word (.docx)… / Rich Text (.rtf)… / Web Page (.html)…:
/// the current document as printed (scene numbers, omitted scenes), its
/// title page, header and footer, in this document's page size.
#[tauri::command]
async fn export_document(app: State<'_, App>, format: String, path: String) -> Result<FountainExported, String> {
    let (doc, tp, numbers, furniture, stored) = with_session(&app, |s| {
        let main = s.store.current_document().map_err(err)?;
        Ok((
            s.store.load().map_err(err)?,
            s.store.title_page(&main).map_err(err)?,
            s.store.scene_numbers(&main).map_err(err)?,
            page_furniture_of(s)?,
            s.store.document_profile(&main).map_err(err)?,
        ))
    })?;
    let prof = profile(ui_profile(&stored));
    let opts = cirth_core::printdoc::DocOptions {
        title: if tp.is_empty() { doc.title.clone() } else { tp.title.lines().next().unwrap_or("").trim().to_string() },
        author: tp.authors.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(", "),
        header: pdf::expand_tokens(&furniture.header, &tp),
        footer: pdf::expand_tokens(&furniture.footer, &tp),
    };
    let out = match format.as_str() {
        "docx" => cirth_core::docx::export(&doc.blocks, &prof, &numbers, Some(&tp), &opts)?,
        "rtf" => cirth_core::rtf::export(&doc.blocks, &prof, &numbers, Some(&tp), &opts),
        "html" => cirth_core::html::export(&doc.blocks, &prof, &numbers, Some(&tp), &opts),
        other => return Err(format!("unknown document format {other}")),
    };
    let target = normalize(Path::new(&path));
    let tmp = target.with_extension(format!("{format}.tmp"));
    std::fs::write(&tmp, &out.bytes).map_err(io_err)?;
    cirth_core::fsutil::sync_file(&tmp).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &target).map_err(io_err)?;
    Ok(FountainExported { path: target.display().to_string(), notes: out.notes })
}

#[derive(Serialize)]
struct FountainExported {
    path: String,
    notes: Vec<String>,
}

/// File > Export > Fountain…: the current document and its title page.
#[tauri::command]
async fn export_fountain(app: State<'_, App>, path: String) -> Result<FountainExported, String> {
    let (doc, tp) = with_session(&app, |s| Ok((s.store.load().map_err(err)?, s.store.title_page(&s.store.current_document().map_err(err)?).map_err(err)?)))?;
    let numbers = with_session(&app, |s| s.store.scene_numbers(&s.store.current_document().map_err(err)?).map_err(err))?;
    let out = cirth_core::fountain::export(&doc.blocks, &tp, &numbers);
    let target = normalize(Path::new(&path));
    let tmp = target.with_extension("fountain.tmp");
    std::fs::write(&tmp, &out.text).map_err(io_err)?;
    cirth_core::fsutil::sync_file(&tmp).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &target).map_err(io_err)?;
    Ok(FountainExported { path: target.display().to_string(), notes: out.notes })
}

/// Release the project (and its lock). The UI saves before closing.
#[tauri::command]
async fn close_project(app: State<'_, App>) -> Result<(), String> {
    *app.session.lock().unwrap() = None;
    Ok(())
}

// --- Library listing --------------------------------------------------------------

#[derive(Serialize)]
struct ProjectEntry {
    /// Key: for library projects the file name without extension.
    name: String,
    path: String,
    /// "library" or "elsewhere" (opened or saved outside the library).
    location: &'static str,
    title: String,
    sample: bool,
    modified_ms: u64,
    blocks: u64,
    scenes: u64,
    saved_version: u64,
    /// The working store holds commits newer than the last file save.
    recoverable: bool,
    backups: usize,
    /// Schema of the file; older ones are upgraded (with a kept copy) when opened.
    schema: i64,
    older_format: bool,
    /// Open in this window right now.
    open: bool,
    /// A remembered file that no longer exists at its path.
    missing: bool,
    error: Option<String>,
}

fn entry_for(app: &App, path: &Path, location: &'static str, current: Option<&Path>) -> ProjectEntry {
    let key = key_of(app, path);
    let open = current == Some(normalize(path).as_path());
    let mut e = ProjectEntry {
        sample: location == "library" && SAMPLES.contains(&key.as_str()),
        name: key.clone(),
        path: path.display().to_string(),
        location,
        title: path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
        modified_ms: 0,
        blocks: 0,
        scenes: 0,
        saved_version: 0,
        recoverable: false,
        backups: backup::list(&backup_policy(app).dir, &key).len(),
        schema: 0,
        older_format: false,
        open,
        missing: !path.exists(),
        error: None,
    };
    if e.missing {
        return e;
    }
    e.modified_ms = std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    match Store::inspect(path) {
        Ok(info) => {
            e.title = info.title;
            e.schema = info.schema;
            e.older_format = info.schema < cirth_core::store::SCHEMA_VERSION;
            e.blocks = info.blocks;
            e.scenes = info.scenes;
            e.saved_version = info.saved_version;
            let work = work_path(app, &key);
            if !open && work.exists() {
                if let Ok(w) = Store::inspect(&work) {
                    e.recoverable = w.project_id == info.project_id && w.version > w.saved_version;
                    if e.recoverable {
                        e.blocks = w.blocks;
                        e.scenes = w.scenes;
                    }
                }
            }
        }
        Err(err) => e.error = Some(err.to_string()),
    }
    e
}

/// Library projects plus recently opened files elsewhere, newest first.
#[tauri::command]
async fn list_projects(app: State<'_, App>) -> Result<Vec<ProjectEntry>, String> {
    let dir = library_dir(&app);
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    let current = app.session.lock().unwrap().as_ref().map(|s| s.package.clone());
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(io_err)?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("cirth") {
            out.push(entry_for(&app, &path, "library", current.as_deref()));
        }
    }
    for r in load_recents(&app) {
        let p = PathBuf::from(&r.path);
        if !in_library(&app, &p) {
            let mut e = entry_for(&app, &p, "elsewhere", current.as_deref());
            if e.missing {
                e.modified_ms = r.opened_ms;
            }
            out.push(e);
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

// --- Editing ------------------------------------------------------------------------

fn with_session<T>(app: &App, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let mut guard = app.session.lock().unwrap();
    let s = guard.as_mut().ok_or("no project open")?;
    f(s)
}

#[tauri::command]
async fn apply_batch(app: State<'_, App>, batch: Batch) -> Result<Ack, String> {
    with_session(&app, |s| {
        let ack = s.store.apply(&batch).map_err(err)?;
        // While scene numbers are locked, scenes added by this edit get A/B numbers.
        let main = s.store.current_document().map_err(err)?;
        s.store.number_new_scenes(&main).map_err(err)?;
        Ok(ack)
    })
}

/// Revision sets of this document, which is active, whether revision mode is
/// on, and what the next set would be called.
#[derive(Serialize)]
struct RevisionState {
    sets: Vec<RevisionSet>,
    /// Tagged passages per set (same order as `sets`).
    passages: Vec<usize>,
    active: Option<String>,
    mode: bool,
    next_colour: String,
    next_label: String,
}

fn revision_state_of(s: &Session) -> Result<RevisionState, String> {
    let main = s.store.current_document().map_err(err)?;
    let sets = s.store.revision_sets(&main).map_err(err)?;
    let blocks = s.store.load().map_err(err)?.blocks;
    let (next_colour, next_label) = revisions::next_set(&sets);
    Ok(RevisionState {
        passages: sets.iter().map(|set| revisions::passages(&blocks, &set.id)).collect(),
        active: s.store.active_revision(&main).map_err(err)?.map(|a| a.id),
        mode: s.store.revision_mode(&main).map_err(err)?,
        sets,
        next_colour,
        next_label,
    })
}

#[tauri::command]
async fn revision_state(app: State<'_, App>) -> Result<RevisionState, String> {
    with_session(&app, |s| revision_state_of(s))
}

/// Format > Revisions: "put" adds a set (which becomes active) or changes
/// one; "delete" removes an unused set; "activate" picks the set changes go
/// into (`id` None = none); "mode" turns revision mode on or off.
#[tauri::command]
async fn revision_command(app: State<'_, App>, action: String, set: Option<RevisionSet>, id: Option<String>, on: Option<bool>) -> Result<RevisionState, String> {
    with_session(&app, |s| {
        let main = s.store.current_document().map_err(err)?;
        match action.as_str() {
            "put" => {
                let set = set.ok_or("no revision set")?;
                let new = !s.store.revision_sets(&main).map_err(err)?.iter().any(|x| x.id == set.id);
                s.store.put_revision_set(&main, &set).map_err(err)?;
                if new {
                    s.store.set_active_revision(&main, Some(&set.id)).map_err(err)?;
                }
            }
            "delete" => s.store.delete_revision_set(&main, &id.ok_or("no revision set")?).map_err(err)?,
            "activate" => s.store.set_active_revision(&main, id.as_deref()).map_err(err)?,
            "mode" => s.store.set_revision_mode(&main, on.unwrap_or(false)).map_err(err)?,
            other => return Err(format!("unknown revision action {other}")),
        }
        revision_state_of(s)
    })
}

/// Format > Locked Pages: "lock" records the pages as laid out now (with
/// scene numbers and omitted scenes) as the baseline; "unlock" drops it.
/// Returns the number of locked pages.
#[tauri::command]
async fn page_lock_command(app: State<'_, App>, action: String, profile_name: String) -> Result<usize, String> {
    match action.as_str() {
        "lock" => {
            let (p, _) = paginate_current(&app, &profile_name)?;
            with_session(&app, |s| s.store.lock_pages(&s.store.current_document().map_err(err)?, &p.map).map_err(err))
        }
        "unlock" => with_session(&app, |s| s.store.unlock_pages(&s.store.current_document().map_err(err)?).map(|_| 0).map_err(err)),
        other => Err(format!("unknown page lock action {other}")),
    }
}

/// Format > Scene Numbers: lock (number 1..N), unlock, omit or restore.
#[tauri::command]
async fn scene_numbers_command(app: State<'_, App>, action: String, scene_id: Option<String>) -> Result<usize, String> {
    with_session(&app, |s| {
        let main = s.store.current_document().map_err(err)?;
        match action.as_str() {
            "lock" => s.store.lock_scene_numbers(&main).map_err(err),
            "unlock" => s.store.unlock_scene_numbers(&main).map(|_| 0).map_err(err),
            "omit" | "restore" => {
                let id = scene_id.ok_or("no scene")?;
                s.store.set_scene_omitted(&main, &id, action == "omit").map(|_| 0).map_err(err)
            }
            other => Err(format!("unknown scene number action {other}")),
        }
    })
}

#[tauri::command]
async fn load_document(app: State<'_, App>) -> Result<Document, String> {
    with_session(&app, |s| s.store.load().map_err(err))
}

/// The board's data after a planning command (ADR 0003): cards, the planning
/// version the next command must be based on, and what undo and redo can do.
#[derive(Serialize)]
struct PlanningState {
    version: u64,
    beats: Vec<Beat>,
    structural: bool,
    can_undo: bool,
    can_redo: bool,
    /// False when undo or redo had nothing to do.
    done: bool,
}

fn planning_state(s: &Session, done: bool) -> Result<PlanningState, String> {
    let doc = s.store.current_document().map_err(err)?;
    Ok(PlanningState {
        version: s.store.planning_version().map_err(err)?,
        beats: s.store.beats().map_err(err)?,
        structural: s.store.board_structural(&doc).map_err(err)?,
        can_undo: s.planning.can_undo(),
        can_redo: s.planning.can_redo(),
        done,
    })
}

#[tauri::command]
async fn planning_state_now(app: State<'_, App>) -> Result<PlanningState, String> {
    with_session(&app, |s| planning_state(s, true))
}

/// A card created, changed or deleted, based on planning version `base`. A
/// stale base is refused ("stale change: …"); the board then reloads.
#[tauri::command]
async fn planning_command(app: State<'_, App>, op: cirth_core::planning::PlanningOp, base: u64) -> Result<PlanningState, String> {
    with_session(&app, |s| {
        s.planning.apply(&s.store, op, base).map_err(err)?;
        planning_state(s, true)
    })
}

#[tauri::command]
async fn planning_undo(app: State<'_, App>, redo: bool) -> Result<PlanningState, String> {
    with_session(&app, |s| {
        let done = if redo { s.planning.redo(&s.store) } else { s.planning.undo(&s.store) }.map_err(err)?.is_some();
        planning_state(s, done)
    })
}

#[tauri::command]
async fn set_board_structural(app: State<'_, App>, on: bool) -> Result<(), String> {
    with_session(&app, |s| {
        let doc = s.store.current_document().map_err(err)?;
        s.store.set_board_structural(&doc, on).map_err(err)
    })
}

// --- Saving -------------------------------------------------------------------------

#[derive(Serialize)]
struct Saved {
    version: u64,
    backups: usize,
    /// Where the project now lives (changes after Save As or a conflict).
    path: String,
    name: String,
    /// The file had changed outside Kolbítar: our version was written here
    /// instead, and the other version was left untouched at `other`.
    conflict: Option<String>,
    other: Option<String>,
    /// The file was missing (moved or deleted outside) and was written again.
    recreated: bool,
}

/// Point the session at another file: move the working store to that file's
/// key so crash recovery follows the project.
fn rekey(app: &App, s: &mut Session, new_pkg: &Path) -> Result<(), String> {
    let new_key = key_of(app, new_pkg);
    if new_key != s.key {
        s.store.relocate(&work_path(app, &new_key)).map_err(err)?;
        s.key = new_key;
    }
    s.package = normalize(new_pkg);
    Ok(())
}

/// Unique "<name> (conflict YYYY-MM-DD HHMM).cirth" beside `pkg`.
fn conflict_path(pkg: &Path) -> PathBuf {
    let stem = pkg.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let dir = pkg.parent().unwrap_or(Path::new("."));
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let t = backup::readable_utc(secs);
    let mut p = dir.join(format!("{stem} (conflict {t}).cirth"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} (conflict {t} {n}).cirth"));
        n += 1;
    }
    p
}

fn write_session(app: &App, s: &mut Session, explicit: bool) -> Result<Saved, String> {
    let policy = backup_policy(app);
    let (mut conflict, mut other, mut recreated) = (None, None, false);
    if let Some(stamp) = &s.stamp {
        if !s.package.exists() {
            recreated = true;
        } else if stamp.changed(&s.package).map_err(io_err)? {
            // Someone else's version is at the path: keep it, write ours beside it.
            let ours = conflict_path(&s.package);
            other = Some(s.package.display().to_string());
            rekey(app, s, &ours)?;
            conflict = Some(ours.display().to_string());
        }
    }
    let version = s.store.save_package_with_backup(&s.package, Some((&policy, &s.key)), std::time::SystemTime::now(), explicit).map_err(err)?;
    s.stamp = Some(FileStamp::of(&s.package).map_err(io_err)?);
    if conflict.is_some() {
        remember(app, &s.package)?;
    }
    Ok(Saved { version, backups: backup::list(&policy.dir, &s.key).len(), path: s.package.display().to_string(), name: s.key.clone(), conflict, other, recreated })
}

#[tauri::command]
async fn save_package(app: State<'_, App>, explicit: Option<bool>) -> Result<Saved, String> {
    with_session(&app, |s| write_session(&app, s, explicit.unwrap_or(false)))
}

/// Write the project to another file (chosen in the Save As dialog) and
/// continue there. The copy gets a new project identity; the original file
/// keeps its last saved state. An existing file at the target is backed up
/// first; a target with unsaved recovery work of its own is refused.
#[tauri::command]
async fn save_as(app: State<'_, App>, path: String) -> Result<Saved, String> {
    let target = normalize(Path::new(&path));
    with_session(&app, |s| {
        if target == s.package {
            return write_session(&app, s, true);
        }
        let target_work = work_path(&app, &key_of(&app, &target));
        if target_work.exists() {
            if let Ok(w) = Store::inspect(&target_work) {
                if w.version > w.saved_version {
                    return Err(format!("{} has unsaved work waiting to be recovered; open it first, or choose another name", target.display()));
                }
            }
            cirth_core::store::remove_store_files(&target_work).map_err(err)?;
        }
        let old_id = s.store.project_id().map_err(err)?;
        s.store.set_project_id(&cirth_core::model::new_id()).map_err(err)?;
        let policy = backup_policy(&app);
        let target_key = key_of(&app, &target);
        // An existing file at the target is backed up before it is replaced.
        if let Err(e) = std::fs::create_dir_all(target.parent().unwrap_or(Path::new("."))).map_err(io_err).and_then(|_| {
            s.store.save_package_with_backup(&target, Some((&policy, &target_key)), std::time::SystemTime::now(), true).map(|_| ()).map_err(err)
        }) {
            s.store.set_project_id(&old_id).map_err(err)?;
            return Err(e);
        }
        rekey(&app, s, &target)?;
        s.stamp = Some(FileStamp::of(&s.package).map_err(io_err)?);
        remember(&app, &s.package)?;
        let version = s.store.saved_version().map_err(err)?;
        Ok(Saved { version, backups: backup::list(&policy.dir, &target_key).len(), path: s.package.display().to_string(), name: s.key.clone(), conflict: None, other: None, recreated: false })
    })
}

#[derive(Serialize)]
struct OutsideChange {
    changed: bool,
    missing: bool,
    path: String,
}

/// Has the open project's file changed outside Kolbítar since we last
/// read or wrote it? (The UI checks on focus and before autosave.)
#[tauri::command]
async fn check_outside_change(app: State<'_, App>) -> Result<OutsideChange, String> {
    with_session(&app, |s| {
        let missing = !s.package.exists();
        let changed = !missing && s.stamp.as_ref().map(|st| st.changed(&s.package)).transpose().map_err(io_err)?.unwrap_or(false);
        Ok(OutsideChange { changed, missing, path: s.package.display().to_string() })
    })
}

// --- Pagination and PDF ---------------------------------------------------------------

#[derive(Serialize)]
struct Paginated {
    map: PageMap,
    load_ms: f64,
    layout_ms: f64,
    missing_glyphs: Vec<char>,
    /// Locked scene numbers (empty when unlocked), for the scene list and margins.
    scene_numbers: Vec<cirth_core::numbering::SceneNumber>,
    scene_numbers_locked: bool,
    /// The active revision set: its text is marked and its pages flagged `revised`.
    revision: Option<RevisionSet>,
    revised_pages: usize,
    /// Pages are laid out against a locked baseline (labels like 12A).
    pages_locked: bool,
    /// Each scene's page, length in eighths and speakers (the navigator).
    scene_stats: Vec<cirth_core::navigator::SceneStat>,
}

fn paginate_current(app: &App, profile_name: &str) -> Result<(Paginated, Document), String> {
    let t0 = Instant::now();
    // Hold the lock only while reading the canonical document.
    let (doc, numbers, locked, revision, page_lock) = with_session(app, |s| {
        let main = s.store.current_document().map_err(err)?;
        Ok((
            s.store.load().map_err(err)?,
            s.store.scene_numbers(&main).map_err(err)?,
            s.store.scene_numbers_locked(&main).map_err(err)?,
            s.store.active_revision(&main).map_err(err)?,
            s.store.page_lock(&main).map_err(err)?,
        ))
    })?;
    let t1 = Instant::now();
    let mut map = layout::paginate_production(&doc.blocks, &profile(profile_name), doc.version, &numbers, page_lock.as_ref());
    let revised_pages = revision.as_ref().map_or(0, |set| revisions::mark_pages(&mut map, &doc.blocks, set));
    let t2 = Instant::now();
    let font = fontcheck::FontInfo::parse(pdf::REGULAR).ok_or("bundled font unreadable")?;
    let all: String = doc.blocks.iter().map(|b| b.text()).collect::<Vec<_>>().join(" ");
    let missing_glyphs = fontcheck::missing_chars(&font, &all);
    let scene_numbers = numbers.into_values().collect();
    let scene_stats = cirth_core::navigator::scene_stats(&doc.blocks, &map);
    Ok((Paginated { map, load_ms: (t1 - t0).as_secs_f64() * 1e3, layout_ms: (t2 - t1).as_secs_f64() * 1e3, missing_glyphs, scene_numbers, scene_numbers_locked: locked, revision, revised_pages, pages_locked: page_lock.is_some(), scene_stats }, doc))
}

#[tauri::command]
async fn paginate(app: State<'_, App>, profile: String) -> Result<Paginated, String> {
    Ok(paginate_current(&app, &profile)?.0)
}

#[derive(Serialize)]
struct Exported {
    path: String,
    pages: usize,
    doc_version: u64,
    layout_ms: f64,
    pdf_ms: f64,
    bytes: usize,
    missing_glyphs: Vec<char>,
    /// Pages with the active revision set's changes (in the whole script).
    revised_pages: usize,
    /// Numbers of the pages written (changed pages keep their script numbers).
    page_numbers: Vec<usize>,
}

/// Header and footer text for this document (settings; tokens unexpanded).
#[derive(Serialize, Deserialize, Default)]
struct PageFurniture {
    header: String,
    footer: String,
}

fn page_furniture_of(s: &Session) -> Result<PageFurniture, String> {
    let scope = format!("document:{}", s.store.current_document().map_err(err)?);
    Ok(PageFurniture {
        header: s.store.setting(&scope, "header").map_err(err)?.unwrap_or_default(),
        footer: s.store.setting(&scope, "footer").map_err(err)?.unwrap_or_default(),
    })
}

#[tauri::command]
async fn page_furniture(app: State<'_, App>) -> Result<PageFurniture, String> {
    with_session(&app, |s| page_furniture_of(s))
}

/// Store header and footer. The next save writes them into the project file.
#[tauri::command]
async fn set_page_furniture(app: State<'_, App>, header: String, footer: String) -> Result<(), String> {
    with_session(&app, |s| {
        let scope = format!("document:{}", s.store.current_document().map_err(err)?);
        s.store.set_setting(&scope, "header", &header).map_err(err)?;
        s.store.set_setting(&scope, "footer", &footer).map_err(err)
    })
}

/// Keep only the pages with the active revision set's changes (their
/// numbers stay as in the full script). Refused when there are none.
fn changed_pages_only(p: &mut Paginated) -> Result<(), String> {
    let Some(set) = &p.revision else { return Err("Choose a revision set first (Format > Revisions).".into()) };
    if p.revised_pages == 0 {
        return Err(format!("No page has changes in {}.", set.label));
    }
    p.map.pages.retain(|pg| pg.revised);
    Ok(())
}

/// File > Export > PDF…: the page map with title page, scene numbers,
/// header and footer, revision marks and headers of the active set. With
/// `changed_only`, just the pages that set changed (no title page). Without
/// `path` (tests) it goes to the app's exports folder.
#[tauri::command]
async fn export_pdf(app: State<'_, App>, profile_name: String, path: Option<String>, changed_only: Option<bool>) -> Result<Exported, String> {
    let (mut p, doc) = paginate_current(&app, &profile_name)?;
    let changed_only = changed_only.unwrap_or(false);
    if changed_only {
        changed_pages_only(&mut p)?;
    }
    let prof = profile(&profile_name);
    let t0 = Instant::now();
    let (tp, furniture, project_id) = with_session(&app, |s| Ok((s.store.title_page(&s.store.current_document().map_err(err)?).map_err(err)?, page_furniture_of(s)?, s.store.project_id().map_err(err)?)))?;
    let opts = pdf::PdfOptions {
        title: if tp.is_empty() { doc.title.clone() } else { tp.title.lines().next().unwrap_or("").trim().to_string() },
        author: tp.authors.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(", "),
        subject: tp.draft_label.trim().to_string(),
        date_unix: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
        document_id: project_id,
        header: pdf::expand_tokens(&furniture.header, &tp),
        footer: pdf::expand_tokens(&furniture.footer, &tp),
        revision_header: p.revision.as_ref().map(revisions::header).unwrap_or_default(),
    };
    let bytes = pdf::render_document(&p.map, &prof, if changed_only { None } else { Some(&tp) }, &opts)?;
    let pdf_ms = t0.elapsed().as_secs_f64() * 1e3;
    let path = match path {
        Some(target) => normalize(Path::new(&target)),
        None => {
            let name = with_session(&app, |s| Ok(s.key.clone()))?;
            let dir = data_dir(&app).join("exports");
            std::fs::create_dir_all(&dir).map_err(io_err)?;
            dir.join(format!("{name}-v{}-{}.pdf", doc.version, prof.name))
        }
    };
    let tmp = path.with_extension("pdf.tmp");
    std::fs::write(&tmp, &bytes).map_err(io_err)?;
    cirth_core::fsutil::sync_file(&tmp).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &path).map_err(io_err)?;
    Ok(Exported { path: path.display().to_string(), pages: p.map.pages.len(), doc_version: doc.version, layout_ms: p.layout_ms, pdf_ms, bytes: bytes.len(), missing_glyphs: p.missing_glyphs, revised_pages: p.revised_pages, page_numbers: p.map.pages.iter().map(|pg| pg.number).collect() })
}

// --- Page profile per document and plain-text export --------------------------------

/// The UI names profiles "letter" and "a4"; documents store "us-letter" and "a4".
fn ui_profile(stored: &str) -> &'static str {
    if stored == "a4" { "a4" } else { "letter" }
}

#[tauri::command]
async fn document_profile(app: State<'_, App>) -> Result<&'static str, String> {
    with_session(&app, |s| Ok(ui_profile(&s.store.document_profile(&s.store.current_document().map_err(err)?).map_err(err)?)))
}

/// Store the page size for this document. The next save writes it into the
/// project file; it never changes the script text.
#[tauri::command]
async fn set_document_profile(app: State<'_, App>, profile: String) -> Result<&'static str, String> {
    let stored = match profile.as_str() {
        "letter" => "us-letter",
        "a4" => "a4",
        _ => return Err(format!("unknown page size {profile}")),
    };
    with_session(&app, |s| {
        let doc = s.store.current_document().map_err(err)?;
        s.store.set_document_profile(&doc, stored).map_err(err)?;
        Ok(ui_profile(stored))
    })
}

/// The current document's title page (empty fields if none yet).
#[tauri::command]
async fn title_page(app: State<'_, App>) -> Result<cirth_core::title::TitlePage, String> {
    with_session(&app, |s| s.store.title_page(&s.store.current_document().map_err(err)?).map_err(err))
}

/// The notes panel's text: saved with the project, tied to nothing else.
#[tauri::command]
async fn project_notes(app: State<'_, App>) -> Result<String, String> {
    with_session(&app, |s| s.store.project_notes().map_err(err))
}

/// Store the notes in the working copy at once (so a crash keeps them); the
/// next save, autosave or close writes them into the project file.
#[tauri::command]
async fn set_project_notes(app: State<'_, App>, text: String) -> Result<(), String> {
    with_session(&app, |s| s.store.set_project_notes(&text).map_err(err))
}

/// Store the title page. Like the page size, the next save writes it into
/// the project file; exports include it when it has a title.
#[tauri::command]
async fn set_title_page(app: State<'_, App>, page: cirth_core::title::TitlePage) -> Result<(), String> {
    with_session(&app, |s| {
        let doc = s.store.current_document().map_err(err)?;
        s.store.set_title_page(&doc, &page).map_err(err)
    })
}

#[derive(Serialize)]
struct TxtExported {
    path: String,
    pages: usize,
    doc_version: u64,
    profile: &'static str,
    notes: Vec<String>,
}

/// Plain text from the same page map as the PDF, in this document's page
/// size; `changed_only` as for the PDF.
#[tauri::command]
async fn export_txt(app: State<'_, App>, path: String, changed_only: Option<bool>) -> Result<TxtExported, String> {
    let name = with_session(&app, |s| Ok(ui_profile(&s.store.document_profile(&s.store.current_document().map_err(err)?).map_err(err)?)))?;
    let (mut p, doc) = paginate_current(&app, name)?;
    let changed_only = changed_only.unwrap_or(false);
    if changed_only {
        changed_pages_only(&mut p)?;
    }
    let (tp, furniture) = with_session(&app, |s| Ok((s.store.title_page(&s.store.current_document().map_err(err)?).map_err(err)?, page_furniture_of(s)?)))?;
    let rev = p.revision.as_ref().map(revisions::header).unwrap_or_default();
    let t = cirth_core::txt::render_document(&p.map, &profile(name), if changed_only { None } else { Some(&tp) }, &pdf::expand_tokens(&furniture.header, &tp), &pdf::expand_tokens(&furniture.footer, &tp), &rev);
    let target = normalize(Path::new(&path));
    let tmp = target.with_extension("txt.tmp");
    std::fs::write(&tmp, &t.text).map_err(io_err)?;
    cirth_core::fsutil::sync_file(&tmp).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &target).map_err(io_err)?;
    Ok(TxtExported { path: target.display().to_string(), pages: t.pages, doc_version: doc.version, profile: name, notes: t.notes })
}

// --- Word counts (one rule: cirth_core::words) ---------------------------------------

/// Counts for texts the editor holds right now (current block, selection).
#[tauri::command]
fn count_words(texts: Vec<String>) -> Vec<u64> {
    texts.iter().map(|t| cirth_core::words::count(t)).collect()
}

/// Counts for the stored document (what reports use), with its version.
#[tauri::command]
async fn word_counts(app: State<'_, App>) -> Result<cirth_core::words::DocumentCounts, String> {
    let doc = with_session(&app, |s| s.store.load().map_err(err))?;
    Ok(cirth_core::words::document(&doc))
}

// --- Free Writing (cirth_core::freewrite) ------------------------------------------------
//
// A workspace of pieces independent of projects, in freewriting.db in the
// app data folder. Nothing here is attached to a project unless the writer
// copies or moves a piece into the open project; both sides record it.

use cirth_core::freewrite::{Folder, FreeStore, Piece, PieceSummary};

fn with_free<T>(app: &App, f: impl FnOnce(&FreeStore) -> Result<T, String>) -> Result<T, String> {
    let mut guard = app.free.lock().unwrap();
    if guard.is_none() {
        *guard = Some(FreeStore::open(&data_dir(app).join("freewriting.db")).map_err(|e| e.to_string())?);
    }
    f(guard.as_ref().unwrap())
}

fn fe(e: cirth_core::freewrite::FreeError) -> String {
    e.to_string()
}

#[derive(Serialize)]
struct FreeList {
    folders: Vec<Folder>,
    pieces: Vec<PieceSummary>,
}

#[tauri::command]
async fn fw_list(app: State<'_, App>, folder: Option<String>, trash: bool, query: Option<String>) -> Result<FreeList, String> {
    with_free(&app, |s| {
        let pieces = match query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => s.search(q).map_err(fe)?,
            None => s.list(folder.as_deref(), trash).map_err(fe)?,
        };
        Ok(FreeList { folders: s.folders().map_err(fe)?, pieces })
    })
}

#[tauri::command]
async fn fw_create_folder(app: State<'_, App>, name: String) -> Result<Folder, String> {
    with_free(&app, |s| s.create_folder(&name).map_err(fe))
}

#[tauri::command]
async fn fw_rename_folder(app: State<'_, App>, id: String, name: String) -> Result<(), String> {
    with_free(&app, |s| s.rename_folder(&id, &name).map_err(fe))
}

#[tauri::command]
async fn fw_create(app: State<'_, App>, folder_id: Option<String>, title: String) -> Result<Piece, String> {
    with_free(&app, |s| s.create(folder_id.as_deref(), &title).map_err(fe))
}

#[tauri::command]
async fn fw_get(app: State<'_, App>, id: String) -> Result<Piece, String> {
    with_free(&app, |s| s.get(&id).map_err(fe))
}

#[tauri::command]
async fn fw_save(app: State<'_, App>, id: String, title: String, body: String) -> Result<String, String> {
    with_free(&app, |s| s.save(&id, &title, &body).map_err(fe))
}

#[tauri::command]
async fn fw_move(app: State<'_, App>, id: String, folder_id: Option<String>) -> Result<(), String> {
    with_free(&app, |s| s.move_to(&id, folder_id.as_deref()).map_err(fe))
}

#[tauri::command]
async fn fw_trash(app: State<'_, App>, id: String, trashed: bool) -> Result<(), String> {
    with_free(&app, |s| s.set_trashed(&id, trashed).map_err(fe))
}

/// Write a piece as a UTF-8 text file (path from the Save dialog).
#[tauri::command]
async fn fw_export(app: State<'_, App>, id: String, path: String) -> Result<String, String> {
    let p = with_free(&app, |s| s.get(&id).map_err(fe))?;
    let target = normalize(Path::new(&path));
    let tmp = target.with_extension("txt.tmp");
    std::fs::write(&tmp, format!("{}\n\n{}\n", p.title, p.body.trim_end())).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &target).map_err(io_err)?;
    Ok(target.display().to_string())
}

/// Record that a piece was copied (or moved) into the open project. The UI
/// has already inserted the text as an ordinary, undoable edit. A move also
/// sends the piece to the trash; it is never deleted.
#[tauri::command]
async fn fw_note_copied(app: State<'_, App>, id: String, moved: bool) -> Result<(), String> {
    let (title, file) = with_session(&app, |s| Ok((s.store.load().map_err(err)?.title, s.package.display().to_string())))?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let when = backup::readable_utc(secs);
    let piece = with_free(&app, |s| {
        s.add_provenance(&id, &format!("{} into \"{}\" ({}) on {}", if moved { "Moved" } else { "Copied" }, title, file, when)).map_err(fe)?;
        if moved {
            s.set_trashed(&id, true).map_err(fe)?;
        }
        s.get(&id).map_err(fe)
    })?;
    with_session(&app, |s| {
        let mut list: Vec<serde_json::Value> = s.store.setting("project", "free_writing_imports").ok().flatten().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
        list.push(serde_json::json!({ "piece_id": piece.id, "title": piece.title, "at": when, "moved": moved }));
        s.store.set_setting("project", "free_writing_imports", &serde_json::to_string(&list).unwrap_or_default()).map_err(err)
    })
}

// --- Spelling (cirth_core::spell) ------------------------------------------------------
//
// Language is a project setting ("en_US", "en_GB" or "off"; default en_US),
// separate from page size. Project dictionary: a JSON list in the project's
// settings. Personal dictionary: user-dictionary.txt in the app data folder,
// one word per line. Character cue names are accepted automatically.

const SPELL_SCOPE: &str = "project";

fn spelling_lang(s: &Session) -> String {
    s.store.setting(SPELL_SCOPE, "spelling").ok().flatten().unwrap_or_else(|| "en_US".into())
}

fn project_words(s: &Session) -> Vec<String> {
    s.store.setting(SPELL_SCOPE, "dictionary").ok().flatten().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
}

fn user_dictionary(app: &App) -> PathBuf {
    data_dir(app).join("user-dictionary.txt")
}

fn user_words(app: &App) -> Vec<String> {
    std::fs::read_to_string(user_dictionary(app)).map(|t| t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()).unwrap_or_default()
}

/// The session's speller, built on first use; `None` when spelling is off.
fn speller<'a>(app: &App, s: &'a mut Session) -> Option<&'a mut cirth_core::spell::Speller> {
    let lang = cirth_core::spell::Lang::parse(&spelling_lang(s))?;
    if s.speller.as_ref().map(|sp| sp.lang()) != Some(lang) {
        let mut sp = cirth_core::spell::Speller::new(lang);
        for w in project_words(s).iter().chain(user_words(app).iter()) {
            sp.add(w);
        }
        s.speller = Some(sp);
    }
    s.speller.as_mut()
}

#[derive(Serialize)]
struct SpellSettings {
    lang: String,
    project_words: Vec<String>,
    user_words: Vec<String>,
}

#[tauri::command]
async fn spell_settings(app: State<'_, App>) -> Result<SpellSettings, String> {
    with_session(&app, |s| Ok(SpellSettings { lang: spelling_lang(s), project_words: project_words(s), user_words: user_words(&app) }))
}

#[tauri::command]
async fn set_spelling(app: State<'_, App>, lang: String) -> Result<String, String> {
    if lang != "off" && cirth_core::spell::Lang::parse(&lang).is_none() {
        return Err(format!("unknown spelling language {lang}"));
    }
    with_session(&app, |s| {
        s.store.set_setting(SPELL_SCOPE, "spelling", &lang).map_err(err)?;
        s.speller = None;
        Ok(lang)
    })
}

#[derive(Deserialize)]
struct SpellBlock {
    id: String,
    text: String,
}

#[derive(Serialize)]
struct SpellResult {
    id: String,
    /// Misspelled ranges, UTF-16 offsets within the block's text.
    ranges: Vec<(usize, usize)>,
}

/// Check blocks; `names` are character cue names to accept.
#[tauri::command]
async fn spell_check(app: State<'_, App>, blocks: Vec<SpellBlock>, names: Vec<String>) -> Result<Vec<SpellResult>, String> {
    with_session(&app, |s| {
        let Some(sp) = speller(&app, s) else {
            return Ok(blocks.into_iter().map(|b| SpellResult { id: b.id, ranges: vec![] }).collect());
        };
        for n in &names {
            sp.add(n);
        }
        Ok(blocks.into_iter().map(|b| SpellResult { ranges: sp.misspelled(&b.text), id: b.id }).collect())
    })
}

#[tauri::command]
async fn spell_suggest(app: State<'_, App>, word: String) -> Result<Vec<String>, String> {
    with_session(&app, |s| Ok(speller(&app, s).map(|sp| sp.suggest(&word)).unwrap_or_default()))
}

/// Accept a word in the project dictionary ("project") or the personal one ("user").
#[tauri::command]
async fn spell_add(app: State<'_, App>, word: String, scope: String) -> Result<(), String> {
    let word = word.trim().to_string();
    if word.is_empty() || word.contains(['/', ' ', '\t', '\n']) {
        return Err("not a single word".into());
    }
    with_session(&app, |s| {
        match scope.as_str() {
            "project" => {
                let mut words = project_words(s);
                if !words.contains(&word) {
                    words.push(word.clone());
                    words.sort();
                    s.store.set_setting(SPELL_SCOPE, "dictionary", &serde_json::to_string(&words).unwrap_or_default()).map_err(err)?;
                }
            }
            "user" => {
                let mut words = user_words(&app);
                if !words.contains(&word) {
                    words.push(word.clone());
                    words.sort();
                    let path = user_dictionary(&app);
                    let tmp = path.with_extension("txt.tmp");
                    std::fs::write(&tmp, words.join("\n") + "\n").map_err(io_err)?;
                    cirth_core::fsutil::replace_file(&tmp, &path).map_err(io_err)?;
                }
            }
            _ => return Err(format!("unknown dictionary {scope}")),
        }
        if let Some(sp) = speller(&app, s) {
            sp.add(&word);
        }
        Ok(())
    })
}

/// Accept a word until the project is closed.
#[tauri::command]
async fn spell_ignore(app: State<'_, App>, word: String) -> Result<(), String> {
    with_session(&app, |s| {
        if let Some(sp) = speller(&app, s) {
            sp.ignore(&word);
        }
        Ok(())
    })
}

// --- Backups -----------------------------------------------------------------------------

#[derive(Serialize)]
struct BackupItem {
    path: String,
    /// "backup" (rolling) or "pre-upgrade" (original kept before a format upgrade).
    kind: &'static str,
    created_s: u64,
    saved_version: u64,
    title: String,
    blocks: u64,
}

/// Backups of one project (by key), newest first, then any pre-upgrade originals.
#[tauri::command]
async fn list_backups(app: State<'_, App>, name: String) -> Result<Vec<BackupItem>, String> {
    let dir = backup_policy(&app).dir;
    let mut out: Vec<BackupItem> = backup::list(&dir, &name)
        .into_iter()
        .map(|b| BackupItem { path: b.path.display().to_string(), kind: "backup", created_s: b.created_s, saved_version: b.saved_version, title: String::new(), blocks: 0 })
        .collect();
    let prefix = format!("{name}--pre-schema-v");
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let file = e.file_name().to_string_lossy().to_string();
        if file.starts_with(&prefix) && file.ends_with(".cirth") {
            let created_s = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push(BackupItem { path: e.path().display().to_string(), kind: "pre-upgrade", created_s, saved_version: 0, title: String::new(), blocks: 0 });
        }
    }
    for b in &mut out {
        if let Ok(info) = Store::inspect(Path::new(&b.path)) {
            b.title = info.title;
            b.blocks = info.blocks;
            if b.kind == "pre-upgrade" {
                b.saved_version = info.saved_version;
            }
        }
    }
    Ok(out)
}

/// Open a backup as a new library project "<title> (restored <time>)" with its
/// own identity. The backup file and the current project are left unchanged.
#[tauri::command]
async fn restore_backup(app: State<'_, App>, path: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let src = PathBuf::from(&path);
    if normalize(&src).parent() != Some(normalize(&backup_policy(&app).dir).as_path()) {
        return Err("only files in the backups folder can be restored here".into());
    }
    let info = Store::inspect(&src).map_err(err)?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let title = format!("{} (restored {})", if info.title.is_empty() { "Untitled" } else { &info.title }, backup::readable_utc(secs));
    let base = slug(&title);
    let mut name = base.clone();
    let mut n = 2;
    while library_path(&app, &name).exists() {
        name = format!("{base}-{n}");
        n += 1;
    }
    let dest = library_path(&app, &name);
    std::fs::copy(&src, &dest).map_err(io_err)?;
    let mut out = open_file(&app, &dest, t0)?;
    with_session(&app, |s| {
        s.store.set_project_id(&cirth_core::model::new_id()).map_err(err)?;
        s.store.set_title(&title).map_err(err)?;
        write_session(&app, s, false)?;
        Ok(())
    })?;
    out.doc.title = title;
    Ok(out)
}

// --- Display preferences (app-wide, not per project) ----------------------------------

/// UI size, contrast and which panels are shown. Stored in the app data
/// folder; never in projects.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
struct UiPrefs {
    /// Whole-window zoom: 0.8 to 2.0.
    scale: f64,
    /// "system" follows the OS (forced colors / prefers-contrast), "high" forces it.
    contrast: String,
    /// Older preference files have no panels entry: everything shown.
    #[serde(default)]
    panels: Panels,
    /// Typewriter mode: the typing line stays centred (view only).
    #[serde(default)]
    typewriter: bool,
    /// Font of the script on screen only (owner decision 2026-10-26: pages and
    /// exports always use Courier Prime 12 pt). One of SCREEN_FONTS.
    #[serde(default = "default_editor_font")]
    editor_font: String,
    /// Size of the script text on screen only, in points: 10 to 20.
    #[serde(default = "default_editor_size")]
    editor_size: f64,
    /// Colour theme, one of THEMES; "system" follows the OS's light or dark.
    #[serde(default = "default_theme")]
    theme: String,
    /// Rebound keyboard shortcuts: command id -> keys ("" = none). Only what
    /// differs from the defaults in app/src/bindings.ts.
    #[serde(default)]
    keys: std::collections::BTreeMap<String, String>,
}

const SCREEN_FONTS: [&str; 4] = ["courier-prime", "mono", "serif", "sans"];
const THEMES: [&str; 5] = ["system", "day", "night", "midnight", "oled"];

fn default_theme() -> String {
    "system".into()
}

fn default_editor_font() -> String {
    "courier-prime".into()
}

fn default_editor_size() -> f64 {
    12.0
}

/// Panels of the script view the writer can hide (View menu).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
struct Panels {
    nav: bool,
    board: bool,
    toolbar: bool,
    status: bool,
    /// The notes panel; off until the writer opens it.
    notes: bool,
}

impl Default for Panels {
    fn default() -> Self {
        Panels { nav: true, board: true, toolbar: true, status: true, notes: false }
    }
}

impl Default for UiPrefs {
    fn default() -> Self {
        UiPrefs { scale: 1.0, contrast: "system".into(), panels: Panels::default(), typewriter: false, editor_font: default_editor_font(), editor_size: default_editor_size(), theme: default_theme(), keys: Default::default() }
    }
}

/// View menu check marks follow the stored panels (a click on a check item
/// toggles its mark natively; this puts it back in line with the setting).
fn sync_view_checks(app: &tauri::AppHandle, prefs: &UiPrefs) {
    let p = &prefs.panels;
    let checks = [("view_nav", p.nav), ("view_board", p.board), ("view_toolbar", p.toolbar), ("view_status", p.status), ("view_notes", p.notes), ("view_typewriter", prefs.typewriter)];
    let mut map: std::collections::HashMap<String, bool> = checks.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    for f in SCREEN_FONTS {
        map.insert(format!("font_{f}"), prefs.editor_font == f);
    }
    for t in THEMES {
        map.insert(format!("theme_{t}"), prefs.theme == t);
    }
    set_menu_checks(app.clone(), map);
}

fn prefs_path(app: &App) -> PathBuf {
    data_dir(app).join("preferences.json")
}

fn apply_zoom(window: &tauri::WebviewWindow, prefs: &UiPrefs) -> Result<(), String> {
    window.set_zoom(prefs.scale).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ui_prefs(app: State<'_, App>, handle: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<UiPrefs, String> {
    let prefs = std::fs::read_to_string(prefs_path(&app)).ok().and_then(|t| serde_json::from_str::<UiPrefs>(&t).ok()).unwrap_or_default();
    apply_zoom(&window, &prefs)?;
    sync_view_checks(&handle, &prefs);
    Ok(prefs)
}

#[tauri::command]
async fn set_ui_prefs(app: State<'_, App>, handle: tauri::AppHandle, window: tauri::WebviewWindow, prefs: UiPrefs) -> Result<UiPrefs, String> {
    let prefs = UiPrefs { scale: (prefs.scale * 10.0).round().clamp(8.0, 20.0) / 10.0, contrast: if prefs.contrast == "high" { "high".into() } else { "system".into() },
        panels: prefs.panels,
        typewriter: prefs.typewriter,
        editor_font: if SCREEN_FONTS.contains(&prefs.editor_font.as_str()) { prefs.editor_font } else { default_editor_font() },
        editor_size: if prefs.editor_size.is_finite() { prefs.editor_size.round().clamp(10.0, 20.0) } else { default_editor_size() },
        theme: if THEMES.contains(&prefs.theme.as_str()) { prefs.theme } else { default_theme() },
        // Plain ids and short key names only; the UI checks what a key may be.
        keys: prefs
            .keys
            .into_iter()
            .filter(|(id, k)| id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') && k.len() <= 40 && !k.chars().any(char::is_control))
            .take(200)
            .collect(),
    };
    let path = prefs_path(&app);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?).map_err(io_err)?;
    cirth_core::fsutil::replace_file(&tmp, &path).map_err(io_err)?;
    apply_zoom(&window, &prefs)?;
    sync_view_checks(&handle, &prefs);
    Ok(prefs)
}

/// Focus mode's window side: full screen without the menu bar (Windows and
/// Linux keep the menu bar in full screen, so it is hidden here). On,
/// returns whether this call made the window full screen; off, leaves full
/// screen only if `restore` says focus mode made it so.
///
/// macOS uses "simple" full screen (no new Space, no animation); native full
/// screen's exit left the window without keyboard input until it was
/// clicked. Either way the web view must be made first responder again (see
/// below). If the window is already in native full screen, it is left so.
#[tauri::command]
fn focus_window(window: tauri::WebviewWindow, on: bool, restore: bool) -> Result<bool, String> {
    let e = |e: tauri::Error| e.to_string();
    if on {
        let made = !window.is_fullscreen().map_err(e)?;
        if made {
            #[cfg(target_os = "macos")]
            {
                window.set_simple_fullscreen(true).map_err(e)?;
                // tao's style-mask change makes its own content view the
                // first responder, so keys stop reaching the WKWebView.
                // Hand first responder back to the web view. (Found and
                // verified on a Mac by GROGU, 2026-10-27.)
                window.set_focus().map_err(e)?;
                AsRef::<tauri::Webview<_>>::as_ref(&window).set_focus().map_err(e)?;
            }
            #[cfg(not(target_os = "macos"))]
            window.set_fullscreen(true).map_err(e)?;
        }
        #[cfg(not(target_os = "macos"))]
        window.hide_menu().map_err(e)?;
        Ok(made)
    } else {
        #[cfg(not(target_os = "macos"))]
        window.show_menu().map_err(e)?;
        if restore {
            #[cfg(target_os = "macos")]
            {
                window.set_simple_fullscreen(false).map_err(e)?;
                window.set_focus().map_err(e)?;
                // Leaving restores the style mask asynchronously, and tao then
                // makes its content view first responder again; refocus the
                // web view once that has run (150 ms worked in every Mac run).
                let webview = AsRef::<tauri::Webview<_>>::as_ref(&window).clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    let _ = webview.set_focus();
                });
            }
            #[cfg(not(target_os = "macos"))]
            window.set_fullscreen(false).map_err(e)?;
        }
        Ok(false)
    }
}

/// About and licences: the app's own notice and license, plus every bundled
/// third-party license (generated by app/scripts/third-party-notices.mjs).
#[derive(Serialize)]
struct AboutInfo {
    version: &'static str,
    notice: &'static str,
    license: &'static str,
    third_party: &'static str,
}

/// View > Window and View > Mode > Full Screen. Returns whether the window is
/// full screen afterwards. Full screen keeps the menu bar (focus mode hides it).
#[tauri::command]
fn window_command(window: tauri::WebviewWindow, action: String) -> Result<bool, String> {
    let e = |e: tauri::Error| e.to_string();
    match action.as_str() {
        "minimize" => window.minimize().map_err(e)?,
        "zoom" => {
            if window.is_maximized().map_err(e)? {
                window.unmaximize().map_err(e)?
            } else {
                window.maximize().map_err(e)?
            }
        }
        "fullscreen" => {
            let on = !window.is_fullscreen().map_err(e)?;
            window.set_fullscreen(on).map_err(e)?;
            // As in focus mode: hand keyboard focus back to the web view.
            window.set_focus().map_err(e)?;
            AsRef::<tauri::Webview<_>>::as_ref(&window).set_focus().map_err(e)?;
        }
        _ => return Err(format!("unknown window action {action}")),
    }
    window.is_fullscreen().map_err(e)
}

/// Pop-out panels (ADR 0004): a window of its own for the scene list, board
/// or notes. If it is already open it comes to the front. The window only
/// draws what the main window sends and sends changes back; it never changes
/// the project itself. Closing it tells the main window to dock the panel.
/// Async: building a window inside a synchronous command deadlocks on Windows.
#[tauri::command]
async fn pop_out_panel(app: tauri::AppHandle, panel: String, title: String) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    if !["nav", "board", "notes"].contains(&panel.as_str()) {
        return Err(format!("unknown panel {panel}"));
    }
    let label = format!("panel-{panel}");
    let e = |e: tauri::Error| e.to_string();
    if let Some(w) = app.get_webview_window(&label) {
        w.unminimize().map_err(e)?;
        w.show().map_err(e)?;
        return w.set_focus().map_err(e);
    }
    let (w, h) = if panel == "board" { (420.0, 720.0) } else { (340.0, 640.0) };
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(format!("panel.html?panel={panel}").into()))
        .title(format!("{title} - Kolbítar"))
        .inner_size(w, h)
        .min_inner_size(240.0, 200.0)
        .build()
        .map_err(e)?;
    // The menu bar belongs to the main window (Windows and Linux give every
    // window the app menu otherwise).
    #[cfg(not(target_os = "macos"))]
    window.remove_menu().map_err(e)?;
    let handle = app.clone();
    window.on_window_event(move |ev| {
        if let tauri::WindowEvent::Destroyed = ev {
            let _ = handle.emit_to("main", "panel-closed", panel.clone());
        }
    });
    Ok(())
}

/// Dock a panel: its window closes (the main window shows the panel again).
#[tauri::command]
async fn close_panel_window(app: tauri::AppHandle, panel: String) -> Result<(), String> {
    use tauri::Manager;
    match app.get_webview_window(&format!("panel-{panel}")) {
        Some(w) => w.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Labels of the open windows (tests check pop-out windows open and close).
#[tauri::command]
fn window_labels(app: tauri::AppHandle) -> Vec<String> {
    use tauri::Manager;
    let mut v: Vec<String> = app.webview_windows().into_keys().collect();
    v.sort();
    v
}

/// File > Import…: the start of a file (up to 4 KB, as text), so the app can
/// tell Final Draft XML from Fountain or plain text by content as well as by
/// extension. Reads only; the importers do the rest.
#[tauri::command]
fn peek_file(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut buf = vec![0u8; 4096];
    let n = std::fs::File::open(&path).and_then(|mut f| f.read(&mut buf)).map_err(|e| format!("{path}: {e}"))?;
    Ok(String::from_utf8_lossy(&buf[..n]).into_owned())
}

/// Help > Check for Updates…: opens the project's releases page in the
/// writer's browser. Only on that click: the app never checks by itself.
#[tauri::command]
fn open_releases_page() -> Result<(), String> {
    const URL: &str = "https://github.com/electrichobo/cirthscribe/releases";
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", URL]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(URL);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(URL);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open the browser: {e}"))
}

#[tauri::command]
fn about_info() -> AboutInfo {
    AboutInfo {
        version: env!("CARGO_PKG_VERSION"),
        notice: include_str!("../../../NOTICE"),
        license: include_str!("../../../LICENSE"),
        third_party: include_str!("../../../assets/legal/THIRD-PARTY-NOTICES.txt"),
    }
}

/// For the test harness: hard-kill this process in crash tests under any
/// driver (WebDriver does not expose the app's process id).
#[tauri::command]
fn process_id() -> u32 {
    std::process::id()
}

/// For tests and the UI: where the library and app data live.
#[tauri::command]
async fn library_folder(app: State<'_, App>) -> Result<String, String> {
    Ok(library_dir(&app).display().to_string())
}

/// Native menu: File, Edit, View, Format, Help on every OS (plus the app
/// menu on macOS), so every action is reachable from the menu bar. Custom
/// items carry no OS accelerators: shortcuts are handled in the web UI so
/// they behave the same on every platform and in tests; labels show the key.
/// Choices are sent to the UI as a "menu" event and run the same actions as
/// the buttons. Cut, Copy, Paste and Select All are the OS's own items
/// (macOS and GTK run the native command; Windows sends the key to the web
/// view). Undo and Redo are custom so they reach the editor's history.
/// Check marks (panels, page size, spelling) are set by the UI through
/// `set_menu_checks`.

#[cfg(target_os = "macos")]
const MOD: &str = "Cmd";
#[cfg(not(target_os = "macos"))]
const MOD: &str = "Ctrl";

/// "Label (Ctrl+K)" on Windows and Linux, "Label (Cmd+K)" on macOS.
fn keyed(label: &str, keys: &str) -> String {
    format!("{label} ({MOD}+{keys})")
}

fn check_item(app: &tauri::App, id: &str, label: &str, on: bool) -> tauri::Result<tauri::menu::CheckMenuItem<tauri::Wry>> {
    tauri::menu::CheckMenuItemBuilder::with_id(id, label).checked(on).build(app)
}

fn file_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;
    // One Import (the format is read from the file) and one Export (a dialog
    // listing every format with its options).
    let file = SubmenuBuilder::new(app, "File")
        .text("new", "New Project…")
        .text("open", keyed("Open…", "O"))
        .text("import", "Import…")
        .text("project_tree", keyed("Episodes and Documents…", "Shift+O"))
        .separator()
        .text("save", keyed("Save", "S"))
        .text("save_as", keyed("Save As…", "Shift+S"))
        .text("export", keyed("Export…", "E"))
        .separator()
        .text("home", "Close Project");
    // On macOS Quit lives in the app menu (Cmd+Q), not in File.
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().text("quit", "Quit");
    file.build()
}

fn edit_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;
    SubmenuBuilder::new(app, "Edit")
        .text("undo", keyed("Undo", "Z"))
        .text("redo", keyed("Redo", "Shift+Z"))
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .text("find", keyed("Find and Replace…", "F"))
        .build()
}

/// Display: modes, tool panels, appearance, going to a place, the window.
/// Check marks are set from preferences at startup.
fn view_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;
    let mode = SubmenuBuilder::new(app, "Mode")
        .item(&check_item(app, "mode_normal", "Normal View", true)?)
        .item(&check_item(app, "mode_page", "Page View", false)?)
        .separator()
        .item(&check_item(app, "view_typewriter", &keyed("Typewriter Mode", "Shift+T"), false)?)
        .text("focus_mode", keyed("Focus Mode", "Shift+F"))
        .item(&check_item(app, "full_screen", "Full Screen (F11)", false)?)
        .build()?;
    // Every panel the writer can show or hide. Later panels (outline, bible,
    // timeline, notes) join here as they are built.
    let tools = SubmenuBuilder::new(app, "Tools")
        .item(&check_item(app, "view_nav", "Scene List", true)?)
        .item(&check_item(app, "view_board", "Board", true)?)
        .item(&check_item(app, "view_notes", "Notes", false)?)
        .text("overview", "Overview…")
        .text("bible", "Bible…")
        .text("timeline", "Timeline…")
        .separator()
        .text("popout_nav", "Scene List in Its Own Window")
        .text("popout_board", "Board in Its Own Window")
        .text("popout_notes", "Notes in Their Own Window")
        .build()?;
    let theme = SubmenuBuilder::new(app, "Theme")
        .item(&check_item(app, "theme_system", "Match System", true)?)
        .separator()
        .item(&check_item(app, "theme_day", "Day", false)?)
        .item(&check_item(app, "theme_night", "Night", false)?)
        .item(&check_item(app, "theme_midnight", "Midnight", false)?)
        .item(&check_item(app, "theme_oled", "OLED (true black)", false)?)
        .build()?;
    let appearance = SubmenuBuilder::new(app, "Appearance")
        .item(&theme)
        .separator()
        .text("ui_larger", keyed("Larger Interface", "="))
        .text("ui_smaller", keyed("Smaller Interface", "-"))
        .text("ui_reset", keyed("Actual Size", "0"))
        .separator()
        .text("ui_contrast", "High Contrast")
        .build()?;
    let go_to = SubmenuBuilder::new(app, "Go To")
        .text("goto_page", keyed("Page…", "G"))
        .text("goto_scene", keyed("Scene…", "Shift+G"))
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .text("win_minimize", "Minimise")
        .text("win_zoom", "Zoom")
        .separator()
        .text("focus_next", "Next Panel (F6)")
        .build()?;
    SubmenuBuilder::new(app, "View")
        .item(&mode)
        .item(&tools)
        .separator()
        .item(&check_item(app, "view_toolbar", "Toolbar", true)?)
        .item(&check_item(app, "view_status", "Status Bar", true)?)
        .separator()
        .item(&appearance)
        .item(&go_to)
        .item(&window)
        .build()
}

/// Text style, elements (same order as Ctrl/Cmd+1 to 9), screen font, page,
/// title page and furniture, production numbering, spelling.
fn format_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;
    let kinds = [
        ("heading", "Scene Heading"),
        ("action", "Action"),
        ("character", "Character"),
        ("parenthetical", "Parenthetical"),
        ("dialogue", "Dialogue"),
        ("transition", "Transition"),
        ("shot", "Shot"),
        ("section", "Section"),
        ("lyric", "Lyric"),
    ];
    let mut block = SubmenuBuilder::new(app, "Element");
    for (i, (id, label)) in kinds.iter().enumerate() {
        block = block.text(format!("kind_{id}"), keyed(label, &(i + 1).to_string()));
    }
    // Writer's markup, on screen only: never printed or exported.
    let mut color = SubmenuBuilder::new(app, "Text Colour (screen only)").text("color_none", "None").separator();
    for c in ["red", "orange", "green", "blue", "purple"] {
        color = color.text(format!("color_{c}"), format!("{}{}", c[..1].to_uppercase(), &c[1..]));
    }
    let mut highlight = SubmenuBuilder::new(app, "Highlight (screen only)").text("highlight_none", "None").separator();
    for c in ["yellow", "green", "blue", "pink", "orange"] {
        highlight = highlight.text(format!("highlight_{c}"), format!("{}{}", c[..1].to_uppercase(), &c[1..]));
    }
    // Screen only: pages and exports always use Courier Prime 12 pt.
    let font = SubmenuBuilder::new(app, "Screen Font")
        .item(&check_item(app, "font_courier-prime", "Courier Prime (standard)", true)?)
        .item(&check_item(app, "font_mono", "System Monospace", false)?)
        .item(&check_item(app, "font_serif", "Serif", false)?)
        .item(&check_item(app, "font_sans", "Sans Serif", false)?)
        .separator()
        .text("font_larger", "Larger Text")
        .text("font_smaller", "Smaller Text")
        .text("font_reset", "Standard Size (12 pt)")
        .build()?;
    let spelling = SubmenuBuilder::new(app, "Spelling")
        .text("spell_suggest", keyed("Suggestions", "."))
        .separator()
        .item(&check_item(app, "spell_en_US", "US English", true)?)
        .item(&check_item(app, "spell_en_GB", "UK English", false)?)
        .item(&check_item(app, "spell_off", "Off", false)?)
        .build()?;
    let page = SubmenuBuilder::new(app, "Page Size")
        .item(&check_item(app, "page_letter", "US Letter", true)?)
        .item(&check_item(app, "page_a4", "A4", false)?)
        .build()?;
    let numbers = SubmenuBuilder::new(app, "Scene Numbers")
        .text("scenes_lock", "Lock Scene Numbers")
        .text("scenes_unlock", "Unlock Scene Numbers…")
        .separator()
        .text("scene_omit", "Omit This Scene")
        .text("scene_restore", "Restore This Scene")
        .build()?;
    let page_lock = SubmenuBuilder::new(app, "Locked Pages")
        .text("pages_lock", "Lock Pages")
        .text("pages_unlock", "Unlock Pages…")
        .build()?;
    let revisions = SubmenuBuilder::new(app, "Revisions")
        .item(&check_item(app, "revision_mode", "Revision Mode", false)?)
        .text("revision_sets", "Revision Sets…")
        .separator()
        .text("revision_clear", "Clear Marks of This Set…")
        .build()?;
    SubmenuBuilder::new(app, "Format")
        .text("bold", keyed("Bold", "B"))
        .text("italic", keyed("Italic", "I"))
        .text("underline", keyed("Underline", "U"))
        .item(&color.build()?)
        .item(&highlight.build()?)
        .separator()
        .item(&block.build()?)
        .text("dual", keyed("Dual Dialogue", "D"))
        .text("page_break", keyed("Page Break Before", "Enter"))
        .item(&font)
        .separator()
        .item(&page)
        .text("title_page", "Title Page…")
        .text("page_furniture", "Headers and Footers…")
        .separator()
        .item(&numbers)
        .item(&page_lock)
        .item(&revisions)
        .separator()
        .item(&spelling)
        .build()
}

fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    let help = SubmenuBuilder::new(app, "Help")
        .text("shortcuts", "Keyboard Shortcuts…")
        .text("latency", "Typing Latency…")
        .separator()
        .text("updates", "Check for Updates…")
        .text("licences", "Licences…");
    #[cfg(not(target_os = "macos"))]
    let help = help.text("about", "About Kolbítar");
    let help = help.build()?;
    let (file, edit, view, format) = (file_menu(app)?, edit_menu(app)?, view_menu(app)?, format_menu(app)?);
    #[cfg(target_os = "macos")]
    {
        // Our own About screen (with the licences) instead of the bare native one.
        // Quit is our own item, not the predefined one: the predefined Quit
        // exits without running the close handler that saves the last edits.
        let quit = tauri::menu::MenuItemBuilder::with_id("quit", "Quit Kolbítar").accelerator("Cmd+Q").build(app)?;
        let app_menu = SubmenuBuilder::new(app, "Kolbítar")
            .text("about", "About Kolbítar")
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&quit)
            .build()?;
        return MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &format, &help]).build();
    }
    #[cfg(not(target_os = "macos"))]
    MenuBuilder::new(app).items(&[&file, &edit, &view, &format, &help]).build()
}

/// Set check marks in the native menu (radio-like groups such as page size
/// and spelling language are sent as one map; unknown ids are ignored).
#[tauri::command]
fn set_menu_checks(app: tauri::AppHandle, checks: std::collections::HashMap<String, bool>) {
    let Some(menu) = app.menu() else { return };
    for (id, on) in checks {
        if let Some(item) = find_check(menu.items().unwrap_or_default(), &id) {
            let _ = item.set_checked(on);
        }
    }
}

/// The menu as a flat list ("File > Export > PDF (proof)", id, check state),
/// so tests can check its structure and check marks.
#[derive(Serialize)]
struct MenuEntry {
    path: String,
    id: String,
    checked: Option<bool>,
}

#[tauri::command]
fn menu_items(app: tauri::AppHandle) -> Vec<MenuEntry> {
    fn walk(items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>, prefix: &str, out: &mut Vec<MenuEntry>) {
        for item in items {
            let (text, checked) = if let Some(c) = item.as_check_menuitem() {
                (c.text().unwrap_or_default(), c.is_checked().ok())
            } else if let Some(m) = item.as_menuitem() {
                (m.text().unwrap_or_default(), None)
            } else if let Some(p) = item.as_predefined_menuitem() {
                (p.text().unwrap_or_default(), None)
            } else if let Some(sub) = item.as_submenu() {
                let path = format!("{prefix}{}", sub.text().unwrap_or_default());
                walk(sub.items().unwrap_or_default(), &format!("{path} > "), out);
                continue;
            } else {
                continue;
            };
            if !text.is_empty() {
                out.push(MenuEntry { path: format!("{prefix}{text}"), id: item.id().as_ref().to_string(), checked });
            }
        }
    }
    let mut out = Vec::new();
    if let Some(menu) = app.menu() {
        walk(menu.items().unwrap_or_default(), "", &mut out);
    }
    out
}

/// Find a check item anywhere in the menu, including nested submenus.
/// Menu item texts with the keyboard shortcuts in force (after the writer
/// rebinds one in Help > Keyboard Shortcuts…). Unknown ids are ignored.
#[tauri::command]
fn set_menu_texts(app: tauri::AppHandle, texts: std::collections::HashMap<String, String>) {
    fn walk(items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>, texts: &std::collections::HashMap<String, String>) {
        for item in items {
            if let Some(t) = texts.get(item.id().as_ref()) {
                if let Some(m) = item.as_menuitem() {
                    let _ = m.set_text(t);
                } else if let Some(c) = item.as_check_menuitem() {
                    let _ = c.set_text(t);
                }
            }
            if let Some(sub) = item.as_submenu() {
                walk(sub.items().unwrap_or_default(), texts);
            }
        }
    }
    if let Some(menu) = app.menu() {
        walk(menu.items().unwrap_or_default(), &texts);
    }
}

fn find_check(items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>, id: &str) -> Option<tauri::menu::CheckMenuItem<tauri::Wry>> {
    for item in items {
        if let Some(c) = item.as_check_menuitem() {
            if c.id().as_ref() == id {
                return Some(c.clone());
            }
        }
        if let Some(sub) = item.as_submenu() {
            if let Some(found) = find_check(sub.items().unwrap_or_default(), id) {
                return Some(found);
            }
        }
    }
    None
}

fn main() {
    use tauri::Emitter;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(App::default())
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            // CIRTH_DATA_DIR lets tests use a throwaway folder.
            let dir = match std::env::var_os("CIRTH_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_local_data_dir()?,
            };
            std::fs::create_dir_all(dir.join("projects"))?;
            *app.state::<App>().data_dir.lock().unwrap() = dir;
            // Pop-out panel windows close with the main window (its close
            // handler has saved by then); otherwise they would keep the app alive.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |ev| {
                    if let tauri::WindowEvent::Destroyed = ev {
                        for (label, w) in handle.webview_windows() {
                            if label.starts_with("panel-") {
                                let _ = w.destroy();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_fixture,
            list_projects,
            create_project,
            open_project,
            open_path,
            forget_recent,
            close_project,
            apply_batch,
            load_document,
            planning_state_now,
            project_tree,
            bible_state,
            timeline_state,
            bible_rename_preview,
            bible_rename_apply,
            navigator_info,
            set_label_name,
            open_document,
            create_folder,
            create_episode,
            rename_item,
            move_item,
            planning_command,
            planning_undo,
            set_board_structural,
            save_package,
            save_as,
            check_outside_change,
            paginate,
            export_pdf,
            process_id,
            about_info,
            ui_prefs,
            set_ui_prefs,
            focus_window,
            window_command,
            open_releases_page,
            peek_file,
            pop_out_panel,
            close_panel_window,
            window_labels,
            set_menu_checks,
            set_menu_texts,
            title_page,
            set_title_page,
            project_notes,
            set_project_notes,
            page_furniture,
            set_page_furniture,
            scene_numbers_command,
            revision_state,
            revision_command,
            page_lock_command,
            import_fountain,
            export_fountain,
            import_fdx,
            export_fdx,
            export_document,
            menu_items,
            document_profile,
            set_document_profile,
            export_txt,
            library_folder,
            list_backups,
            restore_backup,
            count_words,
            word_counts,
            spell_settings,
            set_spelling,
            spell_check,
            spell_suggest,
            spell_add,
            spell_ignore,
            fw_list,
            fw_create_folder,
            fw_rename_folder,
            fw_create,
            fw_get,
            fw_save,
            fw_move,
            fw_trash,
            fw_export,
            fw_note_copied
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kolbítar")
        .run(|handle, event| {
            // Safety net: the window's close handler saves first; if it could
            // not (e.g. the UI was unresponsive), save what the store holds.
            // Edits still waiting in the UI's debounce are not in the store.
            if let tauri::RunEvent::Exit = event {
                let app = handle.state::<App>();
                let mut guard = app.session.lock().unwrap();
                if let Some(s) = guard.as_mut() {
                    let _ = write_session(&app, s, false);
                }
            }
        });
}
