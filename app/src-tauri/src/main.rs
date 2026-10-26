#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! M0 spike shell. The Rust side owns the canonical document (the working
//! store); the web UI is an editing projection that submits versioned
//! batches. Pagination and PDF are computed here from the canonical store,
//! never from the WebView's DOM.

use cirth_core::fixtures::Fixture;
use cirth_core::layout::{self, PageMap, Profile};
use cirth_core::model::{Beat, Document};
use cirth_core::ops::{Ack, Batch};
use cirth_core::store::{Store, StoreError};
use cirth_core::{fontcheck, pdf};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Manager, State};

struct Session {
    name: String,
    store: Store,
    package: PathBuf,
}

#[derive(Default)]
struct App {
    session: Mutex<Option<Session>>,
    data_dir: Mutex<PathBuf>,
}

#[derive(Serialize)]
struct Opened {
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

fn profile(name: &str) -> Profile {
    if name == "a4" { Profile::a4() } else { Profile::us_letter() }
}

fn paths(app: &App, name: &str) -> (PathBuf, PathBuf) {
    let dir = app.data_dir.lock().unwrap().clone();
    (dir.join("work").join(format!("{name}.work.db")), dir.join("projects").join(format!("{name}.cirth")))
}

fn opened(s: &Session, recovered: bool, migrated_from: Option<i64>, pre_migration_backup: Option<PathBuf>, t0: Instant) -> Result<Opened, String> {
    Ok(Opened {
        name: s.name.clone(),
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

/// Open the project for a fixture. If its package exists it is reopened
/// (with recovery of unsaved work); otherwise, or with `reset`, a new
/// project is seeded from the fixture.
#[tauri::command]
async fn open_fixture(app: State<'_, App>, name: String, reset: bool) -> Result<Opened, String> {
    let t0 = Instant::now();
    let mut guard = app.session.lock().unwrap();
    *guard = None; // release any lock on a previous project
    let (work, package) = paths(&app, &name);
    std::fs::create_dir_all(work.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(package.parent().unwrap()).map_err(|e| e.to_string())?;
    if package.exists() && !reset {
        let o = Store::open_package(&package, &work, Some(&backup_policy(&app).dir)).map_err(err)?;
        let s = Session { name, store: o.store, package };
        let out = opened(&s, o.recovered, o.migrated_from, o.pre_migration_backup, t0)?;
        *guard = Some(s);
        return Ok(out);
    }
    cirth_core::store::remove_store_files(&work).map_err(err)?;
    let fx: Fixture = serde_json::from_str(fixture_source(&name)?).map_err(|e| e.to_string())?;
    let doc = fx.to_document()?;
    let mut store = Store::open(&work).map_err(err)?;
    store.seed(&doc).map_err(err)?;
    // Starter beats for the first scenes so the board has something to show.
    for (i, sc) in doc.scenes().iter().take(12).enumerate() {
        store
            .put_beat(&Beat { id: cirth_core::model::new_id(), summary: format!("Beat {}: (summary is authored planning text)", i + 1), scene_id: Some(sc.scene_id.clone()), pos: i as f64 })
            .map_err(err)?;
    }
    store.save_package(&package).map_err(err)?;
    let s = Session { name, store, package };
    let out = opened(&s, false, None, None, t0)?;
    *guard = Some(s);
    Ok(out)
}

const SAMPLES: [&str; 3] = ["unicode-marks", "page-boundaries", "long-120"];

#[derive(Serialize)]
struct ProjectEntry {
    /// File stem; the project's key in the library folder.
    name: String,
    title: String,
    sample: bool,
    modified_ms: u64,
    blocks: u64,
    scenes: u64,
    saved_version: u64,
    /// The working store holds commits newer than the last package save.
    recoverable: bool,
    backups: usize,
    /// Schema of the file; older ones are upgraded (with a kept copy) when opened.
    schema: i64,
    older_format: bool,
    /// Open in this window right now.
    open: bool,
    error: Option<String>,
}

/// The project library: every `.cirth` in the app's projects folder, newest first.
#[tauri::command]
async fn list_projects(app: State<'_, App>) -> Result<Vec<ProjectEntry>, String> {
    let dir = app.data_dir.lock().unwrap().join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let current = app.session.lock().unwrap().as_ref().map(|s| s.name.clone());
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("cirth") {
            continue;
        }
        let name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let modified_ms = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let open = current.as_deref() == Some(name.as_str());
        let (work, _) = paths(&app, &name);
        let mut e = ProjectEntry { sample: SAMPLES.contains(&name.as_str()), name, title: String::new(), modified_ms, blocks: 0, scenes: 0, saved_version: 0, recoverable: false, backups: 0, schema: 0, older_format: false, open, error: None };
        e.backups = cirth_core::backup::list(&backup_policy(&app).dir, &e.name).len();
        match Store::inspect(&path) {
            Ok(info) => {
                e.title = info.title;
                e.schema = info.schema;
                e.older_format = info.schema < cirth_core::store::SCHEMA_VERSION;
                e.blocks = info.blocks;
                e.scenes = info.scenes;
                e.saved_version = info.saved_version;
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
        out.push(e);
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

fn slug(title: &str) -> String {
    let s: String = title.trim().chars().map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "untitled".into() } else { s.chars().take(60).collect() }
}

/// New empty project starting with one scene heading. Never overwrites:
/// a name already in the library gets a numeric suffix.
#[tauri::command]
async fn create_project(app: State<'_, App>, title: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let title = if title.trim().is_empty() { "Untitled".to_string() } else { title.trim().to_string() };
    let base = slug(&title);
    let mut name = base.clone();
    let mut n = 2;
    while paths(&app, &name).1.exists() || SAMPLES.contains(&name.as_str()) {
        name = format!("{base}-{n}");
        n += 1;
    }
    let mut guard = app.session.lock().unwrap();
    *guard = None;
    let (work, package) = paths(&app, &name);
    std::fs::create_dir_all(work.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(package.parent().unwrap()).map_err(|e| e.to_string())?;
    cirth_core::store::remove_store_files(&work).map_err(err)?;
    let mut store = Store::open(&work).map_err(err)?;
    let doc = Document { title, version: 0, blocks: vec![cirth_core::model::Block::new(cirth_core::model::BlockKind::Heading, "")] };
    store.seed(&doc).map_err(err)?;
    store.save_package(&package).map_err(err)?;
    let s = Session { name, store, package };
    let out = opened(&s, false, None, None, t0)?;
    *guard = Some(s);
    Ok(out)
}

/// Open a project from the library, recovering unsaved working-store commits.
#[tauri::command]
async fn open_project(app: State<'_, App>, name: String) -> Result<Opened, String> {
    let t0 = Instant::now();
    let mut guard = app.session.lock().unwrap();
    *guard = None;
    let (work, package) = paths(&app, &name);
    if !package.exists() {
        return Err(format!("project {name} is not in the library"));
    }
    std::fs::create_dir_all(work.parent().unwrap()).map_err(|e| e.to_string())?;
    let o = Store::open_package(&package, &work, Some(&backup_policy(&app).dir)).map_err(err)?;
    let s = Session { name, store: o.store, package };
    let out = opened(&s, o.recovered, o.migrated_from, o.pre_migration_backup, t0)?;
    *guard = Some(s);
    Ok(out)
}

/// Release the project (and its lock). The working store stays for recovery
/// only if it holds unsaved commits; the UI saves before closing.
#[tauri::command]
async fn close_project(app: State<'_, App>) -> Result<(), String> {
    *app.session.lock().unwrap() = None;
    Ok(())
}

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

#[tauri::command]
async fn save_package(app: State<'_, App>, explicit: Option<bool>) -> Result<Saved, String> {
    save_current(&app, explicit.unwrap_or(false))
}

/// Backup rules (see cirth_core::backup): keep 20, at most one per 10
/// minutes from autosave; an explicit Save always backs up a changed file.
fn backup_policy(app: &App) -> cirth_core::backup::BackupPolicy {
    cirth_core::backup::BackupPolicy { dir: app.data_dir.lock().unwrap().join("backups"), keep: 20, min_interval: std::time::Duration::from_secs(600) }
}

#[derive(Serialize)]
struct Saved {
    version: u64,
    backups: usize,
}

fn save_current(app: &App, explicit: bool) -> Result<Saved, String> {
    let policy = backup_policy(app);
    with_session(app, |s| {
        let version = s.store.save_package_with_backup(&s.package, Some(&policy), std::time::SystemTime::now(), explicit).map_err(err)?;
        Ok(Saved { version, backups: cirth_core::backup::list(&policy.dir, &s.name).len() })
    })
}

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
    let name = with_session(&app, |s| Ok(s.name.clone()))?;
    let dir = app.data_dir.lock().unwrap().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}-v{}-{}.pdf", doc.version, prof.name));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(Exported { path: path.display().to_string(), pages: p.map.pages.len(), doc_version: doc.version, layout_ms: p.layout_ms, pdf_ms, bytes: bytes.len(), missing_glyphs: p.missing_glyphs })
}

/// For the test harness: hard-kill this process in crash tests under any
/// driver (WebDriver does not expose the app's process id).
#[tauri::command]
fn process_id() -> u32 {
    std::process::id()
}

fn main() {
    tauri::Builder::default()
        .manage(App::default())
        .setup(|app| {
            // CIRTH_DATA_DIR lets tests use a throwaway folder.
            let dir = match std::env::var_os("CIRTH_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_local_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            *app.state::<App>().data_dir.lock().unwrap() = dir;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_fixture, list_projects, create_project, open_project, close_project, apply_batch, load_document, put_beat, save_package, paginate, export_pdf, process_id])
        .build(tauri::generate_context!())
        .expect("error while building CirthScribe")
        .run(|handle, event| {
            // Safety net: the window's close handler saves first; if it could
            // not (e.g. the UI was unresponsive), save what the store holds.
            // Edits still waiting in the UI's debounce are not in the store.
            if let tauri::RunEvent::Exit = event {
                let app = handle.state::<App>();
                if app.session.lock().unwrap().is_some() {
                    let _ = save_current(&app, false);
                }
            }
        });
}
