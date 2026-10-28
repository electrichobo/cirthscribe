use cirth_core::fixtures;
use cirth_core::model::{Beat, Block, BlockKind};
use cirth_core::ops::{Batch, Op};
use cirth_core::store::{Store, StoreError};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn tmpdir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("cirth-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn batch(base: u64, ops: Vec<Op>) -> Batch {
    Batch { tx_id: cirth_core::model::new_id(), base_version: base, document_id: None, ops }
}

#[test]
fn seed_load_roundtrip_keeps_ids_order_and_marks() {
    let d = tmpdir("roundtrip");
    let doc = fixtures::unicode_marks().to_document().unwrap();
    let path = d.join("w.db");
    {
        let mut s = Store::open(&path).unwrap();
        s.seed(&doc).unwrap();
    }
    let s = Store::open(&path).unwrap();
    let back = s.load().unwrap();
    assert_eq!(back.blocks, doc.blocks);
    assert_eq!(back.version, 1);
}

#[test]
fn stale_and_duplicate_batches() {
    let d = tmpdir("stale");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    let b = Block::new(BlockKind::Action, "one");
    let first = batch(0, vec![Op::Put { block: b.clone(), after: None }]);
    assert_eq!(s.apply(&first).unwrap().version, 1);
    // Same tx id again: acknowledged, not applied twice.
    let again = s.apply(&first).unwrap();
    assert!(again.duplicate);
    assert_eq!(s.load().unwrap().blocks.len(), 1);
    // Based on an old version: refused, nothing changes.
    let stale = batch(0, vec![Op::Delete { id: b.id.clone() }]);
    assert!(matches!(s.apply(&stale), Err(StoreError::Stale { base: 0, current: 1 })));
    assert_eq!(s.load().unwrap().blocks.len(), 1);
}

#[test]
fn invalid_batches_roll_back_completely() {
    let d = tmpdir("invalid");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    let h1 = Block::new(BlockKind::Heading, "INT. A - DAY");
    s.apply(&batch(0, vec![Op::Put { block: h1.clone(), after: None }])).unwrap();
    // Second heading reusing the first heading's scene id, plus a valid op before it.
    let ok = Block::new(BlockKind::Action, "valid");
    let mut dup = Block::new(BlockKind::Heading, "INT. B - DAY");
    dup.scene_id = h1.scene_id.clone();
    let r = s.apply(&batch(1, vec![Op::Put { block: ok, after: Some(h1.id.clone()) }, Op::Put { block: dup, after: None }]));
    assert!(matches!(r, Err(StoreError::Invalid(_))), "{r:?}");
    assert_eq!(s.load().unwrap().blocks.len(), 1);
    assert_eq!(s.version().unwrap(), 1);
}

#[test]
fn moves_keep_ids_and_change_order_once() {
    let d = tmpdir("moves");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    let doc = fixtures::long_script(5).to_document().unwrap();
    s.seed(&doc).unwrap();
    let scenes = doc.scenes();
    // Move scene 1's heading block to after the last block.
    let h = doc.blocks.iter().find(|b| b.scene_id.as_ref() == Some(&scenes[0].scene_id)).unwrap().clone();
    let last = doc.blocks.last().unwrap().id.clone();
    s.apply(&batch(1, vec![Op::Put { block: h.clone(), after: Some(last) }])).unwrap();
    let back = s.load().unwrap();
    assert_eq!(back.blocks.last().unwrap().id, h.id);
    assert_eq!(back.blocks.len(), doc.blocks.len());
    back.validate().unwrap();
}

#[test]
fn second_writer_is_refused_in_process_and_cross_process() {
    let d = tmpdir("lock");
    let path = d.join("w.db");
    let s = Store::open(&path).unwrap();
    assert!(matches!(Store::open(&path), Err(StoreError::Locked)));
    drop(s);
    // Another process holds it.
    let mut child = Command::new(env!("CARGO_BIN_EXE_cirth-cli")).args(["hold", path.to_str().unwrap()]).stdout(Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "HOLDING");
    assert!(matches!(Store::open(&path), Err(StoreError::Locked)));
    child.kill().unwrap();
    child.wait().unwrap();
    Store::open(&path).expect("lock released when the holder dies");
}

#[test]
fn killed_process_keeps_every_acknowledged_batch() {
    let d = tmpdir("crash");
    let path = d.join("w.db");
    let mut child = Command::new(env!("CARGO_BIN_EXE_cirth-cli")).args(["crash-writer", path.to_str().unwrap(), "25"]).stdout(Stdio::piped()).spawn().unwrap();
    let mut acked = 0;
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let line = line.unwrap();
        if let Some(v) = line.strip_prefix("ACK ") {
            acked = v.parse().unwrap();
        }
        if line == "HANG" {
            break;
        }
    }
    // Hard kill (TerminateProcess on Windows): no destructors, no clean close.
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(acked, 25);
    let s = Store::open(&path).unwrap();
    assert!(s.integrity_ok().unwrap());
    assert_eq!(s.version().unwrap(), 25);
    let doc = s.load().unwrap();
    assert_eq!(doc.blocks.len(), 25);
    assert_eq!(doc.blocks[24].text(), "acknowledged line 24");
    assert!(s.has_unsaved_work().unwrap(), "recovery must be detectable");
}

