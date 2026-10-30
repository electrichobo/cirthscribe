//! 3-way merge and conflict integration (Milestone 5 step 5).
//!
//! Provides granular 3-way conflict detection and integration across branches
//! and checkpoints:
//! - Base / ancestor: a common snapshot or checkpoint state.
//! - Ours / target: the currently active working branch.
//! - Theirs / source: the incoming branch being merged.
//!
//! Guarantees:
//! - Speeches and scenes edited concurrently are detected as granular conflicts
//!   showing Base, Ours, and Theirs side-by-side without silent loss or arbitrary
//!   concatenation (Acceptance F5).
//! - Divergent locked-page production baselines require an explicit baseline decision
//!   before structural changes can merge (Acceptance F6).
//! - Non-conflicting additions, edits, and deletions from the incoming branch are
//!   merged cleanly.

use crate::model::{Block, BlockKind, Run};
use crate::store::{Result, Store, StoreError};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// RAII wrapper for a temporary SQLite store unpacked from a package blob.
struct TempStore {
    path: PathBuf,
    store: Option<Store>,
}

impl TempStore {
    fn from_blob(base_path: &Path, prefix: &str, blob: &[u8]) -> Result<Self> {
        let tmp = base_path.with_extension(format!("{}-{}.tmp", prefix, uuid::Uuid::new_v4()));
        std::fs::write(&tmp, blob)?;
        let store = Store::open(&tmp)?;
        Ok(TempStore {
            path: tmp,
            store: Some(store),
        })
    }

