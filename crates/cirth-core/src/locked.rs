//! Locked pages: a pagination baseline for a production script. Separate from
//! scene-number locking (numbering.rs).
//!
//! Locking records where each page starts (block id and character offset)
//! and on which page each block starts. Afterwards every block keeps its
//! baseline page: a block that is new since locking joins the page of the
//! block before it, and a block never moves to an earlier page than the one
//! before it (a scene moved earlier flows in as new text). Each baseline
//! page is then laid out on its own:
//! - text that no longer fits runs onto added pages 12A, 12B, …, and later
//!   pages keep their numbers (acceptance D3);
//! - a page that loses text just gets shorter;
//! - a page that loses all its text is folded into the page before it,
//!   which is then labelled "11-12" (D4);
//! - a speech cut at a locked page boundary gets (MORE) and a (CONT'D) cue
//!   on the next page, as in the unlocked layout.
//!
//! Boundaries come from the stored baseline, never from a new layout, so a
//! layout-engine upgrade cannot move text across locked pages (D8). The
//! engine version at locking is kept, and a different one is reported as a
//! warning. Pages always use the bundled font, so a missing system font
//! changes nothing.

use crate::layout::{paginate, PLine, Page, PageMap, PageStart, Profile, Seg, ENGINE_VERSION};
use crate::model::{Block, BlockKind, Run};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PageLock {
    /// Layout engine and page profile the baseline was made with.
    pub engine: String,
    pub profile: String,
    /// Baseline page labels, "1".."N".
    pub labels: Vec<String>,
    /// Where each baseline page starts: (block id, offset in Unicode scalars).
    pub starts: Vec<(String, usize)>,
    /// Baseline page index (0-based) of each block's start.
    pub members: Vec<(String, usize)>,
}

impl PageLock {
    /// The baseline of a laid-out script (the pages exactly as they are now).
    pub fn from_map(map: &PageMap) -> PageLock {
        let mut members = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut starts = Vec::new();
        for (k, page) in map.pages.iter().enumerate() {
            let mut lines: Vec<&PLine> = page.lines.iter().filter(|l| !l.synthetic && l.block_id.is_some()).collect();
            lines.sort_by_key(|l| l.row);
            if let Some(first) = lines.first() {
                starts.push((first.block_id.clone().unwrap(), first.start));
            } else {
                starts.push((String::new(), 0));
            }
            for l in lines {
                let id = l.block_id.clone().unwrap();
                if l.start == 0 && seen.insert(id.clone()) {
                    members.push((id, k));
                }
            }
        }
        PageLock {
            engine: map.engine.to_string(),
            profile: map.profile.to_string(),
            labels: (1..=map.pages.len()).map(|n| n.to_string()).collect(),
            starts,
            members,
        }
    }
}

