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
    check("page-boundaries-numbered-letter", &txt::render_document(&map, &p, None, "PAGE BOUNDARIES - Blue Revision", "Confidential").text);
}
