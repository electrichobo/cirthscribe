//! Domain commands. Every view (editor, navigator, board) changes the script
//! only through a `Batch` carrying the version it was based on.

use crate::model::{Block, Id};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Insert the block, or move an existing block, so it sits directly after
    /// `after` (`None` = first). Content and kind are replaced as well.
    Put { block: Block, after: Option<Id> },
    /// Replace content, kind or flags of an existing block in place.
    Update { block: Block },
    Delete { id: Id },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Batch {
    /// Client-chosen id; resubmitting the same batch is a no-op.
    pub tx_id: String,
    pub base_version: u64,
    /// Document the ops apply to; None = the project's default document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<Id>,
    pub ops: Vec<Op>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ack {
    pub version: u64,
    pub duplicate: bool,
}
