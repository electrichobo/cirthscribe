//! Revision sets: named rounds of changes to a script (label, colour, date,
//! margin mark, author), stored per document (table `revision_sets`).
//!
//! While revision mode is on, the editor tags text added or changed in the
//! active set (`Run::revision` = the set's id), so marks follow the text
//! through later edits and undo removes them with the edit. Printing a set
//! puts its mark in the right margin of every line holding its text and its
//! label and date at the top of those pages. Colour is never the only
//! identifier: the label, date and mark say which set a page belongs to.

use crate::layout::{PLine, PageMap, Seg};
use crate::model::Block;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RevisionSet {
    pub id: String,
    /// e.g. "Blue Revision".
    pub label: String,
    /// One of `COLOURS` (the paper colour the pages go out on).
    pub colour: String,
    /// As the writer gives it, e.g. "2026-10-27".
    pub date: String,
    /// Printed in the right margin of changed lines; usually "*".
    pub mark: String,
    pub author: String,
}

/// The usual order of revision page colours in US production (white is the
/// unrevised draft, so it is not a revision colour). After tan the order
/// starts again: "Second Blue", "Second Pink" and so on.
pub const COLOURS: [&str; 9] = ["blue", "pink", "yellow", "green", "goldenrod", "buff", "salmon", "cherry", "tan"];

/// Colours a stored set may have: `COLOURS`, plus "white" from projects made
/// before tan replaced it (2026-10-27).
pub fn known_colour(c: &str) -> bool {
    COLOURS.contains(&c) || c == "white"
}

/// Left edge of the margin mark: right of the right scene numbers.
pub const MARK_IN: f32 = 7.9;

/// Colour and label for the next set after `sets` (in creation order).
pub fn next_set(sets: &[RevisionSet]) -> (String, String) {
    let next = match sets.last() {
        None => 0,
        Some(last) => COLOURS.iter().position(|c| *c == last.colour).map_or(0, |i| (i + 1) % COLOURS.len()),
    };
    let colour = COLOURS[next];
    let mut name = colour.to_string();
    name[..1].make_ascii_uppercase();
    // Later rounds through the colours: "Second Blue", "Third Blue", ...
    let round = sets.iter().filter(|s| s.colour == colour).count();
    const ORDINALS: [&str; 9] = ["Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
    let label = match round {
        0 => format!("{name} Revision"),
        n if n <= ORDINALS.len() => format!("{} {name} Revision", ORDINALS[n - 1]),
        n => format!("{name} Revision {}", n + 1),
    };
    (colour.to_string(), label)
}

/// Header printed on the set's changed pages, e.g. "Blue Revision (2026-10-27)".
pub fn header(set: &RevisionSet) -> String {
    let (label, date) = (set.label.trim(), set.date.trim());
    if date.is_empty() { label.to_string() } else { format!("{label} ({date})") }
}

/// Character ranges of a block's text that belong to `set_id`.
fn ranges(b: &Block, set_id: &str) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut pos = 0;
    for r in &b.runs {
        let n = r.text.chars().count();
        if n > 0 && r.revision.as_deref() == Some(set_id) {
            match out.last_mut() {
                Some(l) if l.1 == pos => l.1 = pos + n,
                _ => out.push((pos, pos + n)),
            }
        }
        pos += n;
    }
    out
}

/// Number of text passages tagged with `set_id` in `blocks`.
pub fn passages(blocks: &[Block], set_id: &str) -> usize {
    blocks.iter().map(|b| ranges(b, set_id).len()).sum()
}

/// Any revision tags at all (for export notes).
pub fn any(blocks: &[Block]) -> bool {
    blocks.iter().any(|b| b.runs.iter().any(|r| r.revision.is_some() && !r.text.is_empty()))
}

