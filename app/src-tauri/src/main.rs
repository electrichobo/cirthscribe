#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! CirthScribe shell. The Rust side owns the canonical document (the working
//! store); the web UI is an editing projection that submits versioned
//! batches. Pagination and PDF are computed here from the canonical store,
//! never from the WebView's DOM.
//!
//! Project files: a project is a `.cirth` file anywhere on disk (the app's
//! library folder, or any folder via Open / Save As). Each open file has a
//! working store in the app's data folder, keyed by the file's path, which
//! is the crash-recovery journal. Writing the file is conflict-safe: if the
//! file changed outside CirthScribe since we last read or wrote it, our
//! version goes to a "(conflict ...)" copy beside it and the other version
//! is left untouched.

use cirth_core::fixtures::Fixture;
use cirth_core::fsutil::FileStamp;
use cirth_core::layout::{self, PageMap, Profile};
use cirth_core::model::{Beat, Document};
use cirth_core::ops::{Ack, Batch};
use cirth_core::store::{Store, StoreError};
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
    Ok(Opened {
        name: s.key.clone(),
        doc: s.store.load().map_err(err)?,
        beats: s.store.beats().map_err(err)?,
        recovered,
        migrated_from,
        pre_migration_backup: pre_migration_backup.map(|p| p.display().to_string()),
        saved_version: s.store.saved_version().map_err(err)?,
        work_path: s.store.path().display().to_string(),
        package_path: s.package.display().to_string(),
        open_ms: t0.elapsed().as_secs_f64() * 1e3,
    })
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
    let s = Session { key, store: o.store, package: normalize(pkg), stamp: Some(FileStamp::of(pkg).map_err(io_err)?), speller: None };
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
    let s = Session { key, store, stamp: Some(FileStamp::of(&pkg).map_err(io_err)?), package: normalize(&pkg), speller: None };
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
        .map(|(i, sc)| Beat { id: cirth_core::model::new_id(), summary: format!("Beat {}: (summary is authored planning text)", i + 1), scene_id: Some(sc.scene_id.clone()), pos: i as f64 })
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
    let base = slug(&title);
    let mut name = base.clone();
    let mut n = 2;
    while library_path(&app, &name).exists() || SAMPLES.contains(&name.as_str()) {
        name = format!("{base}-{n}");
        n += 1;
    }
    let doc = Document { title, version: 0, blocks: vec![cirth_core::model::Block::new(cirth_core::model::BlockKind::Heading, "")] };
    start_new(&app, library_path(&app, &name), &doc, &[], t0)
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
    with_session(&app, |s| s.store.apply(&batch).map_err(err))
}

#[tauri::command]
async fn load_document(app: State<'_, App>) -> Result<Document, String> {
    with_session(&app, |s| s.store.load().map_err(err))
}

#[tauri::command]
async fn put_beat(app: State<'_, App>, beat: Beat) -> Result<(), String> {
    with_session(&app, |s| s.store.put_beat(&beat).map_err(err))
}

// --- Saving -------------------------------------------------------------------------

#[derive(Serialize)]
struct Saved {
    version: u64,
    backups: usize,
    /// Where the project now lives (changes after Save As or a conflict).
    path: String,
    name: String,
    /// The file had changed outside CirthScribe: our version was written here
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

/// Has the open project's file changed outside CirthScribe since we last
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
}

fn paginate_current(app: &App, profile_name: &str) -> Result<(Paginated, Document), String> {
    let t0 = Instant::now();
    // Hold the lock only while reading the canonical document.
    let doc = with_session(app, |s| s.store.load().map_err(err))?;
    let t1 = Instant::now();
    let map = layout::paginate(&doc.blocks, &profile(profile_name), doc.version);
    let t2 = Instant::now();
    let font = fontcheck::FontInfo::parse(pdf::REGULAR).ok_or("bundled font unreadable")?;
    let all: String = doc.blocks.iter().map(|b| b.text()).collect::<Vec<_>>().join(" ");
    let missing_glyphs = fontcheck::missing_chars(&font, &all);
    Ok((Paginated { map, load_ms: (t1 - t0).as_secs_f64() * 1e3, layout_ms: (t2 - t1).as_secs_f64() * 1e3, missing_glyphs }, doc))
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
}

#[tauri::command]
async fn export_pdf(app: State<'_, App>, profile_name: String) -> Result<Exported, String> {
    let (p, doc) = paginate_current(&app, &profile_name)?;
    let prof = profile(&profile_name);
    let t0 = Instant::now();
    let bytes = pdf::render(&p.map, &prof, &doc.title)?;
    let pdf_ms = t0.elapsed().as_secs_f64() * 1e3;
    let name = with_session(&app, |s| Ok(s.key.clone()))?;
    let dir = data_dir(&app).join("exports");
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    let path = dir.join(format!("{name}-v{}-{}.pdf", doc.version, prof.name));
    std::fs::write(&path, &bytes).map_err(io_err)?;
    Ok(Exported { path: path.display().to_string(), pages: p.map.pages.len(), doc_version: doc.version, layout_ms: p.layout_ms, pdf_ms, bytes: bytes.len(), missing_glyphs: p.missing_glyphs })
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

/// Native menu. Items carry no OS accelerators: shortcuts are handled in the
/// web UI so they behave the same on every platform and in tests. Choices are
/// sent to the UI as a "menu" event and run the same actions as the buttons.
/// macOS also gets the standard app menu and an Edit menu (WKWebView needs
/// it for Cmd+C/V); Undo/Redo there are custom so they reach the editor's
/// history, not the WebView's native undo.
fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    let file = SubmenuBuilder::new(app, "File")
        .text("new", "New Project…")
        .text("open", "Open…")
        .separator()
        .text("save", "Save")
        .text("save_as", "Save As…")
        .text("export_pdf", "Export PDF (proof)")
        .separator()
        .text("home", "Close Project")
        .text("quit", "Quit")
        .build()?;
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "CirthScribe").about(None).separator().services().separator().hide().hide_others().show_all().build()?;
        let edit = SubmenuBuilder::new(app, "Edit")
            .text("undo", "Undo")
            .text("redo", "Redo")
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .separator()
            .text("find", "Find and Replace…")
            .separator()
            .text("dual", "Dual Dialogue")
            .text("page_break", "Page Break Before")
            .build()?;
        return MenuBuilder::new(app).items(&[&app_menu, &file, &edit]).build();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let edit = SubmenuBuilder::new(app, "Edit").text("find", "Find and Replace…").separator().text("dual", "Dual Dialogue").text("page_break", "Page Break Before").build()?;
        MenuBuilder::new(app).items(&[&file, &edit]).build()
    }
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
            put_beat,
            save_package,
            save_as,
            check_outside_change,
            paginate,
            export_pdf,
            process_id,
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
        .expect("error while building CirthScribe")
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
