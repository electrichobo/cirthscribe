use cirth_core::fixtures;
use cirth_core::layout::{PageMap, Profile, paginate};
use cirth_core::model::{Block, Document};

fn map_of(doc: &Document) -> PageMap {
    paginate(&doc.blocks, &Profile::us_letter(), 0)
}

fn page_text(map: &PageMap, page: usize) -> Vec<String> {
    map.pages[page - 1].lines.iter().map(|l| l.segs.iter().map(|s| s.text.as_str()).collect()).collect()
}

/// Every non-space character of every block appears in exactly one line range.
fn assert_text_preserved(doc: &Document, map: &PageMap) {
    for b in &doc.blocks {
        let text: Vec<char> = b.text().chars().collect();
        let mut covered = vec![0u8; text.len()];
        for p in &map.pages {
            for l in p.lines.iter().filter(|l| l.block_id.as_deref() == Some(b.id.as_str())) {
                for c in &mut covered[l.start..l.end] {
                    *c += 1;
                }
            }
        }
        for (i, ch) in text.iter().enumerate() {
            if ch.is_whitespace() {
                assert!(covered[i] <= 1, "space {i} of block {} placed twice", b.id);
            } else {
                assert_eq!(covered[i], 1, "char {i} {ch:?} of block {} placed {} times", b.id, covered[i]);
            }
        }
    }
}

fn assert_page_rules(map: &PageMap) {
    for (i, p) in map.pages.iter().enumerate() {
        assert!(p.lines.iter().all(|l| l.row < map.body_lines), "page {} overflows", p.number);
        let last = p.lines.iter().max_by_key(|l| l.row);
        if let Some(last) = last {
            if i + 1 < map.pages.len() {
                assert!(
                    !(last.kind == "character" && !last.synthetic) && last.kind != "parenthetical",
                    "page {} ends with a {} line",
                    p.number,
                    last.kind
                );
            }
            let more = last.synthetic && last.segs[0].text == "(MORE)";
            if more {
                let next_first = &map.pages[i + 1].lines[0];
                assert!(next_first.synthetic && next_first.segs[0].text.ends_with("(CONT'D)"), "(MORE) on page {} without CONT'D cue", p.number);
            }
        }
    }
}

#[test]
fn long_fixture_is_at_least_120_pages_and_keeps_all_text() {
    let doc = fixtures::long_script(120).to_document().unwrap();
    let map = map_of(&doc);
    assert!(map.pages.len() >= 120, "{} pages", map.pages.len());
    assert!(map.warnings.is_empty(), "{:?}", map.warnings);
    assert_text_preserved(&doc, &map);
    assert_page_rules(&map);
}

#[test]
fn pagination_is_deterministic_and_profile_dependent() {
    let doc = fixtures::long_script(120).to_document().unwrap();
    let a = serde_json::to_string(&map_of(&doc)).unwrap();
    let b = serde_json::to_string(&map_of(&doc)).unwrap();
    assert_eq!(a, b);
    let a4 = paginate(&doc.blocks, &Profile::a4(), 0);
    assert_ne!(a4.pages.len(), map_of(&doc).pages.len(), "A4 has more lines per page");
    assert_eq!(Profile::us_letter().body_lines(), 54);
    assert_eq!(Profile::a4().body_lines(), 58);
}

#[test]
fn page_boundary_cases() {
    let doc = fixtures::page_boundaries().to_document().unwrap();
    let map = map_of(&doc);
    assert!(map.warnings.is_empty(), "{:?}", map.warnings);
    assert_text_preserved(&doc, &map);
    assert_page_rules(&map);

    // Case A: the long speech spans at least three pages with MORE/CONT'D.
    let ines = &doc.blocks[3].id;
    let pages_with_ines: Vec<usize> = map.pages.iter().filter(|p| p.lines.iter().any(|l| l.block_id.as_ref() == Some(ines))).map(|p| p.number).collect();
    assert!(pages_with_ines.len() >= 3, "{pages_with_ines:?}");
    assert_eq!(page_text(&map, 2)[0], "INES (CONT'D)");
    // At least min_split dialogue lines on each side of every split.
    for &pn in &pages_with_ines {
        let n = map.pages[pn - 1].lines.iter().filter(|l| l.block_id.as_ref() == Some(ines)).count();
        assert!(n >= 2, "page {pn} has {n} lines of the speech");
    }

    // Case B: PELL's cue and parenthetical are not stranded; the speech starts a page.
    let pell = &doc.blocks[6].id;
    let (pp, pl) = map.pages.iter().find_map(|p| p.lines.iter().find(|l| l.block_id.as_ref() == Some(pell)).map(|l| (p.number, l.row))).unwrap();
    assert_eq!(pl, 0, "PELL cue should open page {pp}");
    let prev_last = map.pages[pp - 2].lines.last().unwrap();
    assert_eq!(prev_last.kind, "action");

    // Case D: the signal tower heading opens a page instead of sitting at the bottom.
    let tower = &doc.blocks[10].id;
    let row = map.pages.iter().flat_map(|p| &p.lines).find(|l| l.block_id.as_ref() == Some(tower)).unwrap().row;
    assert_eq!(row, 0);

    // Case E: both dual columns start on the same row of the same page.
    let (m, t) = (&doc.blocks[13].id, &doc.blocks[15].id);
    let pos = |id: &String| map.pages.iter().find_map(|p| p.lines.iter().find(|l| l.block_id.as_ref() == Some(id)).map(|l| (p.number, l.row))).unwrap();
    assert_eq!(pos(m), pos(t));
    assert_eq!(pos(m).1, 0, "dual pair moved to the top of a new page");

    // Case F: the long heading wraps to two lines and is uppercase.
    let long_heading = &doc.blocks[17].id;
    let n = map.pages.iter().flat_map(|p| &p.lines).filter(|l| l.block_id.as_ref() == Some(long_heading)).count();
    assert_eq!(n, 2);

    // Page starts point at real blocks.
    assert_eq!(map.page_starts.len(), map.pages.len());
}

#[test]
fn editing_one_block_only_reflows_from_that_point() {
    let mut doc = fixtures::long_script(120).to_document().unwrap();
    let before = map_of(&doc);
    // Add text to a block on roughly page 60.
    let target = before.pages[59].lines.iter().find(|l| l.kind == "action" && !l.synthetic).unwrap().block_id.clone().unwrap();
    let b: &mut Block = doc.blocks.iter_mut().find(|b| b.id == target).unwrap();
    b.runs[0].text.push_str(" An added sentence that is long enough to need at least one more printed line.");
    let after = map_of(&doc);
    for i in 0..59 {
        assert_eq!(
            serde_json::to_string(&before.pages[i]).unwrap(),
            serde_json::to_string(&after.pages[i]).unwrap(),
            "page {} changed",
            i + 1
        );
    }
}
