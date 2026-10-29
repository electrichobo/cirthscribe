//! Breakdown tags and text-range anchors (M4 step 3, ADR 0005, ACCEPTANCE E1, E2).
//!
//! A breakdown tag is a separate record anchored to a character span
//! `[start, end)` (in Unicode scalar values, `char` indices) inside a block
//! of a script document, together with the exact covered substring (`quote`),
//! a breakdown category (`props`, `costume`, `cast`, … or a writer-defined
//! category), and the ID of the project bible entry it represents.
//!
//! When a script edit batch runs in `Store::apply`, `map_tags_through_batch`
//! maps every tag in the edited document through the change:
//! - edits before the span shift `[start, end)` (including pure insertion at
//!   `start`, left-open affinity);
//! - edits after the span leave `[start, end)` unchanged (including pure
//!   insertion at `end`, right-open affinity);
//! - edits strictly inside `[start, end)` expand or shrink `end` and update
//!   `quote`;
//! - splitting a block with Enter moves a tag whose text moved into the newly
//!   inserted block;
//! - joining two blocks moves a tag from the deleted block into the merged
//!   block at the joined offset;
//! - deleting a tag's text or its block marks the tag `orphaned = true` while
//!   preserving its `quote` and last known block/offsets so the writer can
//!   reattach or delete it (never silently dropped);
//! - undoing a deletion that restores the block and `quote` automatically
//!   recovers the orphaned tag.

use crate::bible::{self, Entity};
use crate::model::{Block, BlockKind, Id};
use crate::ops::Op;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// One breakdown tag anchored to `[start, end)` (in Unicode scalar values) of `block_id`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Tag {
    pub id: Id,
    pub document_id: Id,
    pub block_id: Id,
    /// Start offset in Unicode scalar values (`char` index, inclusive).
    pub start: usize,
    /// End offset in Unicode scalar values (`char` index, exclusive).
    pub end: usize,
    /// Exact covered substring when the tag was created or last mapped.
    pub quote: String,
    /// Category key (`props`, `cast`, `costume`, … or custom category key).
    pub category: String,
    /// Linked project bible entry (`bible_entities.id`).
    pub entity_id: Id,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub orphaned: bool,
}

/// A suggested breakdown tag found by matching a bible entry's name or alias
/// in action text (M4 step 3). Never applied automatically; the writer can
/// accept (creating a `Tag`) or reject (hiding this suggestion).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagSuggestion {
    pub document_id: Id,
    pub scene_id: Option<Id>,
    pub block_id: Id,
    pub start: usize,
    pub end: usize,
    pub quote: String,
    pub category: String,
    pub entity_id: Id,
    pub entity_name: String,
}

