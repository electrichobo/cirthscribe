//! Schema migration tests against real project files written by the schema
//! v1 code (tests/data/schema-v1-*.cirth, frozen in commit 59859cc).

use cirth_core::model::{Block, BlockKind};
use cirth_core::ops::{Batch, Op};
use cirth_core::store::{self, SCHEMA_VERSION, Store, StoreError};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

fn tmpdir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("cirth-migrate-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn data(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data").join(name)
}

/// Copy a frozen v1 file into a scratch folder (tests never touch the original).
fn v1_copy(d: &Path, fixture: &str) -> PathBuf {
    let p = d.join(format!("{fixture}.cirth"));
    std::fs::copy(data(&format!("schema-v1-{fixture}.cirth")), &p).unwrap();
    p
}

/// What the v1 file says, read with plain SQL (independent of Store).
struct V1 {
    blocks: Vec<(String, String, String, Option<String>)>,
    beats: Vec<(String, String, Option<String>)>,
    title: String,
    version: u64,
    oplog: i64,
}

fn read_v1(p: &Path) -> V1 {
    let c = Connection::open_with_flags(p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let v: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
    assert_eq!(v, 1, "fixture must be schema v1");
    let blocks = c
        .prepare("SELECT id, kind, runs, scene_id FROM blocks ORDER BY ord")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let beats = c
        .prepare("SELECT id, summary, scene_id FROM beats ORDER BY pos")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let meta = |k: &str| -> String { c.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get(0)).unwrap() };
    V1 { blocks, beats, title: meta("title"), version: meta("version").parse().unwrap(), oplog: c.query_row("SELECT COUNT(*) FROM oplog", [], |r| r.get(0)).unwrap() }
}

/// Tables and their columns, to compare a fresh database with a migrated one.
fn shape(p: &Path) -> Vec<String> {
    let c = Connection::open_with_flags(p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let tables: Vec<String> = c
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let mut out = Vec::new();
    for t in tables {
        let cols: Vec<String> = c
            .prepare(&format!("SELECT name || ':' || type || ':' || \"notnull\" FROM pragma_table_info('{t}')"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        out.push(format!("{t}({})", cols.join(",")));
    }
    out
}

#[test]
fn opening_a_v1_project_upgrades_the_working_copy_and_keeps_the_original() {
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(fixture);
        let pkg = v1_copy(&d, fixture);
        let original = std::fs::read(&pkg).unwrap();
        let before = read_v1(&pkg);
        assert_eq!(Store::inspect(&pkg).unwrap().schema, 1, "Home can read and flag old files");

        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(1));
        assert!(!o.recovered);
        // The untouched original was kept, and the package is not rewritten by opening.
        let backup = o.pre_migration_backup.clone().expect("pre-migration backup");
        assert_eq!(std::fs::read(&backup).unwrap(), original, "{}", backup.display());
        assert!(backup.file_name().unwrap().to_string_lossy().starts_with(&format!("{fixture}--pre-schema-v{SCHEMA_VERSION}--")));
        assert_eq!(std::fs::read(&pkg).unwrap(), original, "opening must not modify the package");

        let s = o.store;
        // Same blocks, same ids, same order, same text and marks, same scenes.
        let doc = s.load().unwrap();
        let got: Vec<(String, String, String, Option<String>)> =
            doc.blocks.iter().map(|b| (b.id.clone(), b.kind.as_str().to_string(), serde_json::to_string(&b.runs).unwrap(), b.scene_id.clone())).collect();
        assert_eq!(got, before.blocks, "{fixture}: blocks changed in migration");
        doc.validate().unwrap();
        let beats: Vec<(String, String, Option<String>)> = s.beats().unwrap().into_iter().map(|b| (b.id, b.summary, b.scene_id)).collect();
        assert_eq!(beats, before.beats);
        assert_eq!(doc.version, before.version, "document version unchanged");
        // One default document titled like the project.
        let docs = s.documents().unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].0, s.default_document().unwrap());
        assert_eq!(docs[0].1, before.title);
        // Saving writes the package in the new format; reopening needs no migration.
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
        let oplog: i64 = Connection::open(&pkg).unwrap().query_row("SELECT COUNT(*) FROM oplog", [], |r| r.get(0)).unwrap();
        assert_eq!(oplog, before.oplog, "op history kept");
        store::remove_store_files(&d.join("work.db")).unwrap();
        let again = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(again.migrated_from, None);
        assert!(again.pre_migration_backup.is_none());
    }
}