#[test]
fn killed_mid_transaction_leaves_previous_state() {
    let d = tmpdir("inflight");
    let path = d.join("w.db");
    {
        let mut s = Store::open(&path).unwrap();
        s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
    }
    let mut child = Command::new(env!("CARGO_BIN_EXE_cirth-cli")).args(["crash-inflight", path.to_str().unwrap()]).stdout(Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "INFLIGHT");
    child.kill().unwrap();
    child.wait().unwrap();
    let s = Store::open(&path).unwrap();
    assert!(s.integrity_ok().unwrap());
    assert_eq!(s.version().unwrap(), 1);
    assert_eq!(s.load().unwrap().blocks.len(), 9);
}

#[test]
fn package_save_is_atomic_and_reopen_detects_recovery() {
    let d = tmpdir("package");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    let doc = fixtures::unicode_marks().to_document().unwrap();
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&doc).unwrap();
        s.put_beat(&Beat { id: "beat-1".into(), logline: "Zoë makes her choice".into(), summary: "Zoë orders".into(), scene_id: doc.scenes().first().map(|x| x.scene_id.clone()), pos: 1.0, ..Default::default() }).unwrap();
        assert_eq!(s.save_package(&pkg).unwrap(), 1);
        assert!(!s.has_unsaved_work().unwrap());
        // A stray temp file from an interrupted save does not disturb the package.
        std::fs::write(pkg.with_extension("cirth.tmp"), b"partial garbage").unwrap();
        // Unsaved edit after the package save.
        let b = Block::new(BlockKind::Action, "written after save");
        let last = doc.blocks.last().unwrap().id.clone();
        s.apply(&batch(1, vec![Op::Put { block: b, after: Some(last) }])).unwrap();
        s.save_package(&pkg).unwrap();
        let b2 = Block::new(BlockKind::Action, "unsaved at crash");
        s.apply(&batch(2, vec![Op::Put { block: b2, after: None }])).unwrap();
        // Dropped here without saving: simulates closing after a crash.
    }
    // Reopen through the package: the working store has newer commits, so it wins.
    let o = Store::open_package(&pkg, &work, None).unwrap();
    let (s, recovered) = (o.store, o.recovered);
    assert!(recovered);
    assert_eq!(s.load().unwrap().blocks[0].text(), "unsaved at crash");
    assert_eq!(s.beats().unwrap().len(), 1);
    assert_eq!(s.beats().unwrap()[0].logline, "Zoë makes her choice", "logline saved and reopened");
    drop(s);
    // Without a newer working store, the package opens as saved.
    cirth_core::store::remove_store_files(&work).unwrap();
    let o = Store::open_package(&pkg, &work, None).unwrap();
    let (s, recovered) = (o.store, o.recovered);
    assert!(!recovered);
    let back = s.load().unwrap();
    assert_eq!(back.version, 2);
    assert_eq!(back.blocks.last().unwrap().text(), "written after save");
}

#[test]
fn inspect_reads_a_package_and_reports_a_locked_working_store() {
    let d = tmpdir("inspect");
    let work = d.join("w.db");
    let pkg = d.join("p.cirth");
    let doc = fixtures::page_boundaries().to_document().unwrap();
    let mut s = Store::open(&work).unwrap();
    s.seed(&doc).unwrap();
    s.save_package(&pkg).unwrap();
    let info = Store::inspect(&pkg).unwrap();
    assert_eq!(info.title, "Page boundary cases");
    assert_eq!((info.blocks, info.scenes, info.version, info.saved_version), (20, 4, 1, 1));
    // The open working store is exclusively locked: inspect must not wait or write.
    assert!(matches!(Store::inspect(&work), Err(StoreError::Locked)));
    drop(s);
    assert_eq!(Store::inspect(&work).unwrap().version, 1);
}

