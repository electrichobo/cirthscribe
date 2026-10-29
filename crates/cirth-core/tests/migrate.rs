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

#[test]
fn opening_a_v3_project_adds_scene_numbers_unlocked() {
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v3-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v3-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 3, "fixture must be schema v3");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(3));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v3 copy kept");
        let s = o.store;
        let main = s.default_document().unwrap();
        assert!(!s.scene_numbers_locked(&main).unwrap() && s.scene_numbers(&main).unwrap().is_empty(), "upgraded projects start unlocked");
        assert!(s.lock_scene_numbers(&main).unwrap() > 0, "and can be locked");
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v4_project_adds_revision_sets_with_none_active() {
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v4-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v4-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 4, "fixture must be schema v4");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(4));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v4 copy kept");
        let s = o.store;
        let main = s.default_document().unwrap();
        let before = s.load().unwrap();
        assert!(s.revision_sets(&main).unwrap().is_empty() && s.active_revision(&main).unwrap().is_none() && !s.revision_mode(&main).unwrap());
        assert!(!cirth_core::revisions::any(&before.blocks), "no text is tagged");
        let set = cirth_core::revisions::RevisionSet { id: "r1".into(), label: "Blue Revision".into(), colour: "blue".into(), ..Default::default() };
        s.put_revision_set(&main, &set).unwrap();
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v5_project_adds_scene_labels_with_none_set() {
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v5-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v5-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 5, "fixture must be schema v5");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(5));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v5 copy kept");
        let s = o.store;
        let before = s.load().unwrap();
        assert!(s.scene_labels().unwrap().is_empty(), "no scene has a label yet");
        assert_eq!(s.label_names().unwrap()[0], ("red".to_string(), "Red".to_string()));
        // A label is a planning step: undone exactly; unknown labels refused.
        let scene = before.scenes()[0].scene_id.clone();
        let mut h = PlanningHistory::default();
        let v = s.planning_version().unwrap();
        h.apply(&s, PlanningOp::SetSceneLabel { scene_id: scene.clone(), label: "blue".into() }, v).unwrap();
        assert_eq!(s.scene_label(&scene).unwrap(), "blue");
        h.undo(&s).unwrap();
        assert_eq!(s.scene_label(&scene).unwrap(), "");
        assert!(s.set_scene_label(&scene, "mauve").is_err());
        s.set_label_name("blue", "Act Two").unwrap();
        assert_eq!(s.label_names().unwrap()[4], ("blue".to_string(), "Act Two".to_string()));
        assert_eq!(serde_json::to_string(&s.load().unwrap().blocks).unwrap(), serde_json::to_string(&before.blocks).unwrap(), "the script is untouched");
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v6_project_makes_beats_outline_items_keeping_ids_text_links_and_order() {
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v6-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v6-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 6, "fixture must be schema v6");
        let before: Vec<(String, String, Option<String>, f64)> = {
            let c = rusqlite::Connection::open_with_flags(&pkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            let mut st = c.prepare("SELECT id, summary, scene_id, pos FROM beats ORDER BY pos").unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(|x| x.unwrap()).collect()
        };
        assert!(!before.is_empty());
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(6));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v6 copy kept");
        let s = o.store;
        let after = s.beats().unwrap();
        assert_eq!(after.iter().map(|b| (b.id.clone(), b.summary.clone(), b.scene_id.clone(), b.pos)).collect::<Vec<_>>(), before, "ids, text, links and order kept");
        assert!(after.iter().all(|b| b.kind == "beat" && b.title.is_empty() && b.parent.is_none()), "every old beat is a top-level beat");
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v7_project_adds_an_empty_bible() {
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v7-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v7-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 7, "fixture must be schema v7");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(7));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v7 copy kept");
        let s = o.store;
        assert!(s.entities().unwrap().is_empty() && s.rejected().unwrap().is_empty(), "no entries yet");
        let e = cirth_core::bible::Entity { id: "e1".into(), kind: "location".into(), name: "Counting house".into(), ..Default::default() };
        s.put_entity(&e).unwrap();
        assert_eq!(s.entity("e1").unwrap().unwrap(), e);
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v8_project_adds_an_empty_timeline() {
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    use cirth_core::timeline::StoryEvent;
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v8-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v8-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 8, "fixture must be schema v8");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(8));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v8 copy kept");
        let s = o.store;
        assert!(s.story_events().unwrap().is_empty());
        let before = s.load().unwrap();
        let scene = before.scenes()[0].scene_id.clone();
        // B5: an event moved in the timeline never moves a scene; undo is exact.
        let mut h = PlanningHistory::default();
        let e = StoryEvent { id: "e1".into(), title: "The storm".into(), when: "Day 1, night".into(), pos: 1.0, scenes: vec![scene.clone(), scene.clone()], ..Default::default() };
        let v = s.planning_version().unwrap();
        h.apply(&s, PlanningOp::PutEvent(e.clone()), v).unwrap();
        assert_eq!(s.story_event("e1").unwrap().unwrap().scenes, vec![scene.clone()], "a scene is linked once");
        let v = s.planning_version().unwrap();
        h.apply(&s, PlanningOp::PutEvent(StoryEvent { pos: -4.0, uncertain: true, ..e.clone() }), v).unwrap();
        assert_eq!(serde_json::to_string(&s.load().unwrap().blocks).unwrap(), serde_json::to_string(&before.blocks).unwrap(), "the script never moves");
        h.undo(&s).unwrap();
        assert_eq!(s.story_event("e1").unwrap().unwrap().pos, 1.0);
        h.undo(&s).unwrap();
        assert!(s.story_event("e1").unwrap().is_none());
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

