//! Planning commands and their undo history (ADR 0003).
//!
//! Planning edits (cards, and later outline items, timeline events and the
//! bible) never touch script text or script order. Each command carries the
//! planning version it was based on and is refused if the planning data has
//! moved on since (`StoreError::Stale`). Applying one records its exact
//! inverse, so undo and redo replay commands instead of guessing.
//!
//! The history lives with the open project, like the script's own undo
//! history in the editor, and is not saved.

use serde::{Deserialize, Serialize};

use crate::model::Beat;
use crate::store::{Result, Store};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum PlanningOp {
    /// Create a card or replace it (text, link, planning position).
    PutBeat(Beat),
    DeleteBeat(String),
    /// A scene's colour label ("" for none).
    SetSceneLabel { scene_id: String, label: String },
    /// A bible entry created or changed (M3 step 7).
    PutEntity(crate::bible::Entity),
    DeleteEntity(String),
    /// A candidate name rejected (or brought back).
    Reject { kind: String, name: String, on: bool },
    /// A story event created or changed: text, time, place in the timeline, linked scenes (M3 step 8).
    PutEvent(crate::timeline::StoryEvent),
    DeleteEvent(String),
    /// Evidence board cards and strings, and bookmarks (M3 step 9).
    PutCard(crate::evidence::Card),
    /// Deletes the card and the strings tied to it.
    DeleteCard(String),
    /// Undoes `DeleteCard`: the card and its strings together.
    RestoreCard { card: crate::evidence::Card, threads: Vec<crate::evidence::Thread> },
    PutThread(crate::evidence::Thread),
    DeleteThread(String),
    PutBookmark(crate::evidence::Bookmark),
    DeleteBookmark(String),
    /// Breakdown tags anchored to text spans (M4 step 3, ADR 0005).
    PutTag(crate::tags::Tag),
    DeleteTag(String),
    /// Stripboard schedule order, day breaks, banners and notes (M4 step 5, E3, E4).
    SetSchedule { scope: String, state: crate::stripboard::ScheduleState },
    /// Anchored comment threads and messages (M5 step 1, ROADMAP M5, ACCEPTANCE F1-F3).
    PutCommentThread { thread: crate::comments::CommentThread, initial_message: Option<crate::comments::CommentMessage> },
    DeleteCommentThread(String),
    RestoreCommentThread { thread: crate::comments::CommentThread, messages: Vec<crate::comments::CommentMessage> },
    PutCommentMessage(crate::comments::CommentMessage),
    DeleteCommentMessage(String),
    SetCommentThreadResolved { thread_id: String, resolved: bool },
    ReattachCommentThread { thread_id: String, block_id: String, start: usize, end: usize, quote: String, orphaned: bool },
    /// Block alternatives and takes (M5 step 2, ROADMAP M5, ACCEPTANCE F4, E5).
    AddAlternative {
        alt: crate::alternatives::BlockAlternative,
        base_take_created: Option<crate::alternatives::BlockAlternative>,
    },
    SetActiveTake {
        document_id: String,
        block_id: String,
        from_take: u32,
        to_take: u32,
    },
    DeleteAlternative {
        alt: crate::alternatives::BlockAlternative,
        base_take_deleted: Option<crate::alternatives::BlockAlternative>,
    },
}

#[derive(Clone, Debug)]
struct Step {
    forward: PlanningOp,
    backward: PlanningOp,
}

/// Undo and redo for planning commands, newest last.
#[derive(Default, Debug)]
pub struct PlanningHistory {
    undo: Vec<Step>,
    redo: Vec<Step>,
}

/// Steps kept for undo.
pub const DEPTH: usize = 200;

impl PlanningHistory {
    /// Apply a command based on planning version `base`; returns the new version.
    pub fn apply(&mut self, store: &Store, op: PlanningOp, base: u64) -> Result<u64> {
        let (version, backward) = store.apply_planning(&op, Some(base))?;
        if backward != op {
            self.undo.push(Step { forward: op, backward });
            if self.undo.len() > DEPTH {
                self.undo.remove(0);
            }
        }
        self.redo.clear();
        Ok(version)
    }

    /// Undo the last planning step; `None` if there is nothing to undo.
    pub fn undo(&mut self, store: &Store) -> Result<Option<u64>> {
        let Some(step) = self.undo.pop() else { return Ok(None) };
        let (version, _) = store.apply_planning(&step.backward, None)?;
        self.redo.push(step);
        Ok(Some(version))
    }

    /// Redo the last undone step; `None` if there is nothing to redo.
    pub fn redo(&mut self, store: &Store) -> Result<Option<u64>> {
        let Some(step) = self.redo.pop() else { return Ok(None) };
        let (version, _) = store.apply_planning(&step.forward, None)?;
        self.undo.push(step);
        Ok(Some(version))
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}