/// Put `set`'s mark beside every line holding its text and flag those pages
/// `revised`. `blocks` are the ones the map was laid out from. Returns the
/// number of revised pages.
pub fn mark_pages(map: &mut PageMap, blocks: &[Block], set: &RevisionSet) -> usize {
    let by_block: std::collections::HashMap<&str, Vec<(usize, usize)>> =
        blocks.iter().map(|b| (b.id.as_str(), ranges(b, &set.id))).filter(|(_, r)| !r.is_empty()).collect();
    let mark = if set.mark.trim().is_empty() { "*".to_string() } else { set.mark.trim().to_string() };
    let mut revised = 0;
    for page in &mut map.pages {
        let mut rows: Vec<usize> = page
            .lines
            .iter()
            .filter(|l| !l.synthetic)
            .filter(|l| {
                let Some(r) = l.block_id.as_deref().and_then(|id| by_block.get(id)) else { return false };
                r.iter().any(|&(a, b)| a < l.end && l.start < b)
            })
            .map(|l| l.row)
            .collect();
        rows.sort_unstable();
        rows.dedup();
        page.revised = !rows.is_empty();
        revised += page.revised as usize;
        for row in rows {
            page.lines.push(PLine {
                row,
                x_in: MARK_IN,
                segs: vec![Seg { text: mark.clone(), bold: false, italic: false, underline: false }],
                block_id: None,
                kind: "revision-mark",
                start: 0,
                end: 0,
                synthetic: true,
            });
        }
    }
    revised
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{Profile, paginate};
    use crate::model::{Block, BlockKind, Run};

    fn set(id: &str) -> RevisionSet {
        RevisionSet { id: id.into(), label: "Blue Revision".into(), colour: "blue".into(), date: "2026-10-27".into(), mark: "*".into(), author: String::new() }
    }

    #[test]
    fn colours_follow_the_usual_order_and_go_round_again() {
        assert_eq!(next_set(&[]), ("blue".into(), "Blue Revision".into()));
        let mut sets = vec![set("a")];
        assert_eq!(next_set(&sets), ("pink".into(), "Pink Revision".into()));
        for c in &COLOURS[1..] {
            sets.push(RevisionSet { colour: c.to_string(), ..set("x") });
        }
        assert_eq!(COLOURS[8], "tan");
        assert_eq!(next_set(&sets), ("blue".into(), "Second Blue Revision".into()));
        sets.push(RevisionSet { colour: "blue".into(), ..set("y") });
        assert_eq!(next_set(&sets), ("pink".into(), "Second Pink Revision".into()));
        for c in &COLOURS[1..] {
            sets.push(RevisionSet { colour: c.to_string(), ..set("z") });
        }
        assert_eq!(next_set(&sets), ("blue".into(), "Third Blue Revision".into()));
        // An older project's white set is still accepted and is followed by blue.
        assert!(known_colour("white") && !known_colour("mauve"));
        assert_eq!(next_set(&[RevisionSet { colour: "white".into(), ..set("w") }]).0, "blue");
        assert_eq!(header(&set("a")), "Blue Revision (2026-10-27)");
    }

    #[test]
    fn only_lines_with_the_sets_text_get_a_mark() {
        let p = Profile::us_letter();
        // A long action paragraph whose middle words are revised.
        let long = "word ".repeat(60);
        let mut b = Block::new(BlockKind::Action, "");
        b.runs = vec![Run::plain(long.clone()), Run { revision: Some("blue".into()), ..Run::plain("CHANGED ") }, Run::plain(long.clone())];
        let other = Block::new(BlockKind::Action, "Untouched.");
        let mut pink = Block::new(BlockKind::Action, "");
        pink.runs = vec![Run { revision: Some("pink".into()), ..Run::plain("Pink text.") }];
        let blocks = vec![b.clone(), other, pink];
        let mut map = paginate(&blocks, &p, 1);
        let lines_before = map.pages[0].lines.len();
        assert_eq!(mark_pages(&mut map, &blocks, &set("blue")), 1);
        let marks: Vec<_> = map.pages[0].lines.iter().filter(|l| l.kind == "revision-mark").collect();
        assert_eq!(marks.len(), 1, "one line holds the change");
        let row = marks[0].row;
        let text: String = map.pages[0].lines.iter().filter(|l| l.row == row && l.kind == "action").flat_map(|l| l.segs.iter().map(|s| s.text.clone())).collect();
        assert!(text.contains("CHANGED"), "{text}");
        assert_eq!(map.pages[0].lines.len(), lines_before + 1);
        assert!(map.pages[0].revised);
        assert_eq!(passages(&blocks, "blue"), 1);
        assert_eq!(passages(&blocks, "pink"), 1);
    }

    #[test]
    fn pages_without_the_sets_text_are_not_revised() {
        let p = Profile::us_letter();
        let mut blocks: Vec<Block> = (0..120).map(|i| Block::new(BlockKind::Action, format!("Line {i}."))).collect();
        blocks[100].runs[0].revision = Some("blue".into());
        let mut map = paginate(&blocks, &p, 1);
        assert!(map.pages.len() >= 3);
        assert_eq!(mark_pages(&mut map, &blocks, &set("blue")), 1);
        let revised: Vec<usize> = map.pages.iter().filter(|pg| pg.revised).map(|pg| pg.number).collect();
        assert_eq!(revised.len(), 1);
        assert!(revised[0] > 1);
    }
}