/// Normalize a custom category name into a stable key (`"Animal Wrangler"` -> `"animal_wrangler"`).
pub fn slug_category(label: &str) -> String {
    let mut out = String::new();
    let mut prev_sep = true;
    for c in label.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_sep = false;
        } else if !prev_sep && out.len() < 36 {
            out.push('_');
            prev_sep = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

/// Extract the substring of `text` at Unicode scalar range `[start, end)`.
pub fn slice_chars(text: &str, start: usize, end: usize) -> Option<String> {
    if start >= end {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    if end > chars.len() {
        return None;
    }
    Some(chars[start..end].iter().collect())
}

/// Find the occurrence of `needle` (exact char match, or case-insensitive fallback)
/// in `haystack` whose start index is closest to `near_start`.
pub fn find_nearest_quote(haystack: &str, needle: &str, near_start: usize) -> Option<(usize, usize, String)> {
    let h: Vec<char> = haystack.chars().collect();
    let n: Vec<char> = needle.chars().collect();
    if n.is_empty() || n.len() > h.len() {
        return None;
    }
    let exact: Vec<usize> = (0..=h.len() - n.len()).filter(|&i| h[i..i + n.len()] == n[..]).collect();
    if let Some(&best) = exact.iter().min_by_key(|&&i| i.abs_diff(near_start)) {
        return Some((best, best + n.len(), h[best..best + n.len()].iter().collect()));
    }
    let ci: Vec<usize> = (0..=h.len() - n.len())
        .filter(|&i| h[i..i + n.len()].iter().zip(&n).all(|(a, b)| a.to_lowercase().eq(b.to_lowercase())))
        .collect();
    ci.iter()
        .min_by_key(|&&i| i.abs_diff(near_start))
        .map(|&best| (best, best + n.len(), h[best..best + n.len()].iter().collect()))
}

/// Map a single tag's `[start, end)` within a block whose text changed from `before` to `after`.
/// Returns `Some((new_start, new_end, new_quote))` if the tag stays anchored in this block,
/// or `None` if the tag's covered text was deleted.
pub fn map_span_in_text(before: &str, after: &str, start: usize, end: usize, quote: &str) -> Option<(usize, usize, String)> {
    if before == after {
        if let Some(q) = slice_chars(after, start, end) {
            return Some((start, end, q));
        }
    }
    let b: Vec<char> = before.chars().collect();
    let a: Vec<char> = after.chars().collect();
    if start >= end || end > b.len() {
        return find_nearest_quote(after, quote, start);
    }
    let pre = b.iter().zip(&a).take_while(|(x, y)| x == y).count();
    let max_suf = b.len().saturating_sub(pre).min(a.len().saturating_sub(pre));
    let suf = b[b.len() - max_suf..]
        .iter()
        .rev()
        .zip(a[a.len() - max_suf..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let edit_start = pre;
    let edit_end = b.len() - suf;
    let delta = a.len() as isize - b.len() as isize;

    // 1. Edit strictly after the tag (or pure insertion at `end`: right-open affinity).
    if edit_start >= end {
        let q: String = a[start..end].iter().collect();
        return Some((start, end, q));
    }
    // 2. Edit strictly before the tag (or pure insertion at `start`: left-open affinity).
    if edit_end <= start {
        let ns = (start as isize + delta) as usize;
        let ne = (end as isize + delta) as usize;
        if ns < ne && ne <= a.len() {
            let q: String = a[ns..ne].iter().collect();
            return Some((ns, ne, q));
        }
    }
    // 3. Edit strictly inside `[start, end)` that is either a pure insertion (`edit_start == edit_end`)
    //    or replaces a proper sub-span (`edit_end - edit_start <= (end - start) / 2`) while preserving
    //    both boundary words/chars. Replacing the whole interior word ("red ledger" -> "drawer")
    //    falls through to step 4 so it becomes orphaned unless `quote` still exists.
    if edit_start > start && edit_end < end && (edit_end - edit_start) * 2 <= (end - start) {
        let ns = start;
        let ne_isize = end as isize + delta;
        if ne_isize > ns as isize && (ne_isize as usize) <= a.len() {
            let ne = ne_isize as usize;
            let q: String = a[ns..ne].iter().collect();
            return Some((ns, ne, q));
        }
    }
    // 4. Boundary-overlapping edit or replacement: check whether `quote` still exists in `after`.
    let hint = (start as isize + delta.min(0)).max(0) as usize;
    find_nearest_quote(after, quote, hint)
}

/// Map all tags of a document through a script edit batch (`ops`), given the
/// document's block texts `before_blocks` (`block_id -> text`) and `after_blocks`
/// (`block_id -> text`). Returns only the tags that changed (`start`, `end`,
/// `block_id`, `quote`, or `orphaned`).
pub fn map_tags_through_batch(
    tags: &[Tag],
    before_blocks: &HashMap<Id, String>,
    after_blocks: &HashMap<Id, String>,
    ops: &[Op],
) -> Vec<Tag> {
    if tags.is_empty() {
        return Vec::new();
    }
    // Collect blocks inserted (`Op::Put`) and updated (`Op::Update`) in this batch, in batch order.
    let mut put_ids: Vec<Id> = Vec::new();
    let mut updated_ids: Vec<Id> = Vec::new();
    let mut deleted_ids: HashSet<Id> = HashSet::new();
    for op in ops {
        match op {
            Op::Put { block, .. } => {
                if !before_blocks.contains_key(&block.id) {
                    put_ids.push(block.id.clone());
                } else {
                    updated_ids.push(block.id.clone());
                }
            }
            Op::Update { block } => updated_ids.push(block.id.clone()),
            Op::Delete { id } => {
                deleted_ids.insert(id.clone());
            }
        }
    }

    let mut changed = Vec::new();
    for t in tags {
        let mut next = t.clone();
        if t.orphaned {
            // If an orphaned tag's block is present (e.g. after script undo) and contains `quote`,
            // recover it automatically.
            if let Some(after_text) = after_blocks.get(&t.block_id) {
                if let Some((ns, ne, nq)) = find_nearest_quote(after_text, &t.quote, t.start) {
                    next.start = ns;
                    next.end = ne;
                    next.quote = nq;
                    next.orphaned = false;
                }
            }
        } else if let Some(after_text) = after_blocks.get(&t.block_id) {
            let before_text = before_blocks.get(&t.block_id).map(String::as_str).unwrap_or("");
            if before_text != after_text {
                if let Some((ns, ne, nq)) = map_span_in_text(before_text, after_text, t.start, t.end, &t.quote) {
                    next.start = ns;
                    next.end = ne;
                    next.quote = nq;
                } else {
                    // Check if the block was split (`Op::Put` in the same batch received the text).
                    let moved = put_ids.iter().find_map(|pid| {
                        let ptext = after_blocks.get(pid)?;
                        let (ns, ne, nq) = find_nearest_quote(ptext, &t.quote, 0)?;
                        Some((pid.clone(), ns, ne, nq))
                    });
                    if let Some((new_block_id, ns, ne, nq)) = moved {
                        next.block_id = new_block_id;
                        next.start = ns;
                        next.end = ne;
                        next.quote = nq;
                    } else {
                        next.orphaned = true;
                    }
                }
            } else if slice_chars(after_text, t.start, t.end).is_none() {
                if let Some((ns, ne, nq)) = find_nearest_quote(after_text, &t.quote, t.start) {
                    next.start = ns;
                    next.end = ne;
                    next.quote = nq;
                } else {
                    next.orphaned = true;
                }
            }
        } else if deleted_ids.contains(&t.block_id) || !after_blocks.contains_key(&t.block_id) {
            // The tag's block was deleted. Check if its text was joined into an updated
            // or newly put block in the same batch.
            let old_len = before_blocks.get(&t.block_id).map(|s| s.chars().count()).unwrap_or(0);
            let joined = updated_ids.iter().chain(put_ids.iter()).find_map(|uid| {
                let utext = after_blocks.get(uid)?;
                let u_before_len = before_blocks.get(uid).map(|s| s.chars().count()).unwrap_or(0);
                // Only join if the target block grew or was newly created in this batch.
                if utext.chars().count() < u_before_len + t.quote.chars().count() && before_blocks.contains_key(uid) {
                    return None;
                }
                let hint = u_before_len + t.start.min(old_len);
                let (ns, ne, nq) = find_nearest_quote(utext, &t.quote, hint)?;
                Some((uid.clone(), ns, ne, nq))
            });
            if let Some((new_block_id, ns, ne, nq)) = joined {
                next.block_id = new_block_id;
                next.start = ns;
                next.end = ne;
                next.quote = nq;
            } else {
                next.orphaned = true;
            }
        }
        if &next != t {
            changed.push(next);
        }
    }
    changed
}

/// Find whole-word occurrences of `term` in `text` (case-insensitive, word boundaries).
pub fn find_all_words(text: &str, term: &str) -> Vec<(usize, usize, String)> {
    let t: Vec<char> = text.chars().collect();
    let n: Vec<char> = term.trim().chars().collect();
    if n.is_empty() || n.len() > t.len() {
        return Vec::new();
    }
    let word = |c: char| c.is_alphanumeric() || c == '\'';
    let mut out = Vec::new();
    let mut i = 0;
    while i + n.len() <= t.len() {
        let hit = t[i..i + n.len()].iter().zip(&n).all(|(a, b)| a.to_lowercase().eq(b.to_lowercase()));
        let edges = (i == 0 || !word(t[i - 1])) && (i + n.len() == t.len() || !word(t[i + n.len()]));
        if hit && edges {
            out.push((i, i + n.len(), t[i..i + n.len()].iter().collect()));
            i += n.len();
        } else {
            i += 1;
        }
    }
    out
}

/// Key used in `bible_rejected` to remember a rejected tag suggestion so it does not come back.
pub fn suggestion_reject_key(category: &str, entity_id: &str, block_id: &str, quote: &str) -> (String, String) {
    (
        format!("tag:{category}"),
        format!("{entity_id}:{block_id}:{}", quote.trim()).to_uppercase(),
    )
}

/// Suggest breakdown tags across `docs` (`(document_id, blocks)`) from project bible
/// entries. Scans action blocks for whole-word matches of bible entries' names and
/// aliases (for breakdown categories and characters as `cast`) that are not already
/// covered by a tag in that block and have not been rejected by the writer.
pub fn suggest(
    entities: &[Entity],
    existing_tags: &[Tag],
    rejected: &HashSet<(String, String)>,
    docs: &[(Id, Vec<Block>)],
) -> Vec<TagSuggestion> {
    // Prepare `(category, entity_id, entity_name, search_terms)` for eligible bible entries.
    let mut matchers: Vec<(String, Id, String, Vec<String>)> = Vec::new();
    for e in entities {
        let cat = match e.kind.as_str() {
            "location" | "world" => continue,
            "character" => "cast".to_string(),
            other => other.to_string(),
        };
        let mut terms: Vec<String> = std::iter::once(e.name.trim().to_string())
            .chain(e.aliases.iter().map(|a| a.trim().to_string()))
            .filter(|s| s.chars().count() >= 2)
            .collect();
        // Match longer phrases first (e.g. "the red ledger" before "the ledger").
        terms.sort_by_key(|s| std::cmp::Reverse(s.chars().count()));
        terms.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        if !terms.is_empty() {
            matchers.push((cat, e.id.clone(), e.name.clone(), terms));
        }
    }
    if matchers.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    for (doc_id, blocks) in docs {
        let mut current_scene: Option<Id> = None;
        for b in blocks {
            if b.kind == BlockKind::Heading {
                current_scene = b.scene_id.clone();
            }
            if b.kind != BlockKind::Action {
                continue;
            }
            let text = b.text();
            if text.trim().is_empty() {
                continue;
            }
            let block_tags: Vec<&Tag> = existing_tags
                .iter()
                .filter(|t| !t.orphaned && t.document_id == *doc_id && t.block_id == b.id)
                .collect();

            for (cat, entity_id, entity_name, terms) in &matchers {
                let mut covered_ranges: Vec<(usize, usize)> = block_tags
                    .iter()
                    .filter(|t| t.entity_id == *entity_id || t.category == *cat)
                    .map(|t| (t.start, t.end))
                    .collect();

                for term in terms {
                    for (s, e, quote) in find_all_words(&text, term) {
                        if covered_ranges.iter().any(|&(cs, ce)| s < ce && e > cs) {
                            continue;
                        }
                        let rkey = suggestion_reject_key(cat, entity_id, &b.id, &quote);
                        if rejected.contains(&rkey) {
                            continue;
                        }
                        covered_ranges.push((s, e));
                        out.push(TagSuggestion {
                            document_id: doc_id.clone(),
                            scene_id: current_scene.clone(),
                            block_id: b.id.clone(),
                            start: s,
                            end: e,
                            quote,
                            category: cat.clone(),
                            entity_id: entity_id.clone(),
                            entity_name: entity_name.clone(),
                        });
                    }
                }
            }
        }
    }
    let _ = bible::KINDS;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_tag(block_id: &str, start: usize, end: usize, quote: &str) -> Tag {
        Tag {
            id: "t1".into(),
            document_id: "d1".into(),
            block_id: block_id.into(),
            start,
            end,
            quote: quote.into(),
            category: "props".into(),
            entity_id: "e-ledger".into(),
            note: String::new(),
            orphaned: false,
        }
    }

    #[test]
    fn within_block_edits_respect_affinity_and_unicode_scalars() {
        // "Mara opens the red ledger on the desk."
        //  01234567890123456789012345678901234567
        // "the red ledger" is chars 11..25.
        let before = "Mara opens the red ledger on the desk.";
        assert_eq!(slice_chars(before, 11, 25).as_deref(), Some("the red ledger"));

        // 1. Typing before the tag (with an emoji, 1 Unicode scalar value, 2 UTF-16 code units)
        // shifts the tag right by the exact char count (+3 chars: "🕯️ ").
        let after_pre = "🕯️ Mara opens the red ledger on the desk.";
        let (s, e, q) = map_span_in_text(before, after_pre, 11, 25, "the red ledger").unwrap();
        assert_eq!((s, e, q.as_str()), (14, 28, "the red ledger"));
        assert_eq!(slice_chars(after_pre, s, e).as_deref(), Some("the red ledger"));

        // 2. Pure insertion right at `start` (index 11) shifts the tag right (left-open affinity).
        let after_at_start = "Mara opens quickly the red ledger on the desk.";
        let (s, e, q) = map_span_in_text(before, after_at_start, 11, 25, "the red ledger").unwrap();
        assert_eq!((s, e, q.as_str()), (19, 33, "the red ledger"));

        // 3. Pure insertion right at `end` (index 25) leaves the tag unchanged (right-open affinity).
        let after_at_end = "Mara opens the red ledger carefully on the desk.";
        let (s, e, q) = map_span_in_text(before, after_at_end, 11, 25, "the red ledger").unwrap();
        assert_eq!((s, e, q.as_str()), (11, 25, "the red ledger"));

        // 4. Editing strictly inside `[start, end)` adjusts `end` and updates `quote`.
        let after_inside = "Mara opens the brass-bound red ledger on the desk.";
        let (s, e, q) = map_span_in_text(before, after_inside, 11, 25, "the red ledger").unwrap();
        assert_eq!((s, e, q.as_str()), (11, 37, "the brass-bound red ledger"));

        // 5. Deleting the covered text returns None so the caller marks it orphaned.
        let after_del = "Mara opens the drawer on the desk.";
        assert!(map_span_in_text(before, after_del, 11, 25, "the red ledger").is_none());
    }

    #[test]
    fn batch_mapping_handles_split_join_delete_and_undo_recovery() {
        let b1 = Block { id: "b1".into(), ..Block::new(BlockKind::Action, "Mara grabs the iron key. She unlocks the gate.") };
        // "the iron key" is chars 11..23 in b1.
        let t_key = mk_tag("b1", 11, 23, "the iron key");
        // "the gate" is chars 37..45 in b1.
        let mut t_gate = mk_tag("b1", 37, 45, "the gate");
        t_gate.id = "t2".into();

        // Split `b1` after "Mara grabs the iron key." into `b1` + `b2`.
        let b1_split = Block { id: "b1".into(), ..Block::new(BlockKind::Action, "Mara grabs the iron key.") };
        let b2_split = Block { id: "b2".into(), ..Block::new(BlockKind::Action, "She unlocks the gate.") };
        let before_map: HashMap<Id, String> = [("b1".into(), b1.text())].into();
        let after_map: HashMap<Id, String> = [("b1".into(), b1_split.text()), ("b2".into(), b2_split.text())].into();
        let ops = vec![
            Op::Update { block: b1_split.clone() },
            Op::Put { block: b2_split.clone(), after: Some("b1".into()) },
        ];
        let changed = map_tags_through_batch(&[t_key.clone(), t_gate.clone()], &before_map, &after_map, &ops);
        assert_eq!(changed.len(), 1, "t_key stays at 11..23 in b1; only t_gate moves to b2");
        let t_gate_split = &changed[0];
        assert_eq!(t_gate_split.id, "t2");
        assert_eq!(t_gate_split.block_id, "b2");
        assert_eq!((t_gate_split.start, t_gate_split.end, t_gate_split.quote.as_str()), (12, 20, "the gate"));
        assert!(!t_gate_split.orphaned);

        // Now join `b1` and `b2` back into `b1` (`Update(b1)` + `Delete(b2)`).
        let changed_join = map_tags_through_batch(
            &[t_key.clone(), t_gate_split.clone()],
            &after_map,
            &before_map,
            &[Op::Update { block: b1.clone() }, Op::Delete { id: "b2".into() }],
        );
        assert_eq!(changed_join.len(), 1);
        assert_eq!(changed_join[0].block_id, "b1");
        assert_eq!((changed_join[0].start, changed_join[0].end), (37, 45));
        assert!(!changed_join[0].orphaned);

        // Delete `b1` outright: tags become orphaned, keeping their quote and last position.
        let empty_map: HashMap<Id, String> = HashMap::new();
        let orphaned = map_tags_through_batch(&[t_key.clone()], &before_map, &empty_map, &[Op::Delete { id: "b1".into() }]);
        assert_eq!(orphaned.len(), 1);
        assert!(orphaned[0].orphaned);
        assert_eq!(orphaned[0].quote, "the iron key");

        // Undo the deletion (`Put(b1)`): the orphaned tag recovers automatically.
        let recovered = map_tags_through_batch(
            &orphaned,
            &empty_map,
            &before_map,
            &[Op::Put { block: b1.clone(), after: None }],
        );
        assert_eq!(recovered.len(), 1);
        assert!(!recovered[0].orphaned);
        assert_eq!((recovered[0].start, recovered[0].end), (11, 23));
    }

    #[test]
    fn suggestions_match_bible_names_and_aliases_and_respect_existing_or_rejected() {
        let ledger = Entity {
            id: "e-ledger".into(),
            kind: "props".into(),
            name: "Red Ledger".into(),
            aliases: vec!["the red ledger".into(), "the ledger".into()],
            ..Default::default()
        };
        let doc = vec![
            Block { id: "h1".into(), scene_id: Some("s1".into()), ..Block::new(BlockKind::Heading, "INT. OFFICE - NIGHT") },
            Block { id: "a1".into(), ..Block::new(BlockKind::Action, "Mara hides the red ledger, then checks the ledger again.") },
        ];
        let docs = vec![("d1".into(), doc)];

        // Both "the red ledger" (11..25) and "the ledger" (39..49) are suggested, without double-matching "the ledger" inside "the red ledger".
        let s1 = suggest(&[ledger.clone()], &[], &HashSet::new(), &docs);
        assert_eq!(
            s1.iter().map(|s| (s.start, s.end, s.quote.as_str())).collect::<Vec<_>>(),
            vec![(11, 25, "the red ledger"), (39, 49, "the ledger")]
        );

        // Once the first occurrence is tagged, only the second is suggested.
        let tagged = vec![mk_tag("a1", 11, 25, "the red ledger")];
        let s2 = suggest(&[ledger.clone()], &tagged, &HashSet::new(), &docs);
        assert_eq!(s2.len(), 1);
        assert_eq!(s2[0].quote, "the ledger");

        // Rejecting the second suggestion hides it.
        let mut rej = HashSet::new();
        rej.insert(suggestion_reject_key("props", "e-ledger", "a1", "the ledger"));
        let s3 = suggest(&[ledger], &tagged, &rej, &docs);
        assert!(s3.is_empty());
    }
}
