//! Developer CLI for the M0 spike: fixture generation, PDF rendering and the
//! crash-recovery harness (a separate process that the tests kill).

use cirth_core::{fixtures, layout, model::Block, model::BlockKind, ops::Batch, ops::Op, pdf, store::Store};
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let arg = |i: usize| PathBuf::from(args.get(i).unwrap_or_else(|| panic!("missing argument {i}")));
    match cmd {
        "gen-fixtures" => {
            let dir = arg(1);
            std::fs::create_dir_all(&dir).unwrap();
            for (name, f) in [
                ("long-120.json", fixtures::long_script(120)),
                ("page-boundaries.json", fixtures::page_boundaries()),
                ("unicode-marks.json", fixtures::unicode_marks()),
            ] {
                std::fs::write(dir.join(name), serde_json::to_string_pretty(&f).unwrap()).unwrap();
                let doc = f.to_document().unwrap();
                let map = layout::paginate(&doc.blocks, &layout::Profile::us_letter(), 0);
                println!("{name}: {} blocks, {} scenes, {} pages", doc.blocks.len(), doc.scenes().len(), map.pages.len());
            }
        }
        "pdf" => {
            // pdf <fixture.json> <out.pdf> [a4]
            let f: fixtures::Fixture = serde_json::from_slice(&std::fs::read(arg(1)).unwrap()).unwrap();
            let doc = f.to_document().unwrap();
            let profile = if args.get(3).map(String::as_str) == Some("a4") { layout::Profile::a4() } else { layout::Profile::us_letter() };
            let t0 = Instant::now();
            let map = layout::paginate(&doc.blocks, &profile, 0);
            let t1 = Instant::now();
            let bytes = pdf::render(&map, &profile, &f.title).unwrap();
            let t2 = Instant::now();
            std::fs::write(arg(2), &bytes).unwrap();
            println!(
                "{} blocks -> {} pages; paginate {:.1} ms; pdf {:.1} ms; {} bytes; warnings {:?}",
                doc.blocks.len(),
                map.pages.len(),
                (t1 - t0).as_secs_f64() * 1e3,
                (t2 - t1).as_secs_f64() * 1e3,
                bytes.len(),
                map.warnings
            );
        }
        // make-package <fixture.json> <out.cirth>: a project file from a fixture,
        // with one beat per scene (used to freeze old-schema test files).
        "make-package" => {
            let f: fixtures::Fixture = serde_json::from_slice(&std::fs::read(arg(1)).unwrap()).unwrap();
            let doc = f.to_document().unwrap();
            let out = arg(2);
            let work = out.with_extension("work.tmp");
            cirth_core::store::remove_store_files(&work).unwrap();
            let mut store = Store::open(&work).unwrap();
            store.seed(&doc).unwrap();
            for (i, sc) in doc.scenes().iter().enumerate() {
                store
                    .put_beat(&cirth_core::model::Beat { id: cirth_core::model::new_id(), summary: format!("Beat {} (authored)", i + 1), scene_id: Some(sc.scene_id.clone()), pos: i as f64 })
                    .unwrap();
            }
            store.save_package(&out).unwrap();
            drop(store);
            cirth_core::store::remove_store_files(&work).unwrap();
            println!("wrote {}", out.display());
        }
        "pagemap" => {
            let f: fixtures::Fixture = serde_json::from_slice(&std::fs::read(arg(1)).unwrap()).unwrap();
            let doc = f.to_document().unwrap();
            let map = layout::paginate(&doc.blocks, &layout::Profile::us_letter(), 0);
            for p in &map.pages {
                println!("--- page {} ---", p.number);
                for l in &p.lines {
                    let t: String = l.segs.iter().map(|s| s.text.as_str()).collect();
                    println!("{:>2} {:>4.1} {:<13} {}", l.row, l.x_in, l.kind, t);
                }
            }
        }
        // crash-writer <work.db> <n>: commit n batches, print ACK after each
        // durable commit, then hang until killed.
        "crash-writer" => {
            let mut store = Store::open(&arg(1)).unwrap();
            let n: u64 = args[2].parse().unwrap();
            let mut prev: Option<String> = store.load().unwrap().blocks.last().map(|b| b.id.clone());
            for i in 0..n {
                let b = Block::new(BlockKind::Action, format!("acknowledged line {i}"));
                let id = b.id.clone();
                let base = store.version().unwrap();
                let ack = store.apply(&Batch { tx_id: format!("crash-{i}"), base_version: base, document_id: None, ops: vec![Op::Put { block: b, after: prev.clone() }] }).unwrap();
                prev = Some(id);
                println!("ACK {}", ack.version);
                std::io::stdout().flush().unwrap();
            }
            println!("HANG");
            std::io::stdout().flush().unwrap();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        }
        // crash-inflight <work.db>: start a large uncommitted write, then hang.
        "crash-inflight" => {
            let mut store = Store::open(&arg(1)).unwrap();
            store.begin_and_hang_for_test(5000).unwrap();
            println!("INFLIGHT");
            std::io::stdout().flush().unwrap();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        }
        // crash-at <point> save <work.db> <pkg>
        // crash-at <point> open <pkg> <work.db> <backup dir>
        // Run a package save or a package open (with migration) and stop at
        // the named crash point: print "AT <point>", then hang until killed.
        "crash-at" => {
            fn stop(name: &'static str) {
                if std::env::args().nth(2).as_deref() == Some(name) {
                    println!("AT {name}");
                    std::io::stdout().flush().unwrap();
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(60));
                    }
                }
            }
            cirth_core::store::set_crash_hook_for_test(stop);
            match args.get(2).map(String::as_str) {
                Some("save") => {
                    let store = Store::open(&arg(3)).unwrap();
                    store.save_package(&arg(4)).unwrap();
                }
                Some("open") => {
                    cirth_core::store::Store::open_package(&arg(3), &arg(4), Some(&arg(5))).unwrap();
                }
                _ => panic!("crash-at <point> save|open ..."),
            }
            println!("DONE");
        }
        // hold <work.db>: open (take the lock) and hang.
        "hold" => {
            let _store = Store::open(&arg(1)).unwrap();
            println!("HOLDING");
            std::io::stdout().flush().unwrap();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        }
        _ => {
            eprintln!("usage: cirth-cli gen-fixtures <dir> | pdf <fixture> <out.pdf> [a4] | pagemap <fixture> | crash-writer <db> <n> | crash-inflight <db> | crash-at <point> save <db> <pkg> | crash-at <point> open <pkg> <db> <backups> | hold <db>");
            std::process::exit(2);
        }
    }
}
