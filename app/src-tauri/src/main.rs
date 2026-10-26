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
    doc: Document,
    beats: Vec<Beat>,
    recovered: bool,
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

fn opened(s: &Session, recovered: bool, t0: Instant) -> Result<Opened, String> {
    Ok(Opened {
        doc: s.store.load().map_err(err)?,
        beats: s.store.beats().map_err(err)?,
        recovered,
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
        let (store, recovered) = Store::open_package(&package, &work).map_err(err)?;
        let s = Session { name, store, package };
        let out = opened(&s, recovered, t0)?;
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
    let out = opened(&s, false, t0)?;
    *guard = Some(s);
    Ok(out)
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
async fn save_package(app: State<'_, App>) -> Result<u64, String> {
    with_session(&app, |s| s.store.save_package(&s.package).map_err(err))
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
        .invoke_handler(tauri::generate_handler![open_fixture, apply_batch, load_document, put_beat, save_package, paginate, export_pdf])
        .run(tauri::generate_context!())
        .expect("error while running CirthScribe");
}