#[test]
fn package_saves_keep_rolling_backups_under_the_policy() {
    use cirth_core::backup::{self, BackupPolicy};
    use std::time::{Duration, UNIX_EPOCH};
    let d = tmpdir("backups");
    let (work, pkg, bdir) = (d.join("w.db"), d.join("tide.cirth"), d.join("backups"));
    let policy = BackupPolicy { dir: bdir.clone(), keep: 3, min_interval: Duration::from_secs(600) };
    let t = |s: u64| UNIX_EPOCH + Duration::from_secs(1_761_454_800 + s);
    let mut s = Store::open(&work).unwrap();
    s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
    let edit = |s: &mut Store, text: &str| {
        let v = s.version().unwrap();
        s.apply(&batch(v, vec![Op::Put { block: Block::new(BlockKind::Action, text), after: None }])).unwrap();
    };
    let versions = |dir: &std::path::Path| backup::list(dir, "tide").iter().map(|b| b.saved_version).collect::<Vec<_>>();

    // First save: nothing to back up yet.
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(0), false).unwrap();
    assert!(versions(&bdir).is_empty());
    // Package (v1) exists now; the next save backs it up.
    edit(&mut s, "two");
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(60), false).unwrap();
    assert_eq!(versions(&bdir), vec![1]);
    // Within min_interval: autosave does not add a backup...
    edit(&mut s, "three");
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(120), false).unwrap();
    assert_eq!(versions(&bdir), vec![1]);
    // ...but an explicit Save does (package was v2).
    edit(&mut s, "four");
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(180), true).unwrap();
    assert_eq!(versions(&bdir), vec![3, 1]);
    // Unchanged project: the backup of that version is made once, not twice.
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(190), true).unwrap();
    s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(200), true).unwrap();
    assert_eq!(versions(&bdir), vec![4, 3, 1]);
    // Rotation keeps the newest three.
    for (i, at) in [900u64, 1800, 2700].into_iter().enumerate() {
        edit(&mut s, &format!("later {i}"));
        s.save_package_with_backup(&pkg, Some((&policy, "tide")), t(at), false).unwrap();
    }
    assert_eq!(versions(&bdir), vec![6, 5, 4]);
    // Every backup is a complete project file holding its version's content.
    for b in backup::list(&bdir, "tide") {
        let info = Store::inspect(&b.path).unwrap();
        assert_eq!(info.saved_version, b.saved_version, "{}", b.file_name);
        assert_eq!(info.blocks, 9 + b.saved_version - 1, "{}", b.file_name);
    }
    assert!(std::fs::read_dir(&bdir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
}

#[test]
fn relocate_moves_the_working_store_with_its_data_and_lock() {
    let d = tmpdir("relocate");
    let (a, b) = (d.join("a.work.db"), d.join("b.work.db"));
    let mut s = Store::open(&a).unwrap();
    s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
    let before = s.load().unwrap();
    s.relocate(&b).unwrap();
    assert_eq!(s.path(), b.as_path());
    assert_eq!(s.load().unwrap().blocks, before.blocks);
    assert_eq!(s.version().unwrap(), before.version);
    assert!(!a.exists() && !d.join("a.work.db-wal").exists(), "nothing left at the old path");
    assert!(matches!(Store::open(&b), Err(StoreError::Locked)), "the lock moved too");
    // Still writable after the move.
    let v = s.version().unwrap();
    s.apply(&batch(v, vec![Op::Put { block: Block::new(BlockKind::Action, "after move"), after: None }])).unwrap();
}

#[test]
fn future_schema_is_refused() {
    let d = tmpdir("future");
    let path = d.join("w.db");
    {
        let c = rusqlite_conn(&path);
        c.execute_batch("PRAGMA user_version = 99;").unwrap();
    }
    assert!(matches!(Store::open(&path), Err(StoreError::FutureSchema(99))));
}

fn rusqlite_conn(p: &std::path::Path) -> rusqlite::Connection {
    rusqlite::Connection::open(p).unwrap()
}

#[test]
fn page_profile_is_stored_per_document_and_saved_with_the_package() {
    let d = tmpdir("profile");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
        let main = s.default_document().unwrap();
        let other = s.create_document("Episode 2").unwrap();
        assert_eq!(s.document_profile(&main).unwrap(), "us-letter");
        s.set_document_profile(&main, "a4").unwrap();
        assert_eq!(s.document_profile(&other).unwrap(), "us-letter", "only that document changes");
        assert!(matches!(s.set_document_profile(&main, "legal"), Err(StoreError::Invalid(_))));
        assert!(matches!(s.set_document_profile("no-such-doc", "a4"), Err(StoreError::Invalid(_))));
        s.save_package(&pkg).unwrap();
    }
    cirth_core::store::remove_store_files(&work).unwrap();
    let s = Store::open_package(&pkg, &work, None).unwrap().store;
    assert_eq!(s.document_profile(&s.default_document().unwrap()).unwrap(), "a4");
}

/// Run `cirth-cli crash-at <point> ...` and hard-kill it once it reports
/// that it stopped at the point (it never gets further).
fn kill_at(point: &str, rest: &[&std::path::Path]) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cirth-cli"))
        .arg("crash-at")
        .arg(point)
        .args(rest.iter().map(|p| p.as_os_str()))
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line).unwrap();
    assert_eq!(line.trim(), format!("AT {point}"), "child did not stop at {point}");
    child.kill().unwrap();
    child.wait().unwrap();
}

