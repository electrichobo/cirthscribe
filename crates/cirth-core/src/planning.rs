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