#[test]
fn opening_a_v9_project_adds_an_empty_evidence_board_that_packages_pictures() {
    use cirth_core::evidence::{Bookmark, Card, Thread};
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v9-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v9-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 9, "fixture must be schema v9");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(9));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v9 copy kept");
        let s = o.store;
        assert!(s.cards().unwrap().is_empty() && s.threads().unwrap().is_empty() && s.bookmarks().unwrap().is_empty());
        let before = s.load().unwrap();
        let scene = before.scenes()[0].scene_id.clone();

        // C4: a picture is packaged by its bytes, with no path; a non-picture is refused.
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89".to_vec();
        let (asset, big) = s.add_asset("C:/Users/someone/Pictures/harbour.png", &png).unwrap();
        assert!(!big);
        assert_eq!(s.add_asset("again.png", &png).unwrap().0, asset, "the same picture is stored once");
        assert!(s.add_asset("evil.svg", b"<svg onload=alert(1)>").is_err());
        let mut h = PlanningHistory::default();
        let put = |h: &mut PlanningHistory, op: PlanningOp| {
            let v = s.planning_version().unwrap();
            h.apply(&s, op, v)
        };
        let note = Card { id: "c1".into(), kind: "note".into(), title: "Who took the ledger?".into(), x: 10.0, y: 10.0, ..Default::default() };
        let pic = Card { id: "c2".into(), kind: "image".into(), title: "Harbour".into(), asset: Some(asset.clone()), x: 300.0, y: 10.0, ..Default::default() };
        let clip = Card { id: "c3".into(), kind: "video".into(), title: "Tide reference".into(), url: "https://example.com/tides".into(), x: 10.0, y: 200.0, ..Default::default() };
        let sc = Card { id: "c4".into(), kind: "scene".into(), ref_id: Some(scene.clone()), x: 300.0, y: 200.0, ..Default::default() };
        for c in [&note, &pic, &clip, &sc] {
            put(&mut h, PlanningOp::PutCard(c.clone())).unwrap();
        }
        assert!(put(&mut h, PlanningOp::PutCard(Card { id: "bad".into(), kind: "video".into(), url: "file:///etc/passwd".into(), ..Default::default() })).is_err(), "only http(s) links");
        put(&mut h, PlanningOp::PutThread(Thread { id: "t1".into(), from: "c1".into(), to: "c4".into(), label: "answered in".into() })).unwrap();
        put(&mut h, PlanningOp::PutThread(Thread { id: "t2".into(), from: "c2".into(), to: "c4".into(), label: "looks like".into() })).unwrap();
        assert!(put(&mut h, PlanningOp::PutThread(Thread { id: "t3".into(), from: "c1".into(), to: "c1".into(), label: String::new() })).is_err());
        // Moving a card never moves the script.
        put(&mut h, PlanningOp::PutCard(Card { x: 900.0, ..sc.clone() })).unwrap();
        assert_eq!(serde_json::to_string(&s.load().unwrap().blocks).unwrap(), serde_json::to_string(&before.blocks).unwrap());
        // Deleting a card takes its strings; undo brings both back.
        put(&mut h, PlanningOp::DeleteCard("c4".into())).unwrap();
        assert!(s.threads().unwrap().is_empty());
        h.undo(&s).unwrap();
        assert_eq!(s.threads().unwrap().len(), 2);
        assert_eq!(s.card("c4").unwrap().unwrap().x, 900.0);
        let block = before.blocks[0].id.clone();
        let doc = s.current_document().unwrap();
        put(&mut h, PlanningOp::PutBookmark(Bookmark { id: "b1".into(), name: "Ledger goes missing".into(), document_id: doc, block_id: block })).unwrap();

        // Saved in the project file: the picture's bytes, no path anywhere.
        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
        let raw = std::fs::read(&pkg).unwrap();
        assert!(raw.windows(png.len()).any(|w| w == png.as_slice()), "the picture is inside the project file");
        assert!(!raw.windows(b"someone".len()).any(|w| w == b"someone"), "no absolute path is stored");
        let s = Store::open_package(&pkg, &d.join("work2.db"), None).unwrap().store;
        assert_eq!(s.asset(&asset).unwrap().unwrap().1, png);
        assert_eq!(s.cards().unwrap().len(), 4);
        assert_eq!(s.bookmarks().unwrap()[0].name, "Ledger goes missing");
    }
}