#[test]
fn killed_during_package_save_keeps_a_valid_package_and_every_edit() {
    for point in ["snapshot-written", "snapshot-synced", "package-replaced"] {
        let d = tmpdir(&format!("killsave-{point}"));
        let work = d.join("w.db");
        let pkg = d.join("script.cirth");
        let doc = fixtures::unicode_marks().to_document().unwrap();
        {
            let mut s = Store::open(&work).unwrap();
            s.seed(&doc).unwrap();
            assert_eq!(s.save_package(&pkg).unwrap(), 1);
            let b = Block::new(BlockKind::Action, "edited after the first save");
            s.apply(&batch(1, vec![Op::Put { block: b, after: None }])).unwrap();
        }
        let first_save = std::fs::read(&pkg).unwrap();

        kill_at(point, &[std::path::Path::new("save"), &work, &pkg]);

        // The package on disk is a whole file: the old one before the
        // replace, the new one after it. Never a mixture.
        let info = Store::inspect(&pkg).unwrap();
        if point == "package-replaced" {
            assert_eq!(info.saved_version, 2, "{point}");
            assert_eq!(info.blocks as usize, doc.blocks.len() + 1, "{point}");
        } else {
            assert_eq!(std::fs::read(&pkg).unwrap(), first_save, "{point}: package must be untouched before the replace");
        }
        assert!(rusqlite_conn(&pkg).query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap() == "ok");

        // Reopening recovers the edit whichever way the kill fell.
        let o = Store::open_package(&pkg, &work, None).unwrap();
        let s = o.store;
        assert!(s.integrity_ok().unwrap());
        let back = s.load().unwrap();
        assert_eq!(back.blocks[0].text(), "edited after the first save", "{point}");
        assert_eq!(back.blocks.len(), doc.blocks.len() + 1);
        if point != "package-replaced" {
            assert!(o.recovered, "{point}: the unsaved edit must come from the working store");
        }
        // The leftover temp file does not stop the next save.
        assert_eq!(s.save_package(&pkg).unwrap(), 2);
        assert!(!pkg.with_extension("cirth.tmp").exists());
        assert_eq!(Store::inspect(&pkg).unwrap().saved_version, 2);
    }
}

#[test]
fn title_page_is_stored_per_document_and_saved_with_the_package() {
    use cirth_core::title::TitlePage;
    let d = tmpdir("titlepage");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    let tp = TitlePage { title: "THE TIDE LEDGER".into(), credit: "Written by".into(), authors: "Jared Hoy".into(), wga: "1234567".into(), draft_label: "Blue Revision".into(), ..Default::default() };
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
        let main = s.default_document().unwrap();
        let other = s.create_document("Episode 2").unwrap();
        assert!(s.title_page(&main).unwrap().is_empty(), "no title page until written");
        s.set_title_page(&main, &tp).unwrap();
        assert!(s.title_page(&other).unwrap().is_empty(), "only that document has it");
        assert!(matches!(s.set_title_page("no-such-doc", &tp), Err(StoreError::Invalid(_))));
        s.save_package(&pkg).unwrap();
    }
    cirth_core::store::remove_store_files(&work).unwrap();
    let s = Store::open_package(&pkg, &work, None).unwrap().store;
    assert_eq!(s.title_page(&s.default_document().unwrap()).unwrap(), tp, "kept in the project file");
}

#[test]
fn project_notes_are_saved_with_the_package_and_touch_no_document() {
    let d = tmpdir("notes");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    let text = "Call Sam re: the lighthouse.
Zoë's line in 12 → maybe cut?

- ideas: 🌊 storm open";
    let before;
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&fixtures::unicode_marks().to_document().unwrap()).unwrap();
        assert_eq!(s.project_notes().unwrap(), "", "empty until written");
        before = (serde_json::to_string(&s.load().unwrap()).unwrap(), s.version().unwrap());
        s.set_project_notes(text).unwrap();
        assert_eq!((serde_json::to_string(&s.load().unwrap()).unwrap(), s.version().unwrap()), before, "the script and its history are untouched");
        s.save_package(&pkg).unwrap();
    }
    cirth_core::store::remove_store_files(&work).unwrap();
    let s = Store::open_package(&pkg, &work, None).unwrap().store;
    assert_eq!(s.project_notes().unwrap(), text, "kept in the project file, Unicode and line breaks intact");
    assert_eq!(serde_json::to_string(&s.load().unwrap()).unwrap(), before.0);
    assert!(!s.has_unsaved_work().unwrap(), "a freshly opened package has nothing unsaved");

    // Notes written after the last save, then a crash (the working store is
    // left behind): reopening recovers them, as it recovers script edits.
    s.set_project_notes("written after the save").unwrap();
    assert!(s.has_unsaved_work().unwrap(), "a settings change counts as unsaved work");
    drop(s);
    let o = Store::open_package(&pkg, &work, None).unwrap();
    assert!(o.recovered, "the working store is recovered, not replaced by the older file");
    assert_eq!(o.store.project_notes().unwrap(), "written after the save");
    o.store.save_package(&pkg).unwrap();
    assert!(!o.store.has_unsaved_work().unwrap(), "saving clears it");
}

