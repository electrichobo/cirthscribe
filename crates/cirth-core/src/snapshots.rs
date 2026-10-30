//! Named snapshots and checkpoints (Milestone 5 step 3).
//!
//! A snapshot is an immutable point-in-time package state stored in SQLite.
//! It captures the entire package (documents, containers, blocks, scenes,
//! beats, revisions, bible, timeline, evidence board, tags, comments, alternatives).
//! Restoring a snapshot restores the working head non-destructively, preserving
//! previous history and taking a pre-restore checkpoint by default.

use crate::model::Id;
use crate::store::{self, Result, Store, StoreError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SnapshotSummary {
    pub id: Id,
    pub label: String,
    pub description: String,
    pub created_at: String,
    pub author: String,
    pub head_version: u64,
    pub scene_count: u64,
    pub word_count: u64,
    pub byte_size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: Id,
    pub label: String,
    pub description: String,
    pub created_at: String,
    pub author: String,
    pub head_version: u64,
    pub scene_count: u64,
    pub word_count: u64,
    pub package_blob: Vec<u8>,
}

impl Store {
    /// Create a named snapshot capturing the current project state.
    pub fn create_snapshot(&self, label: &str, description: &str, author: &str) -> Result<SnapshotSummary> {
        if label.trim().is_empty() {
            return Err(StoreError::Invalid("a snapshot needs a label".into()));
        }
        let id = crate::model::new_id();
        let head_version = self.version()?;
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let created_at = crate::backup::utc_stamp(secs);

        // Count scenes and words
        let sc: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM scenes WHERE active = 1", [], |r| r.get(0))
            .unwrap_or(0);
        let scene_count = sc.max(0) as u64;

        let mut word_count: u64 = 0;
        let mut stmt = self.conn.prepare("SELECT runs FROM blocks")?;
        let rows = stmt.query_map([], |r| {
            let s: String = r.get(0)?;
            Ok(s)
        })?;
        for r in rows {
            if let Ok(runs_json) = r {
                if let Ok(runs) = serde_json::from_str::<Vec<crate::model::Run>>(&runs_json) {
                    let t: String = runs.iter().map(|rn| rn.text.as_str()).collect();
                    word_count += crate::words::count(&t);
                }
            }
        }

        // Capture snapshot package blob using VACUUM INTO a temporary file
        let tmp = self.path().with_extension(format!("snap-{}.tmp", uuid::Uuid::new_v4()));
        if tmp.exists() {
            let _ = std::fs::remove_file(&tmp);
        }
        self.conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;

        // Clean runtime meta and clear snapshots and branches tables inside the snapshot blob
        // so snapshots do not nest recursively
        {
            let pkg = Connection::open(&tmp)?;
            pkg.execute("DELETE FROM meta WHERE key = 'opened_at'", [])?;
            pkg.execute("DELETE FROM snapshots", [])?;
            pkg.execute("DELETE FROM branches", [])?;
            let ok: String = pkg.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if ok != "ok" {
                let _ = std::fs::remove_file(&tmp);
                return Err(StoreError::Invalid(format!("snapshot integrity check failed: {ok}")));
            }
        }

        let package_blob = std::fs::read(&tmp)?;
        let _ = std::fs::remove_file(&tmp);
        let byte_size = package_blob.len() as u64;

        self.conn.execute(
            "INSERT INTO snapshots (id, label, description, created_at, author, head_version, scene_count, word_count, package_blob)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                label.trim(),
                description.trim(),
                created_at,
                author.trim(),
                head_version as i64,
                scene_count as i64,
                word_count as i64,
                package_blob,
            ],
        )?;

        Ok(SnapshotSummary {
            id,
            label: label.trim().to_string(),
            description: description.trim().to_string(),
            created_at,
            author: author.trim().to_string(),
            head_version,
            scene_count,
            word_count,
            byte_size,
        })
    }

    /// List all snapshots in reverse chronological order.
    pub fn list_snapshots(&self) -> Result<Vec<SnapshotSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, description, created_at, author, head_version, scene_count, word_count, length(package_blob)
             FROM snapshots
             ORDER BY created_at DESC, head_version DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let hv: i64 = r.get(5)?;
            let sc: i64 = r.get(6)?;
            let wc: i64 = r.get(7)?;
            let sz: i64 = r.get(8)?;
            Ok(SnapshotSummary {
                id: r.get(0)?,
                label: r.get(1)?,
                description: r.get(2)?,
                created_at: r.get(3)?,
                author: r.get(4)?,
                head_version: hv.max(0) as u64,
                scene_count: sc.max(0) as u64,
                word_count: wc.max(0) as u64,
                byte_size: sz.max(0) as u64,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    /// Load a snapshot with its package blob.
    pub fn snapshot(&self, id: &str) -> Result<Option<Snapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, description, created_at, author, head_version, scene_count, word_count, package_blob
             FROM snapshots
             WHERE id = ?1",
        )?;
        stmt.query_row([id], |r| {
            let hv: i64 = r.get(5)?;
            let sc: i64 = r.get(6)?;
            let wc: i64 = r.get(7)?;
            Ok(Snapshot {
                id: r.get(0)?,
                label: r.get(1)?,
                description: r.get(2)?,
                created_at: r.get(3)?,
                author: r.get(4)?,
                head_version: hv.max(0) as u64,
                scene_count: sc.max(0) as u64,
                word_count: wc.max(0) as u64,
                package_blob: r.get(8)?,
            })
        })
        .optional()
        .map_err(StoreError::Sql)
    }

    /// Delete a snapshot by ID.
    pub fn delete_snapshot(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM snapshots WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Update a snapshot's label and description.
    pub fn update_snapshot(&self, id: &str, label: &str, description: &str) -> Result<()> {
        if label.trim().is_empty() {
            return Err(StoreError::Invalid("a snapshot needs a label".into()));
        }
        self.conn.execute(
            "UPDATE snapshots SET label = ?2, description = ?3 WHERE id = ?1",
            params![id, label.trim(), description.trim()],
        )?;
        Ok(())
    }

    /// Restore a snapshot into a new working head.
    /// Non-destructive: preserves existing history and snapshots table.
    /// If `create_checkpoint` is true, takes a checkpoint snapshot of current state before restore.
    pub fn restore_snapshot(
        &mut self,
        id: &str,
        create_checkpoint: bool,
        checkpoint_label: Option<&str>,
    ) -> Result<SnapshotSummary> {
        let snap = self
            .snapshot(id)?
            .ok_or_else(|| StoreError::Invalid(format!("no snapshot with id {id}")))?;

        if create_checkpoint {
            let cp_label = checkpoint_label
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Checkpoint before restoring '{}'", snap.label));
            self.create_snapshot(&cp_label, "Automatic checkpoint before snapshot restore", "")?;
        }

        let tmp = self.path().with_extension(format!("restore-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, &snap.package_blob)?;

        {
            let mut snap_conn = Connection::open(&tmp)?;
            let snap_schema = store::schema_of(&tmp)?;
            if snap_schema > store::SCHEMA_VERSION {
                let _ = std::fs::remove_file(&tmp);
                return Err(StoreError::FutureSchema(snap_schema));
            }
            if snap_schema < store::SCHEMA_VERSION {
                store::migrate(&mut snap_conn, snap_schema)?;
            }
        }

        let current_v = self.version()?;
        let new_v = current_v + 1;

        // Atomic restore of domain tables from the snapshot database
        self.conn.execute("ATTACH DATABASE ?1 AS snap_db", [tmp.to_string_lossy()])?;

        let tables = [
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

        let res = (|| -> Result<()> {
            let tx = self.conn.transaction()?;
            for table in tables {
                tx.execute_batch(&format!(
                    "DELETE FROM {table}; INSERT INTO {table} SELECT * FROM snap_db.{table};"
                ))?;
            }
            tx.execute_batch(
                "DELETE FROM settings; INSERT INTO settings SELECT * FROM snap_db.settings;",
            )?;
            // Restore meta properties while bumping head version and marking unsaved
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
            tx.commit()?;
            Ok(())
        })();

        let _ = self.conn.execute_batch("DETACH DATABASE snap_db;");
        let _ = std::fs::remove_file(&tmp);

        res?;
        self.mark_unsaved()?;

        Ok(SnapshotSummary {
            id: snap.id,
            label: snap.label,
            description: snap.description,
            created_at: snap.created_at,
            author: snap.author,
            head_version: new_v,
            scene_count: snap.scene_count,
            word_count: snap.word_count,
            byte_size: snap.package_blob.len() as u64,
        })
    }
}