    fn store(&self) -> &Store {
        self.store.as_ref().unwrap()
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        self.store.take(); // Close SQLite connection before unlinking
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(self.path.with_extension("tmp-wal"));
        let _ = std::fs::remove_file(self.path.with_extension("tmp-shm"));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeConflictKind {
    Block,
    Scene,
    LockedPages,
    Bible,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictChoice {
    KeepOurs,
    TakeTheirs,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MergeConflict {
    pub id: String,
    pub kind: MergeConflictKind,
    pub document_id: String,
    pub scene_id: Option<String>,
    pub block_id: Option<String>,
    pub context_label: String,
    pub base_text: Option<String>,
    pub ours_text: Option<String>,
    pub theirs_text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LockedPageDivergence {
    pub document_id: String,
    pub document_title: String,
    pub ours_locked: bool,
    pub ours_summary: String,
    pub theirs_locked: bool,
    pub theirs_summary: String,
    pub base_locked: bool,
    pub base_summary: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MergePreview {
    pub source_branch_id: String,
    pub source_branch_name: String,
    pub target_branch_id: String,
    pub target_branch_name: String,
    pub base_snapshot_id: Option<String>,
    pub base_label: Option<String>,
    pub conflicts: Vec<MergeConflict>,
    pub locked_page_divergence: Option<LockedPageDivergence>,
    pub auto_mergeable_count: usize,
    pub can_auto_merge: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConflictResolution {
    pub conflict_id: String,
    pub choice: ConflictChoice,
    pub custom_text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MergeResult {
    pub applied_conflicts: usize,
    pub auto_merged_changes: usize,
    pub new_head_version: u64,
}

impl Store {
    /// Compute a 3-way diff preview between the active branch (Ours) and an
    /// incoming branch (Theirs) relative to a common ancestor (Base).
    ///
    /// If `base_snapshot_id` is None, this finds the latest snapshot with
    /// `head_version <= incoming_branch.fork_version`.
    pub fn merge_preview(
        &self,
        incoming_branch_id: &str,
        base_snapshot_id: Option<&str>,
    ) -> Result<MergePreview> {
        let curr_branch_id = self.current_branch()?;
        if curr_branch_id == incoming_branch_id {
            return Err(StoreError::Invalid(
                "cannot merge the active branch into itself".into(),
            ));
        }

        let curr_summary = self.branch_summary(&curr_branch_id)?;
        let incoming_branch = self
            .branch(incoming_branch_id)?
            .ok_or_else(|| StoreError::Invalid(format!("no branch with id {incoming_branch_id}")))?;
        let incoming_blob = incoming_branch
            .package_blob
            .as_ref()
            .ok_or_else(|| StoreError::Invalid("incoming branch has no saved package blob".into()))?;

        let theirs_temp = TempStore::from_blob(self.path(), "merge-theirs", incoming_blob)?;
        let theirs_store = theirs_temp.store();

        // Resolve base snapshot
        let (base_snap, base_temp) = if let Some(snap_id) = base_snapshot_id {
            let snap = self
                .snapshot(snap_id)?
                .ok_or_else(|| StoreError::Invalid(format!("no snapshot with id {snap_id}")))?;
            let temp = TempStore::from_blob(self.path(), "merge-base", &snap.package_blob)?;
            (Some(snap), Some(temp))
        } else {
            // Check snapshots matching or closest to fork_version
            let all_snaps = self.list_snapshots()?;
            let best_snap = all_snaps
                .into_iter()
                .filter(|s| s.head_version <= incoming_branch.fork_version)
                .max_by_key(|s| s.head_version);
            if let Some(summary) = best_snap {
                let snap = self.snapshot(&summary.id)?.unwrap();
                let temp = TempStore::from_blob(self.path(), "merge-base", &snap.package_blob)?;
                (Some(snap), Some(temp))
            } else {
                (None, None)
            }
        };

        let base_store = base_temp.as_ref().map(|t| t.store());

        let mut conflicts: Vec<MergeConflict> = Vec::new();
        let mut auto_mergeable_count = 0usize;
        let mut locked_page_divergence: Option<LockedPageDivergence> = None;

        // 1. Check documents and locked page baseline divergence (Acceptance F6)
        let our_docs = self.documents()?;
        let their_docs = theirs_store.documents()?;
        let mut doc_map: HashMap<String, String> = HashMap::new();
        for (id, title) in &our_docs {
            doc_map.insert(id.clone(), title.clone());
        }
        for (id, title) in &their_docs {
            doc_map.entry(id.clone()).or_insert_with(|| title.clone());
        }

        for (doc_id, doc_title) in &doc_map {
            let ours_lock = self.page_lock(doc_id)?;
            let theirs_lock = theirs_store.page_lock(doc_id)?;
            let base_lock = if let Some(bs) = base_store {
                bs.page_lock(doc_id)?
            } else {
                None
            };

            let diverged = match (&ours_lock, &theirs_lock) {
                (None, None) => false,
                (Some(o), Some(t)) => o.labels != t.labels || o.starts != t.starts,
                _ => true,
            };

            if diverged {
                let ours_summary = match &ours_lock {
                    Some(l) => format!("Locked ({} pages: {})", l.labels.len(), l.labels.join(", ")),
                    None => "Unlocked".to_string(),
                };
                let theirs_summary = match &theirs_lock {
                    Some(l) => format!("Locked ({} pages: {})", l.labels.len(), l.labels.join(", ")),
                    None => "Unlocked".to_string(),
                };
                let base_summary = match &base_lock {
                    Some(l) => format!("Locked ({} pages: {})", l.labels.len(), l.labels.join(", ")),
                    None => "Unlocked".to_string(),
                };

                let div = LockedPageDivergence {
                    document_id: doc_id.clone(),
                    document_title: doc_title.clone(),
                    ours_locked: ours_lock.is_some(),
                    ours_summary: ours_summary.clone(),
                    theirs_locked: theirs_lock.is_some(),
                    theirs_summary: theirs_summary.clone(),
                    base_locked: base_lock.is_some(),
                    base_summary: base_summary.clone(),
                };

                locked_page_divergence = Some(div);

                conflicts.push(MergeConflict {
                    id: format!("conflict-lock-{doc_id}"),
                    kind: MergeConflictKind::LockedPages,
                    document_id: doc_id.clone(),
                    scene_id: None,
                    block_id: None,
                    context_label: format!("Production Locked Page Baseline: {doc_title}"),
                    base_text: Some(base_summary),
                    ours_text: Some(ours_summary),
                    theirs_text: Some(theirs_summary),
                });
            }

            // 2. Compare blocks within this document
            let ours_blocks = self.load_document(doc_id).map(|d| d.blocks).unwrap_or_default();
            let theirs_blocks = theirs_store.load_document(doc_id).map(|d| d.blocks).unwrap_or_default();
            let base_blocks = base_store
                .and_then(|bs| bs.load_document(doc_id).ok())
                .map(|d| d.blocks)
                .unwrap_or_default();

            let ours_by_id: HashMap<String, (usize, &Block)> = ours_blocks
                .iter()
                .enumerate()
                .map(|(i, b)| (b.id.clone(), (i, b)))
                .collect();
            let theirs_by_id: HashMap<String, (usize, &Block)> = theirs_blocks
                .iter()
                .enumerate()
                .map(|(i, b)| (b.id.clone(), (i, b)))
                .collect();
            let base_by_id: HashMap<String, (usize, &Block)> = base_blocks
                .iter()
                .enumerate()
                .map(|(i, b)| (b.id.clone(), (i, b)))
                .collect();

            // Collect all unique block IDs
            let mut all_block_ids: Vec<String> = Vec::new();
            for b in &ours_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }
            for b in &theirs_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }
            for b in &base_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }

            // Helper to build context label (e.g. "Scene 1: EXT. LAB - DAY > INES (dialogue)")
            let context_for = |block: &Block, doc_blocks: &[Block]| -> String {
                let mut heading_text = "Before Scene 1".to_string();
                let mut speaker = String::new();

                for b in doc_blocks {
                    if b.kind == BlockKind::Heading {
                        heading_text = b.text();
                    }
                    if b.id == block.id {
                        break;
                    }
                    if b.kind == BlockKind::Character {
                        speaker = b.text();
                    } else if b.kind != BlockKind::Parenthetical && b.kind != BlockKind::Dialogue {
                        speaker.clear();
                    }
                }

                if !speaker.is_empty() && block.kind.is_speech() {
                    format!("{heading_text} > {speaker} ({})", block.kind.as_str())
                } else {
                    format!("{heading_text} > {}", block.kind.as_str())
                }
            };

            for bid in &all_block_ids {
                let o_opt = ours_by_id.get(bid).map(|(_, b)| *b);
                let t_opt = theirs_by_id.get(bid).map(|(_, b)| *b);
                let b_opt = base_by_id.get(bid).map(|(_, b)| *b);

                match (b_opt, o_opt, t_opt) {
                    // Block exists in all three
                    (Some(base), Some(ours), Some(theirs)) => {
                        let ours_changed = ours.text() != base.text() || ours.kind != base.kind;
                        let theirs_changed = theirs.text() != base.text() || theirs.kind != base.kind;

                        if ours_changed && theirs_changed {
                            if ours.text() == theirs.text() && ours.kind == theirs.kind {
                                // Both modified identically -> no conflict
                            } else {
                                // Concurrent conflicting modification (Acceptance F5)
                                conflicts.push(MergeConflict {
                                    id: format!("conflict-block-{bid}"),
                                    kind: MergeConflictKind::Block,
                                    document_id: doc_id.clone(),
                                    scene_id: ours.scene_id.clone().or_else(|| theirs.scene_id.clone()),
                                    block_id: Some(bid.clone()),
                                    context_label: context_for(ours, &ours_blocks),
                                    base_text: Some(base.text()),
                                    ours_text: Some(ours.text()),
                                    theirs_text: Some(theirs.text()),
                                });
                            }
                        } else if theirs_changed {
                            // Only modified in incoming branch -> auto-mergeable!
                            auto_mergeable_count += 1;
                        }
                    }
                    // Block not in base, but in both ours and theirs
                    (None, Some(ours), Some(theirs)) => {
                        if ours.text() != theirs.text() || ours.kind != theirs.kind {
                            conflicts.push(MergeConflict {
                                id: format!("conflict-block-{bid}"),
                                kind: MergeConflictKind::Block,
                                document_id: doc_id.clone(),
                                scene_id: ours.scene_id.clone().or_else(|| theirs.scene_id.clone()),
                                block_id: Some(bid.clone()),
                                context_label: context_for(ours, &ours_blocks),
                                base_text: None,
                                ours_text: Some(ours.text()),
                                theirs_text: Some(theirs.text()),
                            });
                        }
                    }
                    // Block in base and ours, deleted in theirs
                    (Some(base), Some(ours), None) => {
                        if ours.text() != base.text() || ours.kind != base.kind {
                            // Modified in ours, deleted in theirs -> conflict
                            conflicts.push(MergeConflict {
                                id: format!("conflict-block-{bid}"),
                                kind: MergeConflictKind::Block,
                                document_id: doc_id.clone(),
                                scene_id: ours.scene_id.clone(),
                                block_id: Some(bid.clone()),
                                context_label: context_for(ours, &ours_blocks),
                                base_text: Some(base.text()),
                                ours_text: Some(ours.text()),
                                theirs_text: None,
                            });
                        } else {
                            // Clean deletion in theirs
                            auto_mergeable_count += 1;
                        }
                    }
                    // Block in base and theirs, deleted in ours
                    (Some(base), None, Some(theirs)) => {
                        if theirs.text() != base.text() || theirs.kind != base.kind {
                            // Deleted in ours, modified in theirs -> conflict
                            conflicts.push(MergeConflict {
                                id: format!("conflict-block-{bid}"),
                                kind: MergeConflictKind::Block,
                                document_id: doc_id.clone(),
                                scene_id: theirs.scene_id.clone(),
                                block_id: Some(bid.clone()),
                                context_label: context_for(theirs, &theirs_blocks),
                                base_text: Some(base.text()),
                                ours_text: None,
                                theirs_text: Some(theirs.text()),
                            });
                        }
                    }
                    // Block added in theirs (not in base, not in ours)
                    (None, None, Some(_theirs)) => {
                        auto_mergeable_count += 1;
                    }
                    _ => {}
                }
            }
        }

        // 3. Compare Bible entities
        let our_entities = self.entities()?;
        let their_entities = theirs_store.entities()?;
        let our_ent_map: HashMap<String, crate::bible::Entity> =
            our_entities.into_iter().map(|e| (e.id.clone(), e)).collect();

        for te in their_entities {
            if let Some(oe) = our_ent_map.get(&te.id) {
                if oe.name != te.name || oe.description != te.description {
                    conflicts.push(MergeConflict {
                        id: format!("conflict-bible-{}", te.id),
                        kind: MergeConflictKind::Bible,
                        document_id: String::new(),
                        scene_id: None,
                        block_id: None,
                        context_label: format!("Bible Entity: {}", te.name),
                        base_text: None,
                        ours_text: Some(format!("Name: {}\n{}", oe.name, oe.description)),
                        theirs_text: Some(format!("Name: {}\n{}", te.name, te.description)),
                    });
                }
            } else {
                auto_mergeable_count += 1;
            }
        }

        let can_auto_merge = conflicts.is_empty();

        Ok(MergePreview {
            source_branch_id: incoming_branch.id,
            source_branch_name: incoming_branch.name,
            target_branch_id: curr_summary.id,
            target_branch_name: curr_summary.name,
            base_snapshot_id: base_snap.as_ref().map(|s| s.id.clone()),
            base_label: base_snap.map(|s| s.label),
            conflicts,
            locked_page_divergence,
            auto_mergeable_count,
            can_auto_merge,
        })
    }

    /// Apply 3-way merge resolutions from an incoming branch into the active branch.
    ///
    /// Requires an explicit resolution for each conflict.
    /// If locked-page baselines diverge (Acceptance F6), an explicit resolution for
    /// `conflict-lock-{document_id}` must be supplied, or an error is returned.
    pub fn apply_merge(
        &mut self,
        incoming_branch_id: &str,
        base_snapshot_id: Option<&str>,
        resolutions: &[ConflictResolution],
    ) -> Result<MergeResult> {
        let preview = self.merge_preview(incoming_branch_id, base_snapshot_id)?;

        let mut res_by_id: HashMap<String, &ConflictResolution> = HashMap::new();
        for r in resolutions {
            res_by_id.insert(r.conflict_id.clone(), r);
        }

        // Validate that all conflicts have resolutions
        for c in &preview.conflicts {
            if !res_by_id.contains_key(&c.id) {
                if c.kind == MergeConflictKind::LockedPages {
                    return Err(StoreError::Invalid(
                        "Locked-page production baselines diverge across branches; an explicit baseline decision is required before merging (Acceptance F6)".into(),
                    ));
                }
                return Err(StoreError::Invalid(format!(
                    "conflict '{}' ({}) requires an explicit resolution choice",
                    c.id, c.context_label
                )));
            }
        }

        let incoming_branch = self.branch(incoming_branch_id)?.unwrap();
        let incoming_blob = incoming_branch.package_blob.as_ref().unwrap();
        let theirs_temp = TempStore::from_blob(self.path(), "merge-apply", incoming_blob)?;
        let theirs_store = theirs_temp.store();

        let base_temp = if let Some(snap_id) = preview.base_snapshot_id.as_deref() {
            let snap = self.snapshot(snap_id)?.unwrap();
            Some(TempStore::from_blob(self.path(), "merge-base-apply", &snap.package_blob)?)
        } else {
            None
        };
        let base_store = base_temp.as_ref().map(|t| t.store());

        let mut applied_conflicts = 0usize;
        let mut auto_merged_changes = 0usize;

        // 1. Apply locked-page baseline resolution if diverged (Acceptance F6)
        if let Some(div) = &preview.locked_page_divergence {
            let conf_id = format!("conflict-lock-{}", div.document_id);
            let res = res_by_id.get(&conf_id).unwrap();
            match res.choice {
                ConflictChoice::KeepOurs => {
                    // Retain current branch page lock
                }
                ConflictChoice::TakeTheirs => {
                    let theirs_lock_json = theirs_store.setting(&format!("document:{}", div.document_id), "page_lock")?;
                    self.set_setting(&format!("document:{}", div.document_id), "page_lock", &theirs_lock_json.unwrap_or_default())?;
                }
                ConflictChoice::Custom => {
                    if res.custom_text.as_deref() == Some("unlock") {
                        self.unlock_pages(&div.document_id)?;
                    }
                }
            }
            applied_conflicts += 1;
        }

        // 2. Process block conflicts and auto-merges per document
        let our_docs = self.documents()?;
        let their_docs = theirs_store.documents()?;
        let mut doc_map: HashMap<String, String> = HashMap::new();
        for (id, title) in &our_docs {
            doc_map.insert(id.clone(), title.clone());
        }
        for (id, title) in &their_docs {
            doc_map.entry(id.clone()).or_insert_with(|| title.clone());
        }

        for (doc_id, _) in &doc_map {
            let ours_blocks = self.load_document(doc_id).map(|d| d.blocks).unwrap_or_default();
            let theirs_blocks = theirs_store.load_document(doc_id).map(|d| d.blocks).unwrap_or_default();
            let base_blocks = base_store
                .and_then(|bs| bs.load_document(doc_id).ok())
                .map(|d| d.blocks)
                .unwrap_or_default();

            let ours_by_id: HashMap<String, &Block> = ours_blocks.iter().map(|b| (b.id.clone(), b)).collect();
            let theirs_by_id: HashMap<String, &Block> = theirs_blocks.iter().map(|b| (b.id.clone(), b)).collect();
            let base_by_id: HashMap<String, &Block> = base_blocks.iter().map(|b| (b.id.clone(), b)).collect();

            let mut all_block_ids: Vec<String> = Vec::new();
            for b in &ours_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }
            for b in &theirs_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }
            for b in &base_blocks {
                if !all_block_ids.contains(&b.id) {
                    all_block_ids.push(b.id.clone());
                }
            }

            for bid in &all_block_ids {
                let conf_id = format!("conflict-block-{bid}");
                if let Some(res) = res_by_id.get(&conf_id) {
                    // Conflict resolution
                    match res.choice {
                        ConflictChoice::KeepOurs => {
                            // Retain existing block in ours as is
                        }
                        ConflictChoice::TakeTheirs => {
                            if let Some(tb) = theirs_by_id.get(bid) {
                                let runs_json = serde_json::to_string(&tb.runs).map_err(|e| StoreError::Invalid(e.to_string()))?;
                                if ours_by_id.contains_key(bid) {
                                    self.conn.execute(
                                        "UPDATE blocks SET kind = ?1, runs = ?2, dual = ?3, break_before = ?4 WHERE id = ?5",
                                        params![tb.kind.as_str(), runs_json, tb.dual as i32, tb.break_before as i32, bid],
                                    )?;
                                } else {
                                    self.conn.execute(
                                        "INSERT INTO blocks (id, ord, kind, runs, scene_id, dual, break_before, document_id)
                                         VALUES (?1, (SELECT COALESCE(MAX(ord), 0.0) + 1.0 FROM blocks WHERE document_id = ?7), ?2, ?3, ?4, ?5, ?6, ?7)",
                                        params![tb.id, tb.kind.as_str(), runs_json, tb.scene_id, tb.dual as i32, tb.break_before as i32, doc_id],
                                    )?;
                                }
                            } else {
                                // Deleted in theirs
                                self.conn.execute("DELETE FROM blocks WHERE id = ?1", [bid])?;
                            }
                        }
                        ConflictChoice::Custom => {
                            let text = res.custom_text.as_deref().unwrap_or("");
                            let runs = vec![Run::plain(text)];
                            let runs_json = serde_json::to_string(&runs).map_err(|e| StoreError::Invalid(e.to_string()))?;
                            self.conn.execute(
                                "UPDATE blocks SET runs = ?1 WHERE id = ?2",
                                params![runs_json, bid],
                            )?;
                        }
                    }
                    applied_conflicts += 1;
                } else {
                    // Check auto-mergeable updates/additions/deletions
                    let o_opt = ours_by_id.get(bid).copied();
                    let t_opt = theirs_by_id.get(bid).copied();
                    let b_opt = base_by_id.get(bid).copied();

                    match (b_opt, o_opt, t_opt) {
                        (Some(base), Some(ours), Some(theirs)) => {
                            let ours_changed = ours.text() != base.text() || ours.kind != base.kind;
                            let theirs_changed = theirs.text() != base.text() || theirs.kind != base.kind;
                            if !ours_changed && theirs_changed {
                                // Auto-merge incoming modification
                                let runs_json = serde_json::to_string(&theirs.runs).map_err(|e| StoreError::Invalid(e.to_string()))?;
                                self.conn.execute(
                                    "UPDATE blocks SET kind = ?1, runs = ?2, dual = ?3, break_before = ?4 WHERE id = ?5",
                                    params![theirs.kind.as_str(), runs_json, theirs.dual as i32, theirs.break_before as i32, bid],
                                )?;
                                auto_merged_changes += 1;
                            }
                        }
                        (Some(_base), Some(_ours), None) => {
                            // Clean deletion in theirs
                            self.conn.execute("DELETE FROM blocks WHERE id = ?1", [bid])?;
                            auto_merged_changes += 1;
                        }
                        (None, None, Some(theirs)) => {
                            // Clean addition in theirs
                            let runs_json = serde_json::to_string(&theirs.runs).map_err(|e| StoreError::Invalid(e.to_string()))?;
                            self.conn.execute(
                                "INSERT OR REPLACE INTO blocks (id, ord, kind, runs, scene_id, dual, break_before, document_id)
                                 VALUES (?1, (SELECT COALESCE(MAX(ord), 0.0) + 1.0 FROM blocks WHERE document_id = ?7), ?2, ?3, ?4, ?5, ?6, ?7)",
                                params![theirs.id, theirs.kind.as_str(), runs_json, theirs.scene_id, theirs.dual as i32, theirs.break_before as i32, doc_id],
                            )?;
                            auto_merged_changes += 1;
                        }
                        _ => {}
                    }
                }
            }
        }

        // 3. Process Bible entities auto-merges and conflicts
        let their_entities = theirs_store.entities()?;
        let our_entities = self.entities()?;
        let our_ent_map: HashMap<String, crate::bible::Entity> =
            our_entities.into_iter().map(|e| (e.id.clone(), e)).collect();

        for te in their_entities {
            let conf_id = format!("conflict-bible-{}", te.id);
            if let Some(res) = res_by_id.get(&conf_id) {
                match res.choice {
                    ConflictChoice::KeepOurs => {}
                    ConflictChoice::TakeTheirs => {
                        self.put_entity(&te)?;
                    }
                    ConflictChoice::Custom => {
                        if let Some(txt) = &res.custom_text {
                            let mut ce = te.clone();
                            ce.description = txt.clone();
                            self.put_entity(&ce)?;
                        }
                    }
                }
                applied_conflicts += 1;
            } else if !our_ent_map.contains_key(&te.id) {
                self.put_entity(&te)?;
                auto_merged_changes += 1;
            }
        }

        // Increment version and mark unsaved
        let current_v = self.version()?;
        let new_v = current_v + 1;
        Self::set_meta(&self.conn, "version", &new_v.to_string())?;
        Self::set_meta(&self.conn, "saved_version", "0")?;
        self.mark_unsaved()?;

        Ok(MergeResult {
            applied_conflicts,
            auto_merged_changes,
            new_head_version: new_v,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockKind, Run};
    use crate::ops::{Batch, Op};

    struct TestDir {
        path: PathBuf,
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn temp_store() -> (TestDir, Store) {
        let dir_path = std::env::temp_dir().join(format!("cirth-test-merge-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir_path).unwrap();
        let path = dir_path.join("test.cirth");
        let store = Store::open(&path).unwrap();
        (TestDir { path: dir_path }, store)
    }

    #[test]
    fn fork_two_branches_from_one_checkpoint_edit_same_speech_differently_detects_3way_conflict() {
        // Acceptance F5: Fork two branches from one checkpoint and edit the same speech differently.
        // Integration shows the base and both edits; no automatic concatenation or lost version.
        let (_dir, mut s) = temp_store();
        let doc_id = s.current_document().unwrap();

        // 1. Initial screenplay text
        let heading = Block::new(BlockKind::Heading, "INT. CONTROL ROOM - DAY");
        let char_block = Block::new(BlockKind::Character, "INES");
        let mut speech_block = Block::new(BlockKind::Dialogue, "We should calibrate the laser first.");
        let speech_id = speech_block.id.clone();

        s.apply(&Batch {
            tx_id: crate::model::new_id(),
            base_version: s.version().unwrap(),
            document_id: Some(doc_id.clone()),
            ops: vec![
                Op::Put { block: heading, after: None },
                Op::Put { block: char_block, after: None },
                Op::Put { block: speech_block.clone(), after: None },
            ],
        })
        .unwrap();

        // 2. Create checkpoint
        let snap = s
            .create_snapshot("Checkpoint 1", "Common ancestor checkpoint", "Author")
            .unwrap();

        // 3. Fork alt-branch from checkpoint
        let alt_branch = s
            .create_branch("alt-branch", "Alternative narrative direction", Some(&snap.id))
            .unwrap();

        // 4. Edit speech on main (ours)
        speech_block.runs = vec![Run::plain("We should calibrate the quantum sensor first.")];
        s.apply(&Batch {
            tx_id: crate::model::new_id(),
            base_version: s.version().unwrap(),
            document_id: Some(doc_id.clone()),
            ops: vec![Op::Update { block: speech_block.clone() }],
        })
        .unwrap();

        // 5. Switch to alt-branch (theirs) and edit speech differently
        s.switch_branch(&alt_branch.id).unwrap();
        speech_block.runs = vec![Run::plain("We should bypass the laser entirely.")];
        s.apply(&Batch {
            tx_id: crate::model::new_id(),
            base_version: s.version().unwrap(),
            document_id: Some(doc_id.clone()),
            ops: vec![Op::Update { block: speech_block.clone() }],
        })
        .unwrap();

        // 6. Switch back to main
        s.switch_branch("main").unwrap();

        // 7. Preview 3-way merge
        let preview = s.merge_preview(&alt_branch.id, Some(&snap.id)).unwrap();

        assert_eq!(preview.conflicts.len(), 1, "must detect exactly 1 conflict on the speech");
        let c = &preview.conflicts[0];
        assert_eq!(c.kind, MergeConflictKind::Block);
        assert_eq!(c.block_id.as_deref(), Some(speech_id.as_str()));
        assert_eq!(c.base_text.as_deref(), Some("We should calibrate the laser first."));
        assert_eq!(c.ours_text.as_deref(), Some("We should calibrate the quantum sensor first."));
        assert_eq!(c.theirs_text.as_deref(), Some("We should bypass the laser entirely."));

        // 8. Apply merge with resolution TakeTheirs
        let result = s
            .apply_merge(
                &alt_branch.id,
                Some(&snap.id),
                &[ConflictResolution {
                    conflict_id: c.id.clone(),
                    choice: ConflictChoice::TakeTheirs,
                    custom_text: None,
                }],
            )
            .unwrap();

        assert_eq!(result.applied_conflicts, 1);

        let merged_doc = s.load_document(&doc_id).unwrap();
        let merged_speech = merged_doc.blocks.iter().find(|b| b.id == speech_id).unwrap();
        assert_eq!(
            merged_speech.text(),
            "We should bypass the laser entirely.",
            "TakeTheirs resolution must adopt incoming branch edit"
        );

        // 9. Now test Custom resolution
        let result_custom = s
            .apply_merge(
                &alt_branch.id,
                Some(&snap.id),
                &[ConflictResolution {
                    conflict_id: c.id.clone(),
                    choice: ConflictChoice::Custom,
                    custom_text: Some("We should calibrate both sensors.".into()),
                }],
            )
            .unwrap();

        assert_eq!(result_custom.applied_conflicts, 1);
        let doc_after_custom = s.load_document(&doc_id).unwrap();
        let custom_speech = doc_after_custom.blocks.iter().find(|b| b.id == speech_id).unwrap();
        assert_eq!(
            custom_speech.text(),
            "We should calibrate both sensors.",
            "Custom resolution must apply custom text"
        );
    }

    #[test]
    fn compare_branches_with_different_locked_page_baselines_requires_explicit_decision() {
        // Acceptance F6: Compare branches with different locked-page baselines.
        // Require an explicit baseline decision before merging structural changes.
        let (_dir, mut s) = temp_store();
        let doc_id = s.current_document().unwrap();

        // 1. Populate some blocks
        let heading = Block::new(BlockKind::Heading, "EXT. WASTELAND - DUSK");
        let action = Block::new(BlockKind::Action, "Dust swirls across the abandoned landing pad.");
        s.apply(&Batch {
            tx_id: crate::model::new_id(),
            base_version: s.version().unwrap(),
            document_id: Some(doc_id.clone()),
            ops: vec![
                Op::Put { block: heading, after: None },
                Op::Put { block: action, after: None },
            ],
        })
        .unwrap();

        // 2. Lock pages on main
        let doc = s.load_document(&doc_id).unwrap();
        let profile = crate::layout::Profile::us_letter();
        let map = crate::layout::paginate(&doc.blocks, &profile, 1);
        s.lock_pages(&doc_id, &map).unwrap();
        assert!(s.page_lock(&doc_id).unwrap().is_some());

        // 3. Fork branch
        let branch = s.create_branch("branch-unlocked", "Branch with unlocked pages", None).unwrap();

        // 4. On branch, unlock pages
        s.switch_branch(&branch.id).unwrap();
        s.unlock_pages(&doc_id).unwrap();
        assert!(s.page_lock(&doc_id).unwrap().is_none());

        // 5. Switch back to main (where pages are locked)
        s.switch_branch("main").unwrap();
        assert!(s.page_lock(&doc_id).unwrap().is_some());

        // 6. Preview merge: must flag baseline divergence
        let preview = s.merge_preview(&branch.id, None).unwrap();
        assert!(preview.locked_page_divergence.is_some(), "must detect locked page divergence");
        let div = preview.locked_page_divergence.as_ref().unwrap();
        assert!(div.ours_locked);
        assert!(!div.theirs_locked);

        let lock_conf = preview
            .conflicts
            .iter()
            .find(|c| c.kind == MergeConflictKind::LockedPages)
            .unwrap();

        // 7. Attempting to apply merge without resolving the locked-page baseline MUST FAIL (Acceptance F6)
        let err = s.apply_merge(&branch.id, None, &[]).unwrap_err();
        match err {
            StoreError::Invalid(msg) => {
                assert!(msg.contains("Locked-page production baselines diverge"));
            }
            other => panic!("expected StoreError::Invalid for baseline divergence, got: {other:?}"),
        }

        // 8. With explicit resolution, merge succeeds
        let res = s
            .apply_merge(
                &branch.id,
                None,
                &[ConflictResolution {
                    conflict_id: lock_conf.id.clone(),
                    choice: ConflictChoice::KeepOurs,
                    custom_text: None,
                }],
            )
            .unwrap();

        assert_eq!(res.applied_conflicts, 1);
        assert!(s.page_lock(&doc_id).unwrap().is_some(), "KeepOurs preserves main locked baseline");
    }
}