#[test]
fn planning_commands_check_their_base_undo_exactly_and_never_touch_the_script() {
    use cirth_core::model::Beat;
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    let d = tmpdir("planning");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    let mut s = Store::open(&work).unwrap();
    s.seed(&fixtures::page_boundaries().to_document().unwrap()).unwrap();
    s.save_package(&pkg).unwrap();
    let script = (serde_json::to_string(&s.load().unwrap()).unwrap(), s.version().unwrap());
    let scene = s.load().unwrap().blocks.iter().find_map(|b| b.scene_id.clone()).unwrap();
    let mut h = PlanningHistory::default();
    let v0 = s.planning_version().unwrap();

    // A new card, then its text, then a planning-only move.
    let card = Beat { id: "card-1".into(), logline: String::new(), summary: "The storm".into(), scene_id: Some(scene.clone()), pos: 10.0, ..Default::default() };
    let v1 = h.apply(&s, PlanningOp::PutBeat(card.clone()), v0).unwrap();
    let written = Beat { logline: "Ada decides to stay".into(), ..card.clone() };
    let v2 = h.apply(&s, PlanningOp::PutBeat(written.clone()), v1).unwrap();
    let moved = Beat { pos: -5.0, ..written.clone() };
    let v3 = h.apply(&s, PlanningOp::PutBeat(moved.clone()), v2).unwrap();
    assert_eq!((v1, v2, v3), (v0 + 1, v0 + 2, v0 + 3));
    assert!(s.has_unsaved_work().unwrap(), "planning edits count as unsaved work");

    // A command based on an older version is refused and changes nothing.
    let err = h.apply(&s, PlanningOp::DeleteBeat("card-1".into()), v1).unwrap_err();
    assert!(matches!(err, StoreError::Stale { base, current } if base == v1 && current == v3));
    assert_eq!(s.beat("card-1").unwrap(), Some(moved.clone()));

    // Undo steps back exactly; redo replays; a new command clears redo.
    h.undo(&s).unwrap();
    assert_eq!(s.beat("card-1").unwrap(), Some(written.clone()), "undo the move");
    h.undo(&s).unwrap();
    assert_eq!(s.beat("card-1").unwrap(), Some(card.clone()), "undo the text");
    h.undo(&s).unwrap();
    assert_eq!(s.beat("card-1").unwrap(), None, "undo creating it removes it");
    assert_eq!(h.undo(&s).unwrap(), None, "nothing left to undo");
    h.redo(&s).unwrap();
    h.redo(&s).unwrap();
    assert_eq!(s.beat("card-1").unwrap(), Some(written.clone()), "redo twice");
    assert!(h.can_redo());
    let v = s.planning_version().unwrap();
    h.apply(&s, PlanningOp::DeleteBeat("card-1".into()), v).unwrap();
    assert!(!h.can_redo(), "a new command clears redo");
    h.undo(&s).unwrap();
    assert_eq!(s.beat("card-1").unwrap(), Some(written.clone()), "undo a delete restores the card as it was");

    // None of it touched the script or its history.
    assert_eq!((serde_json::to_string(&s.load().unwrap()).unwrap(), s.version().unwrap()), script);

    // A crash after planning edits: the working store is recovered.
    drop(s);
    let o = Store::open_package(&pkg, &work, None).unwrap();
    assert!(o.recovered, "planning edits after the last save are recovered");
    assert_eq!(o.store.beat("card-1").unwrap(), Some(written));
}