#[test]
fn reopening_an_unsaved_v1_project_keeps_one_pre_migration_copy() {
    let d = tmpdir("dedupe");
    let pkg = v1_copy(&d, "unicode-marks");
    let bdir = d.join("backups");
    for _ in 0..3 {
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&bdir)).unwrap();
        assert_eq!(o.migrated_from, Some(1));
        drop(o);
        store::remove_store_files(&d.join("work.db")).unwrap();
    }
    assert_eq!(std::fs::read_dir(&bdir).unwrap().count(), 1);
    // Pre-migration copies are outside backup rotation.
    assert!(cirth_core::backup::list(&bdir, "unicode-marks").is_empty());
}

#[test]
fn recovering_unsaved_work_from_an_old_working_copy_also_migrates() {
    let d = tmpdir("recover-old");
    let pkg = v1_copy(&d, "unicode-marks");
    // A v1-era working copy with an unsaved edit: same project, version ahead of saved.
    let work = d.join("work.db");
    std::fs::copy(&pkg, &work).unwrap();
    {
        let c = Connection::open(&work).unwrap();
        let v: u64 = c.query_row("SELECT value FROM meta WHERE key = 'version'", [], |r| r.get::<_, String>(0)).unwrap().parse().unwrap();
        c.execute("INSERT INTO blocks(id, ord, kind, runs) VALUES ('unsaved-v1-block', 1e6, 'action', '[{\"text\":\"typed before the upgrade\"}]')", []).unwrap();
        c.execute("UPDATE meta SET value = ?1 WHERE key = 'version'", [(v + 1).to_string()]).unwrap();
    }
    let o = Store::open_package(&pkg, &work, Some(&d.join("backups"))).unwrap();
    assert!(o.recovered);
    assert_eq!(o.migrated_from, Some(1));
    assert!(o.pre_migration_backup.is_some());
    assert_eq!(o.store.load().unwrap().blocks.last().unwrap().text(), "typed before the upgrade");
}

#[test]
fn new_and_upgraded_projects_have_the_same_schema() {
    let d = tmpdir("shape");
    let fresh = d.join("fresh.db");
    drop(Store::open(&fresh).unwrap());
    let pkg = v1_copy(&d, "page-boundaries");
    let o = Store::open_package(&pkg, &d.join("work.db"), None).unwrap();
    o.store.save_package(&d.join("upgraded.cirth")).unwrap();
    drop(o);
    assert_eq!(shape(&fresh), shape(&d.join("upgraded.cirth")));
    assert_eq!(store::schema_of(&fresh).unwrap(), SCHEMA_VERSION);
}

#[test]
fn documents_are_separate_and_cross_document_moves_are_refused() {
    let d = tmpdir("docs");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    let main = s.default_document().unwrap();
    let other = s.create_document("Episode 2").unwrap();
    let a = Block::new(BlockKind::Action, "in main");
    let b = Block::new(BlockKind::Action, "in episode 2");
    let v = s.version().unwrap();
    s.apply(&Batch { tx_id: "a".into(), base_version: v, document_id: None, ops: vec![Op::Put { block: a.clone(), after: None }] }).unwrap();
    s.apply(&Batch { tx_id: "b".into(), base_version: v + 1, document_id: Some(other.clone()), ops: vec![Op::Put { block: b.clone(), after: None }] }).unwrap();
    assert_eq!(s.load_document(&main).unwrap().blocks, vec![a.clone()]);
    assert_eq!(s.load_document(&other).unwrap().blocks, vec![b.clone()]);
    // Anchors must be in the same document; moving across documents is refused, atomically.
    let r = s.apply(&Batch { tx_id: "c".into(), base_version: v + 2, document_id: Some(other.clone()), ops: vec![Op::Put { block: a.clone(), after: Some(b.id.clone()) }] });
    assert!(matches!(r, Err(StoreError::Invalid(ref m)) if m.contains("another document")), "{r:?}");
    let r = s.apply(&Batch { tx_id: "d".into(), base_version: v + 2, document_id: Some("nope".into()), ops: vec![] });
    assert!(matches!(r, Err(StoreError::Invalid(ref m)) if m.contains("unknown document")), "{r:?}");
    assert_eq!(s.version().unwrap(), v + 2);
    // Settings are scoped.
    s.set_setting("project", "profile", "a4").unwrap();
    s.set_setting(&other, "profile", "letter").unwrap();
    assert_eq!(s.setting("project", "profile").unwrap().as_deref(), Some("a4"));
    assert_eq!(s.setting(&other, "profile").unwrap().as_deref(), Some("letter"));
}