/// "12" -> "12A", then "12B" … "12Z", "12AA".
fn added_label(base: &str, n: usize) -> String {
    let mut s = String::new();
    let mut n = n;
    loop {
        s.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    format!("{base}{s}")
}

/// The part of a block's text from `a` to `z` (Unicode scalars), formatting kept.
fn slice(b: &Block, a: usize, z: usize) -> Block {
    let mut out = b.clone();
    out.runs = Vec::new();
    let mut pos = 0;
    for r in &b.runs {
        let n = r.text.chars().count();
        let (x, y) = (a.max(pos), z.min(pos + n));
        if x < y {
            out.runs.push(Run { text: r.text.chars().skip(x - pos).take(y - x).collect(), ..r.clone() });
        }
        pos += n;
    }
    if out.runs.is_empty() {
        out.runs.push(Run::plain(""));
    }
    // Only the first piece of a block keeps a forced page break.
    if a > 0 {
        out.break_before = false;
    }
    out
}

struct Piece {
    block: Block,
    /// Where this piece starts in the block's own text.
    offset: usize,
}

const CONTD_ID: &str = "\u{0}contd";

/// Lay out `blocks` against a locked baseline. Pages carry their baseline
/// labels; `number` counts physical pages (1 = the first page).
pub fn paginate_locked(blocks: &[Block], p: &Profile, doc_version: u64, lock: &PageLock) -> PageMap {
    let n = lock.labels.len().max(1);
    let member: HashMap<&str, usize> = lock.members.iter().map(|(id, k)| (id.as_str(), *k)).collect();
    let mut splits: HashMap<&str, Vec<(usize, usize)>> = HashMap::new();
    for (k, (id, off)) in lock.starts.iter().enumerate() {
        if *off > 0 {
            splits.entry(id.as_str()).or_default().push((k, *off));
        }
    }
    // Assign blocks (and pieces of blocks split across locked pages) to pages.
    let mut segments: Vec<Vec<Piece>> = (0..n).map(|_| Vec::new()).collect();
    let mut cur = 0usize;
    for b in blocks {
        let k = member.get(b.id.as_str()).map_or(cur, |&m| m.max(cur)).min(n - 1);
        let len = b.text().chars().count();
        let (mut seg, mut start) = (k, 0usize);
        if let Some(sp) = splits.get(b.id.as_str()) {
            for &(page, off) in sp.iter().filter(|(page, _)| *page > k) {
                if off > start && off < len {
                    segments[seg].push(Piece { block: slice(b, start, off), offset: start });
                    seg = page;
                    start = off;
                }
            }
        }
        segments[seg].push(Piece { block: if start == 0 { b.clone() } else { slice(b, start, len) }, offset: start });
        cur = seg;
    }

    let mut pages: Vec<Page> = Vec::new();
    let mut warnings = Vec::new();
    if lock.engine != ENGINE_VERSION {
        warnings.push(format!("pages were locked with layout engine {} and are laid out with {}; locked page boundaries are kept", lock.engine, ENGINE_VERSION));
    }
    if lock.profile != p.name {
        warnings.push(format!("pages were locked for {} paper and are laid out for {}; locked page boundaries are kept", lock.profile, p.name));
    }
    // A label waiting for the next page when leading pages lost all their text.
    let mut folded_front: Option<String> = None;
    let mut last_cue: Option<String> = None;
    for (k, seg) in segments.into_iter().enumerate() {
        let label = lock.labels.get(k).cloned().unwrap_or_else(|| (k + 1).to_string());
        if seg.is_empty() {
            // Fold into the previous page: "11" becomes "11-12".
            match pages.last_mut() {
                Some(prev) => prev.label = format!("{}-{label}", prev.label.split('-').next().unwrap_or(&prev.label)),
                None => folded_front = Some(folded_front.unwrap_or(label)),
            }
            continue;
        }
        // A speech running across the locked boundary: repeat its cue.
        let continues_speech = matches!(seg[0].block.kind, BlockKind::Dialogue | BlockKind::Parenthetical | BlockKind::Lyric);
        let mut seg_blocks: Vec<Block> = Vec::with_capacity(seg.len() + 1);
        if continues_speech {
            if let Some(cue) = &last_cue {
                let mut c = Block::new(BlockKind::Character, format!("{cue}{}", p.contd));
                c.id = CONTD_ID.into();
                seg_blocks.push(c);
            }
            // (MORE) at the end of the page before.
            if let Some(prev) = pages.last_mut() {
                let row = prev.lines.iter().map(|l| l.row + 1).max().unwrap_or(0);
                if row < p.body_lines() {
                    prev.lines.push(PLine { row, x_in: p.character.left_in, segs: vec![Seg { text: p.more.to_string(), bold: false, italic: false, underline: false }], block_id: None, kind: "character", start: 0, end: 0, synthetic: true });
                }
            }
        }
        let offsets: HashMap<String, usize> = seg.iter().filter(|pc| pc.offset > 0).map(|pc| (pc.block.id.clone(), pc.offset)).collect();
        for pc in &seg {
            if pc.block.kind == BlockKind::Character && pc.block.id != CONTD_ID {
                last_cue = Some(pc.block.text().to_uppercase());
            }
        }
        seg_blocks.extend(seg.into_iter().map(|pc| pc.block));
        let part = paginate(&seg_blocks, p, doc_version);
        warnings.extend(part.warnings);
        for (i, mut page) in part.pages.into_iter().enumerate() {
            for l in &mut page.lines {
                if l.block_id.as_deref() == Some(CONTD_ID) {
                    l.block_id = None;
                    l.synthetic = true;
                } else if let Some(off) = l.block_id.as_ref().and_then(|id| offsets.get(id)) {
                    l.start += off;
                    l.end += off;
                }
            }
            page.label = if i == 0 { label.clone() } else { added_label(&label, i - 1) };
            if i == 0 {
                if let Some(front) = folded_front.take() {
                    page.label = format!("{front}-{label}");
                }
            }
            page.number = pages.len() + 1;
            pages.push(page);
        }
    }
    let page_starts = pages
        .iter()
        .filter_map(|pg| {
            let l = pg.lines.iter().filter(|l| !l.synthetic && l.block_id.is_some()).min_by_key(|l| l.row)?;
            Some(PageStart { page: pg.number, label: pg.label.clone(), block_id: l.block_id.clone()?, offset: l.start })
        })
        .collect();
    PageMap { profile: p.name, engine: ENGINE_VERSION, doc_version, body_lines: p.body_lines(), pages, page_starts, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{paginate, Profile};
    use crate::model::{Block, BlockKind};

    fn script(n: usize) -> Vec<Block> {
        let mut v = Vec::new();
        for i in 0..n {
            v.push(Block::new(BlockKind::Heading, format!("INT. ROOM {i} - DAY")));
            v.push(Block::new(BlockKind::Action, format!("Action line for scene {i}, long enough to take a whole line of the page.")));
            v.push(Block::new(BlockKind::Character, "MARA"));
            v.push(Block::new(BlockKind::Dialogue, format!("Speech number {i}.")));
        }
        v
    }

    fn labels(m: &PageMap) -> Vec<String> {
        m.pages.iter().map(|p| p.label.clone()).collect()
    }

    fn text_of(m: &PageMap, k: usize) -> String {
        m.pages[k].lines.iter().flat_map(|l| l.segs.iter().map(|s| s.text.clone())).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn unchanged_script_lays_out_exactly_as_when_locked() {
        let p = Profile::us_letter();
        let blocks = script(40);
        let map = paginate(&blocks, &p, 1);
        let lock = PageLock::from_map(&map);
        let again = paginate_locked(&blocks, &p, 1, &lock);
        assert_eq!(labels(&again), (1..=map.pages.len()).map(|n| n.to_string()).collect::<Vec<_>>());
        for k in 0..map.pages.len() {
            assert_eq!(text_of(&again, k), text_of(&map, k), "page {}", k + 1);
        }
    }

    #[test]
    fn added_text_makes_a_pages_and_later_pages_keep_their_numbers() {
        let p = Profile::us_letter();
        let mut blocks = script(40);
        let map = paginate(&blocks, &p, 1);
        let lock = PageLock::from_map(&map);
        let page3_first = &lock.starts[2].0;
        let at = blocks.iter().position(|b| &b.id == page3_first).unwrap() + 1;
        for i in 0..30 {
            blocks.insert(at, Block::new(BlockKind::Action, format!("Inserted line {i}.")));
        }
        let m = paginate_locked(&blocks, &p, 2, &lock);
        let l = labels(&m);
        assert_eq!(&l[..3], &["1", "2", "3"]);
        assert!(l.contains(&"3A".to_string()), "{l:?}");
        let four = l.iter().position(|x| x == "4").unwrap();
        assert_eq!(text_of(&m, four), text_of(&map, 3), "page 4 is unchanged");
        assert_eq!(l.last().unwrap(), &map.pages.len().to_string(), "the last page keeps its number");
    }

    #[test]
    fn deleting_most_of_a_page_shortens_it_and_deleting_all_folds_the_label() {
        let p = Profile::us_letter();
        let blocks = script(40);
        let map = paginate(&blocks, &p, 1);
        let lock = PageLock::from_map(&map);
        let on_page = |k: usize| lock.members.iter().filter(|(_, pg)| *pg == k).map(|(id, _)| id.clone()).collect::<Vec<_>>();
        // Most of page 3 gone: still page 3, shorter; page 4 unchanged.
        let gone3: Vec<String> = on_page(2).into_iter().skip(1).collect();
        let fewer: Vec<Block> = blocks.iter().filter(|b| !gone3.contains(&b.id)).cloned().collect();
        let m = paginate_locked(&fewer, &p, 2, &lock);
        assert_eq!(labels(&m), labels(&map));
        assert!(m.pages[2].lines.len() < map.pages[2].lines.len());
        assert_eq!(text_of(&m, 3), text_of(&map, 3));
        // All of page 5 gone (blocks starting there and any split piece): page 4 becomes "4-5".
        let gone5 = on_page(4);
        let none: Vec<Block> = fewer.iter().filter(|b| !gone5.contains(&b.id) && b.id != lock.starts[4].0).cloned().collect();
        let m = paginate_locked(&none, &p, 3, &lock);
        let l = labels(&m);
        assert!(l.contains(&"4-5".to_string()) && !l.contains(&"5".to_string()), "{l:?}");
        assert!(l.contains(&"6".to_string()));
    }

    #[test]
    fn a_new_engine_or_paper_is_reported_but_never_moves_boundaries() {
        let p = Profile::us_letter();
        let blocks = script(20);
        let map = paginate(&blocks, &p, 1);
        let mut lock = PageLock::from_map(&map);
        lock.engine = "older-engine".into();
        let m = paginate_locked(&blocks, &p, 1, &lock);
        assert!(m.warnings.iter().any(|w| w.contains("older-engine")));
        for k in 0..map.pages.len() {
            assert_eq!(text_of(&m, k), text_of(&map, k));
        }
    }

    #[test]
    fn added_labels_run_a_to_z_then_aa() {
        assert_eq!(added_label("12", 0), "12A");
        assert_eq!(added_label("12", 25), "12Z");
        assert_eq!(added_label("12", 26), "12AA");
    }
}