#[test]
fn series_tree_folders_and_episodes_each_with_their_own_script_cards_and_numbers() {
    use cirth_core::model::{Beat, Block, BlockKind};
    use cirth_core::ops::{Batch, Op};
    let d = tmpdir("series");
    let work = d.join("w.db");
    let pkg = d.join("series.cirth");
    let (pilot, season, ep1, ep2);
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&fixtures::page_boundaries().to_document().unwrap()).unwrap();
        s.set_title("The Tide Ledger").unwrap();
        pilot = s.default_document().unwrap();
        assert_eq!(s.current_document().unwrap(), pilot, "the default document is current at first");
        let pilot_blocks = serde_json::to_string(&s.load().unwrap().blocks).unwrap();

        // A season folder with two episodes.
        season = s.create_folder("Season 1", None).unwrap();
        ep1 = s.create_episode("Episode 1: Low Water", Some(&season)).unwrap();
        ep2 = s.create_episode("Episode 2: Spring Tide", Some(&season)).unwrap();
        let tree = s.project_tree().unwrap();
        let titles: Vec<(&str, Option<&str>)> = tree.iter().map(|i| (i.title.as_str(), i.parent.as_deref())).collect();
        assert_eq!(titles, vec![("The Tide Ledger", None), ("Season 1", None), ("Episode 1: Low Water", Some(season.as_str())), ("Episode 2: Spring Tide", Some(season.as_str()))]);

        // Open episode 1: edits, cards and numbers are its own.
        s.set_current_document(&ep1).unwrap();
        let ep1_doc = s.load().unwrap();
        assert_eq!(ep1_doc.title, "Episode 1: Low Water");
        assert_eq!(ep1_doc.blocks.len(), 1, "a new episode starts with one empty scene heading");
        assert_eq!(ep1_doc.blocks[0].kind, BlockKind::Heading);
        let base = s.version().unwrap();
        let line = Block::new(BlockKind::Action, "The harbour empties.");
        s.apply(&Batch { tx_id: cirth_core::model::new_id(), base_version: base, document_id: None, ops: vec![Op::Put { block: line.clone(), after: Some(ep1_doc.blocks[0].id.clone()) }] }).unwrap();
        assert_eq!(s.load().unwrap().blocks.len(), 2, "a batch without a document edits the current one");
        let card = Beat { id: "ep1-card".into(), logline: "Low water".into(), summary: String::new(), scene_id: ep1_doc.blocks[0].scene_id.clone(), pos: 1.0, ..Default::default() };
        s.put_beat(&card).unwrap();
        assert_eq!(s.beats().unwrap(), vec![card.clone()], "the board shows this episode's cards only");
        s.lock_scene_numbers(&ep1).unwrap();
        assert_eq!(s.scene_numbers(&ep1).unwrap().len(), 1);
        assert!(s.scene_numbers(&pilot).unwrap().is_empty(), "numbers are per document");

        // The pilot is untouched.
        s.set_current_document(&pilot).unwrap();
        assert_eq!(serde_json::to_string(&s.load().unwrap().blocks).unwrap(), pilot_blocks, "the pilot's script is untouched");
        assert!(s.beats().unwrap().iter().all(|b| b.id != "ep1-card"), "episode cards stay with the episode");

        // Move episode 2 first in the season, then the pilot into the season; a folder never into itself.
        s.move_item(&ep2, Some(&season), 0).unwrap();
        s.move_item(&pilot, Some(&season), 0).unwrap();
        let order: Vec<String> = s.project_tree().unwrap().into_iter().filter(|i| i.parent.as_deref() == Some(season.as_str())).map(|i| i.title).collect();
        assert_eq!(order, vec!["The Tide Ledger", "Episode 2: Spring Tide", "Episode 1: Low Water"]);
        let inner = s.create_folder("Flashbacks", Some(&season)).unwrap();
        assert!(matches!(s.move_item(&season, Some(&inner), 0), Err(StoreError::Invalid(_))), "no folder inside its own folder");
        assert!(matches!(s.move_item(&ep1, Some("no-such-folder"), 0), Err(StoreError::Invalid(_))));

        // Renames are labels: ids stay; the default document's title is the project's.
        s.rename_item(&ep2, "Episode 2: Neap Tide").unwrap();
        s.rename_item(&season, "Series One").unwrap();
        s.rename_item(&pilot, "Tide Ledger (Pilot)").unwrap();
        assert!(matches!(s.rename_item(&ep1, "  "), Err(StoreError::Invalid(_))));
        s.set_current_document(&ep1).unwrap();
        s.save_package(&pkg).unwrap();
    }
    cirth_core::store::remove_store_files(&work).unwrap();
    let s = Store::open_package(&pkg, &work, None).unwrap().store;
    assert_eq!(s.current_document().unwrap(), ep1, "the open episode is kept with the project");
    assert_eq!(s.load().unwrap().blocks.len(), 2);
    let titles: Vec<String> = s.project_tree().unwrap().into_iter().map(|i| i.title).collect();
    assert!(titles.contains(&"Episode 2: Neap Tide".to_string()) && titles.contains(&"Series One".to_string()) && titles.contains(&"Tide Ledger (Pilot)".to_string()), "{titles:?}");
    assert_eq!(s.load_document(&pilot).unwrap().title, "Tide Ledger (Pilot)");
    assert_eq!(s.load_document(&ep2).unwrap().title, "Episode 2: Neap Tide");
}