#[test]
fn a_newer_schema_is_refused_without_touching_the_file() {
    let d = tmpdir("future-pkg");
    let pkg = v1_copy(&d, "unicode-marks");
    Connection::open(&pkg).unwrap().execute_batch("PRAGMA user_version = 99;").unwrap();
    let before = std::fs::read(&pkg).unwrap();
    assert!(matches!(Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))), Err(StoreError::FutureSchema(99))));
    assert!(matches!(Store::inspect(&pkg), Err(StoreError::FutureSchema(99))));
    assert_eq!(std::fs::read(&pkg).unwrap(), before);
    assert!(!d.join("work.db").exists() && !d.join("backups").exists());
}

#[test]
fn killed_during_migration_leaves_the_original_and_reopens_cleanly() {
    let d = tmpdir("killed");
    let pkg = v1_copy(&d, "unicode-marks");
    let original = std::fs::read(&pkg).unwrap();
    let before = read_v1(&pkg);
    let (work, backups) = (d.join("work.db"), d.join("backups"));

    // Stop inside the migration transaction (all steps run, not committed), then kill.
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_cirth-cli"))
        .args(["crash-at", "migration-uncommitted", "open"])
        .args([&pkg, &work, &backups])
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(child.stdout.as_mut().unwrap()), &mut line).unwrap();
    assert_eq!(line.trim(), "AT migration-uncommitted");
    child.kill().unwrap();
    child.wait().unwrap();

    // The project file and the pre-migration copy are untouched.
    assert_eq!(std::fs::read(&pkg).unwrap(), original);
    let kept: Vec<_> = std::fs::read_dir(&backups).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(std::fs::read(&kept[0]).unwrap(), original);
    // The half-done working copy rolled back to v1.
    assert_eq!(store::schema_of(&work).unwrap(), 1, "the uncommitted migration must not survive");

    // Opening again migrates from scratch, with the same content and one backup.
    let o = Store::open_package(&pkg, &work, Some(&backups)).unwrap();
    assert_eq!(o.migrated_from, Some(1));
    let s = o.store;
    assert!(s.integrity_ok().unwrap());
    let ids: Vec<String> = s.load().unwrap().blocks.iter().map(|b| b.id.clone()).collect();
    assert_eq!(ids, before.blocks.iter().map(|b| b.0.clone()).collect::<Vec<_>>());
    assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1, "no duplicate pre-migration copy");
}

#[test]
fn opening_a_v2_project_adds_loglines_and_keeps_everything_else() {
    // tests/data/schema-v2-*.cirth were written by the schema v2 code (frozen
    // just before the v3 change), like the v1 files.
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v2-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v2-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 2, "fixture must be schema v2");
        let before: Vec<(String, String, Option<String>)> = Connection::open_with_flags(&pkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap()
            .prepare("SELECT id, summary, scene_id FROM beats ORDER BY pos")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(!before.is_empty());

        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(2));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v2 copy kept");
        assert_eq!(std::fs::read(&pkg).unwrap(), original, "opening must not modify the package");
        let s = o.store;
        let after = s.beats().unwrap();
        assert_eq!(after.iter().map(|b| (b.id.clone(), b.summary.clone(), b.scene_id.clone())).collect::<Vec<_>>(), before, "beats unchanged");
        assert!(after.iter().all(|b| b.logline.is_empty()), "existing beats get an empty logline");
        // A logline can be written and survives saving in the new format.
        let mut b = after[0].clone();
        b.logline = "The deal goes wrong".into();
        s.put_beat(&b).unwrap();
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
        store::remove_store_files(&d.join("work.db")).unwrap();
        let again = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(again.migrated_from, None);
        assert_eq!(again.store.beats().unwrap()[0].logline, "The deal goes wrong");
    }
}