#[test]
fn opening_a_v10_project_adds_empty_breakdown_tags_and_maps_anchors_through_edits() {
    use cirth_core::bible::Entity;
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    use cirth_core::tags::Tag;
    for fixture in ["unicode-marks", "page-boundaries"] {
        let d = tmpdir(&format!("v10-{fixture}"));
        let pkg = d.join(format!("{fixture}.cirth"));
        std::fs::copy(data(&format!("schema-v10-{fixture}.cirth")), &pkg).unwrap();
        let original = std::fs::read(&pkg).unwrap();
        assert_eq!(store::schema_of(&pkg).unwrap(), 10, "fixture must be schema v10");
        let o = Store::open_package(&pkg, &d.join("work.db"), Some(&d.join("backups"))).unwrap();
        assert_eq!(o.migrated_from, Some(10));
        assert_eq!(std::fs::read(o.pre_migration_backup.as_ref().unwrap()).unwrap(), original, "untouched v10 copy kept");
        let mut s = o.store;
        assert!(s.tags().unwrap().is_empty(), "upgraded projects start with no breakdown tags");

        // Add a prop entry with aliases in the bible, then tag a span in the first non-empty block.
        let mut h = PlanningHistory::default();
        let prop = Entity {
            id: "e-prop-1".into(),
            kind: "props".into(),
            name: "Red Ledger".into(),
            aliases: vec!["the ledger".into()],
            ..Default::default()
        };
        let v = s.planning_version().unwrap();
        h.apply(&s, PlanningOp::PutEntity(prop), v).unwrap();

        let doc_id = s.current_document().unwrap();
        let before = s.load().unwrap();
        let target = before.blocks.iter().find(|b| b.text().chars().count() >= 4).unwrap().clone();
        let quote: String = target.text().chars().take(4).collect();
        let tag = Tag {
            id: "t-prop-1".into(),
            document_id: doc_id.clone(),
            block_id: target.id.clone(),
            start: 0,
            end: 4,
            quote: quote.clone(),
            category: "props".into(),
            entity_id: "e-prop-1".into(),
            note: "Hero prop".into(),
            orphaned: false,
        };
        let v = s.planning_version().unwrap();
        h.apply(&s, PlanningOp::PutTag(tag.clone()), v).unwrap();
        assert_eq!(s.tags().unwrap(), vec![tag.clone()]);

        // Typing 3 characters ("🕯️ ") before the tag shifts its Unicode scalar offsets by 3.
        let mut edited = target.clone();
        edited.runs = vec![cirth_core::model::Run::plain(format!("🕯️ {}", target.text()))];
        let sv = s.version().unwrap();
        s.apply(&Batch { tx_id: "edit-pre".into(), base_version: sv, document_id: Some(doc_id.clone()), ops: vec![Op::Update { block: edited }] }).unwrap();
        let shifted = s.tag("t-prop-1").unwrap().unwrap();
        assert_eq!((shifted.start, shifted.end, shifted.quote.as_str(), shifted.orphaned), (3, 7, quote.as_str(), false));

        // Undo the tag creation via PlanningHistory.
        h.undo(&s).unwrap();
        assert!(s.tags().unwrap().is_empty());
        h.redo(&s).unwrap();
        assert_eq!(s.tags().unwrap().len(), 1);

        s.save_package(&pkg).unwrap();
        drop(s);
        assert_eq!(store::schema_of(&pkg).unwrap(), SCHEMA_VERSION);
    }
}