#[test]
fn outline_items_nest_acts_sequences_and_beats_and_refuse_bad_places() {
    use cirth_core::model::Beat;
    use cirth_core::planning::{PlanningHistory, PlanningOp};
    let d = tmpdir("outline");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    s.seed(&fixtures::page_boundaries().to_document().unwrap()).unwrap();
    let mut h = PlanningHistory::default();
    let put = |h: &mut PlanningHistory, s: &Store, b: &Beat| {
        let v = s.planning_version().unwrap();
        h.apply(s, PlanningOp::PutBeat(b.clone()), v)
    };
    let act = Beat { id: "act-1".into(), kind: "act".into(), title: "Act One".into(), pos: 1.0, ..Default::default() };
    let seq = Beat { id: "seq-1".into(), kind: "sequence".into(), title: "The weighing".into(), parent: Some("act-1".into()), pos: 1.0, ..Default::default() };
    let beat = Beat { id: "b-1".into(), logline: "The scale is wrong".into(), parent: Some("seq-1".into()), pos: 1.0, ..Default::default() };
    put(&mut h, &s, &act).unwrap();
    put(&mut h, &s, &seq).unwrap();
    put(&mut h, &s, &beat).unwrap();
    assert_eq!(s.beat("b-1").unwrap().unwrap().parent.as_deref(), Some("seq-1"));

    // Refused: unknown kinds, a beat as a parent, an act inside anything, a sequence inside a sequence, a loop.
    let bad = [
        Beat { id: "x".into(), kind: "chapter".into(), ..Default::default() },
        Beat { id: "x".into(), parent: Some("b-1".into()), ..Default::default() },
        Beat { id: "x".into(), kind: "act".into(), parent: Some("act-1".into()), ..Default::default() },
        Beat { id: "x".into(), kind: "sequence".into(), parent: Some("seq-1".into()), ..Default::default() },
        Beat { parent: Some("seq-1".into()), ..act.clone() },
        Beat { id: "x".into(), parent: Some("nowhere".into()), ..Default::default() },
    ];
    for b in &bad {
        assert!(matches!(put(&mut h, &s, b), Err(StoreError::Invalid(_))), "refused: {b:?}");
    }
    assert!(matches!(put(&mut h, &s, &Beat { kind: "beat".into(), ..act.clone() }), Err(StoreError::Invalid(_))), "an act holding items cannot become a beat");
    let v = s.planning_version().unwrap();
    assert!(matches!(h.apply(&s, PlanningOp::DeleteBeat("seq-1".into()), v), Err(StoreError::Invalid(_))), "a sequence holding a beat cannot be deleted");

    // Out of the sequence to the top level, then undone: back where it was.
    put(&mut h, &s, &Beat { parent: None, pos: 9.0, ..beat.clone() }).unwrap();
    assert_eq!(s.beat("b-1").unwrap().unwrap().parent, None);
    h.undo(&s).unwrap();
    assert_eq!(s.beat("b-1").unwrap().unwrap(), beat);
    let all = s.beats().unwrap();
    assert_eq!(all.iter().filter(|b| b.kind == "beat").count(), 1);
}

#[test]
fn scene_numbers_lock_keep_through_edits_take_letters_and_omit() {
    let d = tmpdir("scenenumbers");
    let work = d.join("w.db");
    let pkg = d.join("script.cirth");
    let doc = fixtures::page_boundaries().to_document().unwrap();
    let scenes: Vec<String> = doc.blocks.iter().filter_map(|b| b.scene_id.clone()).collect();
    assert!(scenes.len() >= 3);
    {
        let mut s = Store::open(&work).unwrap();
        s.seed(&doc).unwrap();
        let main = s.default_document().unwrap();
        assert!(!s.scene_numbers_locked(&main).unwrap() && s.scene_numbers(&main).unwrap().is_empty(), "no numbers until locked");
        assert_eq!(s.number_new_scenes(&main).unwrap(), 0, "unlocked: nothing is numbered");
        assert_eq!(s.lock_scene_numbers(&main).unwrap(), scenes.len());
        let n = s.scene_numbers(&main).unwrap();
        assert_eq!(scenes.iter().map(|id| n[id].number.as_str()).collect::<Vec<_>>(), (1..=scenes.len()).map(|i| i.to_string()).collect::<Vec<_>>().iter().map(|s| s.as_str()).collect::<Vec<_>>());
        // Add a scene after the first one and one before everything: 1A and A1.
        let first_heading = doc.blocks.iter().position(|b| b.scene_id.as_deref() == Some(&scenes[0])).unwrap();
        let after = doc.blocks[first_heading].id.clone();
        let new_mid = Block::new(BlockKind::Heading, "INT. NEW ROOM - DAY");
        let new_top = Block::new(BlockKind::Heading, "EXT. NEW OPENING - DAWN");
        let (mid_id, top_id) = (new_mid.scene_id.clone().unwrap(), new_top.scene_id.clone().unwrap());
        s.apply(&batch(1, vec![Op::Put { block: new_mid, after: Some(after) }, Op::Put { block: new_top, after: None }])).unwrap();
        assert_eq!(s.number_new_scenes(&main).unwrap(), 2);
        let n = s.scene_numbers(&main).unwrap();
        assert_eq!((n[&mid_id].number.as_str(), n[&top_id].number.as_str()), ("1A", "A1"));
        assert_eq!(n[&scenes[1]].number, "2", "existing numbers never change");
        // Omit scene 2, then restore it; unknown scenes cannot be omitted.
        s.set_scene_omitted(&main, &scenes[1], true).unwrap();
        assert!(s.scene_numbers(&main).unwrap()[&scenes[1]].omitted);
        assert!(s.set_scene_omitted(&main, "no-such-scene", true).is_err());
        s.save_package(&pkg).unwrap();
    }
    cirth_core::store::remove_store_files(&work).unwrap();
    let s = Store::open_package(&pkg, &work, None).unwrap().store;
    let main = s.default_document().unwrap();
    assert!(s.scene_numbers_locked(&main).unwrap());
    let n = s.scene_numbers(&main).unwrap();
    assert!(n[&scenes[1]].omitted && n[&scenes[1]].number == "2", "kept in the project file");
    s.set_scene_omitted(&main, &scenes[1], false).unwrap();
    s.unlock_scene_numbers(&main).unwrap();
    assert!(!s.scene_numbers_locked(&main).unwrap() && s.scene_numbers(&main).unwrap().is_empty(), "unlock removes the numbers");
}

