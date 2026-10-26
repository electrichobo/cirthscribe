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
        s.put_beat(&Beat { id: "beat-1".into(), summary: "Zoë orders".into(), scene_id: doc.scenes().first().map(|x| x.scene_id.clone()), pos: 1.0 }).unwrap();
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
