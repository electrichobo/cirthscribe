//! Anchored local comment threads and messages (M5 step 1, ROADMAP M5, ACCEPTANCE F1, F2, F3).
//!
//! A comment thread attaches to a character span `[start, end)` (in Unicode scalar values)
//! inside a block of a script document, with the exact covered text (`quote`), author,
//! timestamps, resolution state, and an array of reply messages.
//!
//! Comment anchors are mapped through edits in `Store::apply` under the ADR 0005 rules:
//! - edits before the span shift `[start, end)` (left-open affinity);
//! - edits after the span leave `[start, end)` unchanged (right-open affinity);
//! - edits strictly inside the span update `end` and `quote`;
//! - block splits move the thread to the new block if its quote moved;
//! - block joins move the thread to the merged block;
//! - deleting the text or block marks the thread `orphaned = true` while preserving
//!   the quote, messages, and reattach options;
//! - undoing a deletion that restores the block and quote automatically recovers the anchor.

use crate::model::Id;
use crate::ops::Op;
use crate::tags::{find_nearest_quote, map_span_in_text};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// One comment thread anchored to `[start, end)` (in Unicode scalar values) of `block_id`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CommentThread {
    pub id: Id,
    pub document_id: Id,
    pub block_id: Id,
    /// Start offset in Unicode scalar values (`char` index, inclusive).
    pub start: usize,
    /// End offset in Unicode scalar values (`char` index, exclusive).
    pub end: usize,
    /// Exact covered text when thread was created or last mapped.
    pub quote: String,
    /// Optional author name (empty by default for anonymous, per M5 Decision C).
    #[serde(default)]
    pub author: String,
    /// ISO 8601 UTC timestamp.
    pub created_at: String,
    /// Whether the thread is resolved / closed.
    #[serde(default)]
    pub resolved: bool,
    /// Whether the underlying text or block was deleted.
    #[serde(default)]
    pub orphaned: bool,
}

/// A message inside a comment thread.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CommentMessage {
    pub id: Id,
    pub thread_id: Id,
    #[serde(default)]
    pub author: String,
    pub text: String,
    pub created_at: String,
    #[serde(default)]
    pub edited_at: Option<String>,
}

/// A comment thread bundled with all of its messages.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CommentThreadWithMessages {
    #[serde(flatten)]
    pub thread: CommentThread,
    #[serde(default)]
    pub messages: Vec<CommentMessage>,
}

/// Map all comment threads of a document through a script edit batch (`ops`), given the
/// document's block texts `before_blocks` (`block_id -> text`) and `after_blocks`
/// (`block_id -> text`). Returns only the threads that changed (`start`, `end`,
/// `block_id`, `quote`, or `orphaned`).
pub fn map_comments_through_batch(
    threads: &[CommentThread],
    before_blocks: &HashMap<Id, String>,
    after_blocks: &HashMap<Id, String>,
    ops: &[Op],
) -> Vec<CommentThread> {
    if threads.is_empty() {
        return Vec::new();
    }
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
    for t in threads {
        let mut next = t.clone();
        if t.orphaned {
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
                    let moved = put_ids.iter().find_map(|pid| {
                        let ptext = after_blocks.get(pid)?;
                        let (ns, ne, nq) = find_nearest_quote(ptext, &t.quote, 0)?;
                        Some((pid.clone(), ns, ne, nq))
                    });
                    if let Some((new_bid, ns, ne, nq)) = moved {
                        next.block_id = new_bid;
                        next.start = ns;
                        next.end = ne;
                        next.quote = nq;
                    } else {
                        next.orphaned = true;
                    }
                }
            }
        } else if deleted_ids.contains(&t.block_id) {
            let joined = updated_ids.iter().find_map(|uid| {
                let utext = after_blocks.get(uid)?;
                let (ns, ne, nq) = find_nearest_quote(utext, &t.quote, t.start)?;
                Some((uid.clone(), ns, ne, nq))
            });
            if let Some((new_bid, ns, ne, nq)) = joined {
                next.block_id = new_bid;
                next.start = ns;
                next.end = ne;
                next.quote = nq;
            } else {
                next.orphaned = true;
            }
        }
        if next != *t {
            changed.push(next);
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Block, BlockKind};

    #[test]
    fn anchor_follows_insert_before_and_leaves_insert_after() {
        let mut before = HashMap::new();
        let mut after = HashMap::new();
        before.insert("b1".into(), "Hello world today".into());
        // Insert "Big " before "world"
        after.insert("b1".into(), "Hello Big world today".into());

        let t = CommentThread {
            id: "ct1".into(),
            document_id: "doc1".into(),
            block_id: "b1".into(),
            start: 6,
            end: 11,
            quote: "world".into(),
            ..Default::default()
        };

        let ops = vec![Op::Update {
            block: Block {
                id: "b1".into(),
                ..Block::new(BlockKind::Action, "Hello Big world today")
            },
        }];

        let changed = map_comments_through_batch(&[t], &before, &after, &ops);
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].start, 10);
        assert_eq!(changed[0].end, 15);
        assert_eq!(changed[0].quote, "world");
        assert!(!changed[0].orphaned);
    }

    #[test]
    fn deleted_quote_becomes_orphan_and_recovers_on_restoration() {
        let mut before = HashMap::new();
        let mut after = HashMap::new();
        before.insert("b1".into(), "Hello world today".into());
        after.insert("b1".into(), "Hello today".into());

        let t = CommentThread {
            id: "ct1".into(),
            document_id: "doc1".into(),
            block_id: "b1".into(),
            start: 6,
            end: 11,
            quote: "world".into(),
            ..Default::default()
        };

        let ops = vec![Op::Update {
            block: Block {
                id: "b1".into(),
                ..Block::new(BlockKind::Action, "Hello today")
            },
        }];

        let changed = map_comments_through_batch(&[t.clone()], &before, &after, &ops);
        assert_eq!(changed.len(), 1);
        assert!(changed[0].orphaned);
        assert_eq!(changed[0].quote, "world");

        // Now simulate undo restoring "world"
        let mut undo_before = HashMap::new();
        let mut undo_after = HashMap::new();
        undo_before.insert("b1".into(), "Hello today".into());
        undo_after.insert("b1".into(), "Hello world today".into());
        let undo_ops = vec![Op::Update {
            block: Block {
                id: "b1".into(),
                ..Block::new(BlockKind::Action, "Hello world today")
            },
        }];

        let recovered = map_comments_through_batch(&changed, &undo_before, &undo_after, &undo_ops);
        assert_eq!(recovered.len(), 1);
        assert!(!recovered[0].orphaned);
        assert_eq!(recovered[0].start, 6);
        assert_eq!(recovered[0].end, 11);
    }
}
