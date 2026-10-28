//! Reference pages: each sample script laid out in US Letter and A4 and
//! written as plain text (the same page map the PDF draws), compared with
//! files committed under fixtures/golden/. CI runs this on Windows, macOS and
//! Linux, so a page or line break that differs between systems fails there
//! (acceptance D7). After an intended layout change, regenerate with
//! `UPDATE_GOLDEN=1 cargo test -p cirth-core --test golden` and review the diff.

use cirth_core::fixtures::Fixture;
use cirth_core::layout::{Profile, paginate, paginate_numbered};
use cirth_core::numbering::{Numbers, SceneNumber};
use cirth_core::txt;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn check(name: &str, actual: &str) {
    let path = root().join("fixtures/golden").join(format!("{name}.txt"));
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing {}: run with UPDATE_GOLDEN=1", path.display())).replace("\r\n", "\n");
    if expected != actual {
        let line = expected.lines().zip(actual.lines()).position(|(a, b)| a != b).unwrap_or_else(|| expected.lines().count().min(actual.lines().count()));
        let out = std::env::temp_dir().join(format!("kolbitar-golden-{name}.txt"));
        std::fs::write(&out, actual).unwrap();
        panic!(
            "{name}: pages differ from fixtures/golden/{name}.txt at line {} ({:?} vs {:?}); actual written to {}",
            line + 1,
            expected.lines().nth(line),
            actual.lines().nth(line),
            out.display()
        );
    }
}

fn fixture(file: &str) -> cirth_core::model::Document {
    let f: Fixture = serde_json::from_slice(&std::fs::read(root().join("fixtures").join(file)).unwrap()).unwrap();
    f.to_document().unwrap()
}

#[test]
fn sample_scripts_paginate_identically_everywhere() {
    for (file, name) in [("page-boundaries.json", "page-boundaries"), ("unicode-marks.json", "unicode-marks"), ("long-120.json", "long-120")] {
        let doc = fixture(file);
        for (p, size) in [(Profile::us_letter(), "letter"), (Profile::a4(), "a4")] {
            let map = paginate(&doc.blocks, &p, 0);
            check(&format!("{name}-{size}"), &txt::render(&map, &p).text);
        }
    }
}

#[test]
fn numbered_script_with_an_omitted_scene_header_and_footer() {
    let doc = fixture("page-boundaries.json");
    let p = Profile::us_letter();
    let mut numbers = Numbers::new();
    for (i, id) in doc.blocks.iter().filter_map(|b| b.scene_id.clone()).enumerate() {
        numbers.insert(id.clone(), SceneNumber { scene_id: id, number: (i + 1).to_string(), omitted: i == 2 });
    }
    let map = paginate_numbered(&doc.blocks, &p, 0, &numbers);
    check("page-boundaries-numbered-letter", &txt::render_document(&map, &p, None, "PAGE BOUNDARIES - Blue Revision", "Confidential", "").text);
}

#[test]
fn revised_dialogue_marks_its_lines_and_the_changed_pages_print_alone() {
    let mut doc = fixture("page-boundaries.json");
    let p = Profile::us_letter();
    // Revise the second dialogue block: its middle words go into the Blue set.
    let i = doc.blocks.iter().enumerate().filter(|(_, b)| b.kind == cirth_core::model::BlockKind::Dialogue).nth(1).map(|(i, _)| i).unwrap();
    let text = doc.blocks[i].text();
    let words: Vec<&str> = text.split(' ').collect();
    let (a, rest) = words.split_at(words.len() / 3);
    let (b, c) = rest.split_at(3.min(rest.len()));
    let plain = |t: String| cirth_core::model::Run::plain(t);
    doc.blocks[i].runs = vec![
        plain(format!("{} ", a.join(" "))),
        cirth_core::model::Run { revision: Some("blue".into()), ..plain(format!("{} ", b.join(" "))) },
        plain(c.join(" ")),
    ];
    let set = cirth_core::revisions::RevisionSet { id: "blue".into(), label: "Blue Revision".into(), colour: "blue".into(), date: "2026-10-27".into(), mark: "*".into(), author: String::new() };
    let mut map = paginate(&doc.blocks, &p, 0);
    assert_eq!(cirth_core::revisions::mark_pages(&mut map, &doc.blocks, &set), 1);
    let header = cirth_core::revisions::header(&set);
    check("page-boundaries-revised-letter", &txt::render_document(&map, &p, None, "", "", &header).text);
    map.pages.retain(|pg| pg.revised);
    check("page-boundaries-revised-changed-pages-letter", &txt::render_document(&map, &p, None, "", "", &header).text);
}
