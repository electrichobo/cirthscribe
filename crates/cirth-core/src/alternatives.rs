//! Non-destructive block alternatives (takes and alternate lines).
//!
//! ADR 0005 & M5 Step 2:
//! A block (dialogue, action, heading, parenthetical, etc.) can carry one or more alternate takes.
//! The canonical document model in `blocks` always contains the currently active take.
//! Inactive takes are preserved safely in `block_alternatives`.
//!
//! Word counts, StoryScry reports, character sides, bible mentions, and exports
//! immediately reflect the active take (Acceptance F4).
//! Inactive takes are excluded by default in reports and stripboards, but can be
//! optionally inspected or exported with unambiguous labels (Acceptance E5).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockAlternative {
    pub id: String,
    pub document_id: String,
    pub block_id: String,
    pub take_index: u32,
    pub text: String,
    pub label: String,
    pub author: String,
    pub created_at: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockTakesView {
    pub document_id: String,
    pub block_id: String,
    pub active_take_index: u32,
    pub total_takes: u32,
    pub takes: Vec<BlockAlternative>,
}
