//! Visual branch history and independent branch canon (Milestone 5 step 4).
//!
//! Branches allow multiple narrative directions, alternative revisions, and
//! "what if" scenarios to develop in parallel within the same `.cirth` project.
//! Under ADR Decision B (Option 1: Branch-isolated snapshots in SQLite):
//! - The currently active branch uses the canonical document and planning tables.
//! - Inactive branches are stored as verified, compressed SQLite state packages
//!   in the `branches` table (`package_blob`).
//! - Switching branches atomically archives the active working document tree
//!   and restores the target branch's state.
//! - Each branch maintains its own canon (Acceptance C5): editing characters,
//!   locations, or scenes in one branch leaves the other branches completely untouched.

use crate::model::Id;
use crate::store::{self, Result, Store, StoreError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const BRANCH_TABLES: &[&str] = &[
    "documents",
    "containers",
    "blocks",
    "scenes",
    "beats",
    "revision_sets",
    "bible_entities",
    "bible_rejected",
    "story_events",
    "board_cards",
    "board_threads",
    "assets",
    "bookmarks",
    "breakdown_tags",
    "comment_threads",
    "comment_messages",
    "block_alternatives",
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BranchSummary {
    pub id: Id,
    pub name: String,
    pub parent_branch_id: Option<Id>,
    pub fork_version: u64,
    pub description: String,
    pub created_at: String,
    pub head_version: u64,
    pub is_active: bool,
    pub scene_count: u64,
    pub word_count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Branch {
    pub id: Id,
    pub name: String,
    pub parent_branch_id: Option<Id>,
    pub fork_version: u64,
    pub description: String,
    pub created_at: String,
    pub head_version: u64,
    pub scene_count: u64,
    pub word_count: u64,
    pub package_blob: Option<Vec<u8>>,
}

impl Store {
    /// Return the ID of the currently active branch (defaults to "main").
    pub fn current_branch(&self) -> Result<String> {
        Ok(self
            .meta("current_branch_id")?
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "main".to_string()))
    }

    /// Return the human-readable name of the currently active branch.
    pub fn current_branch_name(&self) -> Result<String> {
        let id = self.current_branch()?;
        if id == "main" {
            return Ok("main".to_string());
        }
        let name: Option<String> = self
            .conn
            .query_row("SELECT name FROM branches WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?;
        Ok(name.unwrap_or(id))
    }

    /// Return active scene count.
    pub fn active_scene_count(&self) -> Result<u64> {
        let sc: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM scenes WHERE active = 1", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(sc.max(0) as u64)
    }

    /// Return active word count across all blocks.
    pub fn active_word_count(&self) -> Result<u64> {
        let mut word_count: u64 = 0;
        let mut stmt = self.conn.prepare("SELECT runs FROM blocks")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for r in rows {
            if let Ok(runs_json) = r {
                if let Ok(runs) = serde_json::from_str::<Vec<crate::model::Run>>(&runs_json) {
                    let t: String = runs.iter().map(|rn| rn.text.as_str()).collect();
                    word_count += crate::words::count(&t);
                }
            }
        }
        Ok(word_count)
    }

    /// Return summary for a single branch.
    pub fn branch_summary(&self, id: &str) -> Result<BranchSummary> {
        let curr = self.current_branch()?;
        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_branch_id, fork_version, description, created_at, head_version, scene_count, word_count
             FROM branches WHERE id = ?1",
        )?;
        stmt.query_row([id], |r| {
            let bid: String = r.get(0)?;
            let is_active = bid == curr;
            let fv: i64 = r.get(3)?;
            let hv: i64 = r.get(6)?;
            let sc: i64 = r.get(7)?;
            let wc: i64 = r.get(8)?;
            Ok(BranchSummary {
                id: bid,
                name: r.get(1)?,
                parent_branch_id: r.get(2)?,
                fork_version: fv.max(0) as u64,
                description: r.get(4)?,
                created_at: r.get(5)?,
                head_version: hv.max(0) as u64,
                is_active,
                scene_count: sc.max(0) as u64,
                word_count: wc.max(0) as u64,
            })
        })
        .map_err(StoreError::Sql)
    }

    /// List all branches in creation order with active branch flag and current counts.
    pub fn list_branches(&self) -> Result<Vec<BranchSummary>> {
        let curr = self.current_branch()?;
        let curr_v = self.version()?;
        let active_scenes = self.active_scene_count()?;
        let active_words = self.active_word_count()?;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_branch_id, fork_version, description, created_at, head_version, scene_count, word_count
             FROM branches
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let id: String = r.get(0)?;
            let is_active = id == curr;
            let fv: i64 = r.get(3)?;
            let hv: i64 = r.get(6)?;
            let sc: i64 = r.get(7)?;
            let wc: i64 = r.get(8)?;

            Ok(BranchSummary {
                id,
                name: r.get(1)?,
                parent_branch_id: r.get(2)?,
                fork_version: fv.max(0) as u64,
                description: r.get(4)?,
                created_at: r.get(5)?,
                head_version: if is_active { curr_v } else { hv.max(0) as u64 },
                is_active,
                scene_count: if is_active { active_scenes } else { sc.max(0) as u64 },
                word_count: if is_active { active_words } else { wc.max(0) as u64 },
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    /// Load full branch entity including package blob.
    pub fn branch(&self, id: &str) -> Result<Option<Branch>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_branch_id, fork_version, description, created_at, head_version, scene_count, word_count, package_blob
             FROM branches WHERE id = ?1",
        )?;
        stmt.query_row([id], |r| {
            let fv: i64 = r.get(3)?;
            let hv: i64 = r.get(6)?;
            let sc: i64 = r.get(7)?;
            let wc: i64 = r.get(8)?;
            Ok(Branch {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_branch_id: r.get(2)?,
                fork_version: fv.max(0) as u64,
                description: r.get(4)?,
                created_at: r.get(5)?,
                head_version: hv.max(0) as u64,
                scene_count: sc.max(0) as u64,
                word_count: wc.max(0) as u64,
                package_blob: r.get(9)?,
            })
        })
        .optional()
        .map_err(StoreError::Sql)
    }

    /// Fork a new branch from current state or from an existing snapshot.
    pub fn create_branch(
        &mut self,
        name: &str,
        description: &str,
        from_snapshot_id: Option<&str>,
    ) -> Result<BranchSummary> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(StoreError::Invalid("a branch needs a name".into()));
        }

        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM branches WHERE LOWER(name) = LOWER(?1)",
            [trimmed_name],
            |r| r.get(0),
        )?;
        if exists > 0 {
            return Err(StoreError::Invalid(format!("a branch named '{trimmed_name}' already exists")));
        }

        let curr_branch = self.current_branch()?;
        let id = crate::model::new_id();
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let created_at = crate::backup::utc_stamp(secs);

        let (fork_version, head_version, scene_count, word_count, package_blob, parent_branch_id) =
            if let Some(snap_id) = from_snapshot_id {
                let snap = self
                    .snapshot(snap_id)?
                    .ok_or_else(|| StoreError::Invalid(format!("no snapshot with id {snap_id}")))?;
                (
                    snap.head_version,
                    snap.head_version,
                    snap.scene_count,
                    snap.word_count,
                    snap.package_blob,
                    Some(curr_branch),
                )
            } else {
                let tmp = self
                    .path()
                    .with_extension(format!("branch-fork-{}.tmp", uuid::Uuid::new_v4()));
                if tmp.exists() {
                    let _ = std::fs::remove_file(&tmp);
                }
                self.conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
                {
                    let pkg = Connection::open(&tmp)?;
                    pkg.execute("DELETE FROM meta WHERE key = 'opened_at'", [])?;
                    pkg.execute("DELETE FROM snapshots", [])?;
                    pkg.execute("DELETE FROM branches", [])?;
                    let ok: String = pkg.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
                    if ok != "ok" {
                        let _ = std::fs::remove_file(&tmp);
                        return Err(StoreError::Invalid(format!("branch package integrity check failed: {ok}")));
                    }
                }
                let blob = std::fs::read(&tmp)?;
                let _ = std::fs::remove_file(&tmp);
                let v = self.version()?;
                let sc = self.active_scene_count()?;
                let wc = self.active_word_count()?;
                (v, v, sc, wc, blob, Some(curr_branch))
            };

        self.conn.execute(
            "INSERT INTO branches (id, name, parent_branch_id, fork_version, description, created_at, head_version, scene_count, word_count, package_blob)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                trimmed_name,
                parent_branch_id,
                fork_version as i64,
                description.trim(),
                created_at,
                head_version as i64,
                scene_count as i64,
                word_count as i64,
                package_blob,
            ],
        )?;

        self.mark_unsaved()?;

        Ok(BranchSummary {
            id,
            name: trimmed_name.to_string(),
            parent_branch_id,
            fork_version,
            description: description.trim().to_string(),
            created_at,
            head_version,
            is_active: false,
            scene_count,
            word_count,
        })
    }

    /// Switch active branch.
    /// Atomically archives current branch state into `branches.package_blob`
    /// and unpacks the target branch into the active tables.
    pub fn switch_branch(&mut self, target_branch_id: &str) -> Result<BranchSummary> {
        let current_id = self.current_branch()?;
        if current_id == target_branch_id {
            return self.branch_summary(target_branch_id);
        }

        let target = self
            .branch(target_branch_id)?
            .ok_or_else(|| StoreError::Invalid(format!("no branch with id {target_branch_id}")))?;
        let target_blob = target
            .package_blob
            .ok_or_else(|| StoreError::Invalid("target branch is missing its package state".into()))?;

        // 1. Archive current active branch state
        let tmp_curr = self
            .path()
            .with_extension(format!("branch-archive-{}.tmp", uuid::Uuid::new_v4()));
        if tmp_curr.exists() {
            let _ = std::fs::remove_file(&tmp_curr);
        }
        self.conn.execute("VACUUM INTO ?1", [tmp_curr.to_string_lossy()])?;
        {
            let pkg = Connection::open(&tmp_curr)?;
            pkg.execute("DELETE FROM meta WHERE key = 'opened_at'", [])?;
            pkg.execute("DELETE FROM snapshots", [])?;
            pkg.execute("DELETE FROM branches", [])?;
            let ok: String = pkg.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if ok != "ok" {
                let _ = std::fs::remove_file(&tmp_curr);
                return Err(StoreError::Invalid(format!("branch archive integrity check failed: {ok}")));
            }
        }
        let curr_blob = std::fs::read(&tmp_curr)?;
        let _ = std::fs::remove_file(&tmp_curr);
        let curr_scenes = self.active_scene_count()?;
        let curr_words = self.active_word_count()?;
        let curr_v = self.version()?;

        self.conn.execute(
            "UPDATE branches SET package_blob = ?1, head_version = ?2, scene_count = ?3, word_count = ?4 WHERE id = ?5",
            params![curr_blob, curr_v as i64, curr_scenes as i64, curr_words as i64, current_id],
        )?;

        // 2. Unpack target branch state into temporary DB and migrate if needed
        let tmp_target = self
            .path()
            .with_extension(format!("branch-restore-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&tmp_target, &target_blob)?;
        {
            let mut target_conn = Connection::open(&tmp_target)?;
            let snap_schema = store::schema_of(&tmp_target)?;
            if snap_schema > store::SCHEMA_VERSION {
                let _ = std::fs::remove_file(&tmp_target);
                return Err(StoreError::FutureSchema(snap_schema));
            }
            if snap_schema < store::SCHEMA_VERSION {
                store::migrate(&mut target_conn, snap_schema)?;
            }
        }

        let new_v = curr_v + 1;
        self.conn.execute("ATTACH DATABASE ?1 AS snap_db", [tmp_target.to_string_lossy()])?;

        let res = (|| -> Result<()> {
            let tx = self.conn.transaction()?;
            for table in BRANCH_TABLES {
                tx.execute_batch(&format!(
                    "DELETE FROM {table}; INSERT INTO {table} SELECT * FROM snap_db.{table};"
                ))?;
            }
            tx.execute_batch(
                "DELETE FROM settings; INSERT INTO settings SELECT * FROM snap_db.settings;",
            )?;
            tx.execute_batch(
                "DELETE FROM oplog; INSERT INTO oplog SELECT * FROM snap_db.oplog;",
            )?;
            tx.execute_batch(
                "DELETE FROM meta WHERE key NOT IN ('opened_at');
                 INSERT OR REPLACE INTO meta SELECT * FROM snap_db.meta WHERE key NOT IN ('opened_at');",
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('version', ?1)",
                [new_v.to_string()],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('saved_version', '0')",
                [],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('current_branch_id', ?1)",
                [target_branch_id],
            )?;
            tx.execute(
                "UPDATE branches SET package_blob = NULL, head_version = ?1 WHERE id = ?2",
                params![new_v as i64, target_branch_id],
            )?;
            tx.commit()?;
            Ok(())
        })();

        let _ = self.conn.execute_batch("DETACH DATABASE snap_db;");
        let _ = std::fs::remove_file(&tmp_target);
        res?;

        self.mark_unsaved()?;

        Ok(BranchSummary {
            id: target.id,
            name: target.name,
            parent_branch_id: target.parent_branch_id,
            fork_version: target.fork_version,
            description: target.description,
            created_at: target.created_at,
            head_version: new_v,
            is_active: true,
            scene_count: self.active_scene_count()?,
            word_count: self.active_word_count()?,
        })
    }

    /// Delete a branch by ID.
    /// The 'main' branch and the currently active branch cannot be deleted.
    pub fn delete_branch(&mut self, id: &str) -> Result<()> {
        if id == "main" {
            return Err(StoreError::Invalid("cannot delete the main branch".into()));
        }
        let curr = self.current_branch()?;
        if id == curr {
            return Err(StoreError::Invalid(
                "cannot delete the currently active branch; switch to another branch first".into(),
            ));
        }

        let parent: Option<String> = self
            .conn
            .query_row(
                "SELECT parent_branch_id FROM branches WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();

        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE branches SET parent_branch_id = ?1 WHERE parent_branch_id = ?2",
            params![parent, id],
        )?;
        tx.execute("DELETE FROM branches WHERE id = ?1", [id])?;
        tx.commit()?;

        self.mark_unsaved()?;
        Ok(())
    }

    /// Update a branch's name and description.
    pub fn update_branch(&mut self, id: &str, name: &str, description: &str) -> Result<()> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(StoreError::Invalid("a branch needs a name".into()));
        }

        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM branches WHERE LOWER(name) = LOWER(?1) AND id <> ?2",
            params![trimmed_name, id],
            |r| r.get(0),
        )?;
        if exists > 0 {
            return Err(StoreError::Invalid(format!("a branch named '{trimmed_name}' already exists")));
        }

        self.conn.execute(
            "UPDATE branches SET name = ?2, description = ?3 WHERE id = ?1",
            params![id, trimmed_name, description.trim()],
        )?;

        self.mark_unsaved()?;
        Ok(())
    }
}