#[test]
fn revision_sets_are_kept_and_a_used_set_cannot_be_deleted() {
    use cirth_core::revisions::RevisionSet;
    let d = tmpdir("revisions");
    let mut s = Store::open(&d.join("w.db")).unwrap();
    s.seed(&fixtures::page_boundaries().to_document().unwrap()).unwrap();
    let main = s.default_document().unwrap();
    assert!(s.set_revision_mode(&main, true).is_err(), "no mode without a set");
    let blue = RevisionSet { id: "blue-1".into(), label: "Blue Revision".into(), colour: "blue".into(), date: "2026-10-27".into(), mark: "*".into(), author: "".into() };
    s.put_revision_set(&main, &blue).unwrap();
    assert!(s.put_revision_set(&main, &RevisionSet { id: "x".into(), label: "X".into(), colour: "mauve".into(), ..Default::default() }).is_err(), "unknown colour refused");
    s.set_active_revision(&main, Some("blue-1")).unwrap();
    s.set_revision_mode(&main, true).unwrap();
    assert!(s.revision_mode(&main).unwrap());
    // Rename in place; order and id stay.
    s.put_revision_set(&main, &RevisionSet { label: "Blue Rev.".into(), ..blue.clone() }).unwrap();
    assert_eq!(s.revision_sets(&main).unwrap().len(), 1);
    assert_eq!(s.active_revision(&main).unwrap().unwrap().label, "Blue Rev.");
    // Tag some text with it: deleting is refused until the text is untagged.
    let doc = s.load().unwrap();
    let mut b = doc.blocks[1].clone();
    b.runs[0].revision = Some("blue-1".into());
    s.apply(&batch(doc.version, vec![Op::Update { block: b.clone() }])).unwrap();
    assert!(s.delete_revision_set(&main, "blue-1").is_err());
    b.runs[0].revision = None;
    s.apply(&batch(doc.version + 1, vec![Op::Update { block: b }])).unwrap();
    s.delete_revision_set(&main, "blue-1").unwrap();
    assert!(s.revision_sets(&main).unwrap().is_empty());
    assert!(s.active_revision(&main).unwrap().is_none() && !s.revision_mode(&main).unwrap(), "deleting the active set ends revision mode");
}

#[test]
fn page_lock_is_kept_refuses_a_second_lock_and_a_page_size_change() {
    let d = tmpdir("page-lock");
    let pkg = d.join("locked.cirth");
    let doc = fixtures::page_boundaries().to_document().unwrap();
    let p = cirth_core::layout::Profile::us_letter();
    {
        let mut s = Store::open(&d.join("w.db")).unwrap();
        s.seed(&doc).unwrap();
        let main = s.default_document().unwrap();
        assert!(s.page_lock(&main).unwrap().is_none());
        let map = cirth_core::layout::paginate(&s.load().unwrap().blocks, &p, 1);
        assert_eq!(s.lock_pages(&main, &map).unwrap(), map.pages.len());
        assert!(s.lock_pages(&main, &map).is_err(), "already locked");
        assert!(s.set_document_profile(&main, "a4").is_err(), "page size fixed while locked");
        s.set_document_profile(&main, "us-letter").unwrap();
        s.save_package(&pkg).unwrap();
    }
    let o = Store::open_package(&pkg, &d.join("w2.db"), None).unwrap();
    let main = o.store.default_document().unwrap();
    let lock = o.store.page_lock(&main).unwrap().expect("kept in the file");
    assert_eq!(lock.labels.first().map(String::as_str), Some("1"));
    o.store.unlock_pages(&main).unwrap();
    assert!(o.store.page_lock(&main).unwrap().is_none());
    o.store.set_document_profile(&main, "a4").unwrap();
}
