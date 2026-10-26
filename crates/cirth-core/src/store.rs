//! Working store: one SQLite database per open project.
//!
//! Every acknowledged batch is committed in its own transaction with WAL and
//! `synchronous=FULL`, so an acknowledged batch survives a process kill.
//! The connection holds an exclusive lock for its lifetime, so a second
//! writer (another window or process) is refused at open time.
//!
//! A portable package (`.cirth`) is a consistent snapshot made with
//! `VACUUM INTO` a temp file, flushed, then renamed over the target. A
//! failed or interrupted package write leaves the previous package intact.

use crate::model::{Beat, Block, BlockKind, Document, Id, Run};
use crate::ops::{Ack, Batch, Op};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};

pub const SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub enum StoreError {
    /// Another connection or process holds the project.
    Locked,
    /// Written by a newer CirthScribe; refused rather than guessed at.
    FutureSchema(i64),
    Stale { base: u64, current: u64 },
    Invalid(String),
    Sql(rusqlite::Error),
    Io(std::io::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Locked => write!(f, "project is open in another CirthScribe window or process"),
            StoreError::FutureSchema(v) => write!(f, "project schema {v} is newer than this build supports ({SCHEMA_VERSION})"),
            StoreError::Stale { base, current } => write!(f, "stale change: based on v{base}, project is at v{current}"),
            StoreError::Invalid(m) => write!(f, "invalid change: {m}"),
            StoreError::Sql(e) => write!(f, "database error: {e}"),
            StoreError::Io(e) => write!(f, "file error: {e}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(f, _) = &e {
            if matches!(f.code, rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) {
                return StoreError::Locked;
            }
        }
        StoreError::Sql(e)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct Store {
    conn: Connection,
    path: PathBuf,
}

const SCHEMA: &str = "
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  ord REAL NOT NULL,
  kind TEXT NOT NULL,
  runs TEXT NOT NULL,
  scene_id TEXT UNIQUE,
  dual INTEGER NOT NULL DEFAULT 0,
  break_before INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX blocks_ord ON blocks(ord);
CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  created_version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE beats (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  scene_id TEXT,
  pos REAL NOT NULL
);
CREATE TABLE oplog (
  version INTEGER PRIMARY KEY,
  tx_id TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  batch TEXT NOT NULL
);
";

impl Store {
    /// Open or create a working store and take the exclusive writer lock.
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_millis(0))?;
        conn.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
        let user_version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if user_version > SCHEMA_VERSION {
            return Err(StoreError::FutureSchema(user_version));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        if user_version == 0 {
            conn.execute_batch(&format!("BEGIN; {SCHEMA} PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;"))?;
            conn.execute("INSERT INTO meta(key, value) VALUES ('version', '0'), ('saved_version', '0'), ('title', 'Untitled'), ('project_id', ?1)", [crate::model::new_id()])?;
        }
        // A write now takes and keeps the exclusive lock.
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('opened_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [])?;
        Ok(Store { conn, path: path.to_path_buf() })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)", params![key, value])?;
        Ok(())
    }

    pub fn version(&self) -> Result<u64> {
        Ok(self.meta("version")?.unwrap_or_default().parse().unwrap_or(0))
    }

    pub fn saved_version(&self) -> Result<u64> {
        Ok(self.meta("saved_version")?.unwrap_or_default().parse().unwrap_or(0))
    }

    /// True when the working store holds commits newer than the last package save,
    /// for example after a crash.
    pub fn has_unsaved_work(&self) -> Result<bool> {
        Ok(self.version()? > self.saved_version()?)
    }

    pub fn set_title(&self, title: &str) -> Result<()> {
        Self::set_meta(&self.conn, "title", title)
    }

    pub fn load(&self) -> Result<Document> {
        let mut stmt = self.conn.prepare("SELECT id, kind, runs, scene_id, dual, break_before FROM blocks ORDER BY ord")?;
        let blocks = stmt
            .query_map([], |r| {
                let kind: String = r.get(1)?;
                let runs: String = r.get(2)?;
                Ok(Block {
                    id: r.get(0)?,
                    kind: BlockKind::parse(&kind).unwrap_or(BlockKind::Action),
                    runs: serde_json::from_str::<Vec<Run>>(&runs).unwrap_or_default(),
                    scene_id: r.get(3)?,
                    dual: r.get::<_, i64>(4)? != 0,
                    break_before: r.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Document { title: self.meta("title")?.unwrap_or_default(), version: self.version()?, blocks })
    }

    /// Replace the whole document. Used only to seed a new project from an
    /// import or fixture, never for routine edits.
    pub fn seed(&mut self, doc: &Document) -> Result<Ack> {
        doc.validate().map_err(StoreError::Invalid)?;
        let mut ops = Vec::with_capacity(doc.blocks.len());
        let existing = self.load()?;
        for b in existing.blocks {
            ops.push(Op::Delete { id: b.id });
        }
        let mut after: Option<Id> = None;
        for b in &doc.blocks {
            ops.push(Op::Put { block: b.clone(), after: after.clone() });
            after = Some(b.id.clone());
        }
        self.set_title(&doc.title)?;
        let base = self.version()?;
        self.apply(&Batch { tx_id: crate::model::new_id(), base_version: base, ops })
    }

    pub fn apply(&mut self, batch: &Batch) -> Result<Ack> {
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(v) = tx.query_row("SELECT version FROM oplog WHERE tx_id = ?1", [&batch.tx_id], |r| r.get::<_, i64>(0)).optional()? {
            return Ok(Ack { version: v as u64, duplicate: true });
        }
        let current: u64 = tx.query_row("SELECT value FROM meta WHERE key='version'", [], |r| r.get::<_, String>(0))?.parse().unwrap_or(0);
        if batch.base_version != current {
            return Err(StoreError::Stale { base: batch.base_version, current });
        }
        let next = current + 1;
        for op in &batch.ops {
            apply_op(&tx, op, next)?;
        }
        Self::set_meta(&tx, "version", &next.to_string())?;
        tx.execute(
            "INSERT INTO oplog(version, tx_id, batch) VALUES (?1, ?2, ?3)",
            params![next as i64, batch.tx_id, serde_json::to_string(batch).unwrap_or_default()],
        )?;
        tx.commit()?;
        Ok(Ack { version: next, duplicate: false })
    }

    pub fn beats(&self) -> Result<Vec<Beat>> {
        let mut stmt = self.conn.prepare("SELECT id, summary, scene_id, pos FROM beats ORDER BY pos")?;
        let beats = stmt
            .query_map([], |r| Ok(Beat { id: r.get(0)?, summary: r.get(1)?, scene_id: r.get(2)?, pos: r.get(3)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(beats)
    }

    /// Planning edits. They never touch script text or script order.
    pub fn put_beat(&self, beat: &Beat) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO beats(id, summary, scene_id, pos) VALUES (?1, ?2, ?3, ?4)",
            params![beat.id, beat.summary, beat.scene_id, beat.pos],
        )?;
        Ok(())
    }

    /// Write a consistent snapshot to `dest` via temp file and rename.
    pub fn save_package(&self, dest: &Path) -> Result<u64> {
        let version = self.version()?;
        let tmp = dest.with_extension("cirth.tmp");
        if tmp.exists() {
            std::fs::remove_file(&tmp)?;
        }
        self.conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
        {
            let pkg = Connection::open(&tmp)?;
            pkg.execute("UPDATE meta SET value = ?1 WHERE key = 'saved_version'", [version.to_string()])?;
            pkg.execute("DELETE FROM meta WHERE key = 'opened_at'", [])?;
            let ok: String = pkg.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if ok != "ok" {
                return Err(StoreError::Invalid(format!("package snapshot failed integrity check: {ok}")));
            }
        }
        // FlushFileBuffers needs a writable handle on Windows.
        std::fs::OpenOptions::new().write(true).open(&tmp)?.sync_all()?;
        std::fs::rename(&tmp, dest)?;
        Self::set_meta(&self.conn, "saved_version", &version.to_string())?;
        Ok(version)
    }

    /// Start a working store from a package. If a working store for the same
    /// project already holds unsaved commits, it is kept (recovery) and the
    /// package is not copied over it.
    pub fn open_package(pkg: &Path, work: &Path) -> Result<(Store, bool)> {
        if work.exists() {
            let candidate = Store::open(work)?;
            let same_project = {
                let p = Connection::open_with_flags(pkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let pid: Option<String> = p.query_row("SELECT value FROM meta WHERE key='project_id'", [], |r| r.get(0)).optional()?;
                pid == candidate.meta("project_id")?
            };
            if same_project && candidate.has_unsaved_work()? {
                return Ok((candidate, true));
            }
            drop(candidate);
            remove_store_files(work)?;
        }
        {
            let p = Connection::open_with_flags(pkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let v: i64 = p.pragma_query_value(None, "user_version", |r| r.get(0))?;
            if v > SCHEMA_VERSION {
                return Err(StoreError::FutureSchema(v));
            }
        }
        std::fs::copy(pkg, work)?;
        Ok((Store::open(work)?, false))
    }

    pub fn integrity_ok(&self) -> Result<bool> {
        let ok: String = self.conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        Ok(ok == "ok")
    }

    /// Test hook: start a write transaction and never finish it.
    pub fn begin_and_hang_for_test(&mut self, rows: usize) -> Result<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        for i in 0..rows {
            self.conn.execute(
                "INSERT INTO blocks(id, ord, kind, runs) VALUES (?1, ?2, 'action', '[]')",
                params![format!("inflight-{i}"), 1e9 + i as f64],
            )?;
        }
        Ok(())
    }
}

pub fn remove_store_files(work: &Path) -> Result<()> {
    for suffix in ["", "-wal", "-shm"] {
        let p = PathBuf::from(format!("{}{suffix}", work.display()));
        if p.exists() {
            std::fs::remove_file(p)?;
        }
    }
    Ok(())
}

fn check_scene_attr(b: &Block) -> Result<()> {
    match (b.kind, &b.scene_id) {
        (BlockKind::Heading, None) => Err(StoreError::Invalid(format!("heading {} has no scene id", b.id))),
        (k, Some(_)) if k != BlockKind::Heading => Err(StoreError::Invalid(format!("non-heading {} has a scene id", b.id))),
        _ => Ok(()),
    }
}

fn ord_of(tx: &Connection, id: &str) -> Result<Option<f64>> {
    Ok(tx.query_row("SELECT ord FROM blocks WHERE id = ?1", [id], |r| r.get(0)).optional()?)
}

fn ord_after(tx: &Connection, after: Option<&str>, moving: &str) -> Result<f64> {
    let lo = match after {
        Some(a) => ord_of(tx, a)?.ok_or_else(|| StoreError::Invalid(format!("unknown anchor block {a}")))?,
        None => f64::NEG_INFINITY,
    };
    let hi: Option<f64> = if lo.is_finite() {
        tx.query_row("SELECT MIN(ord) FROM blocks WHERE ord > ?1 AND id <> ?2", params![lo, moving], |r| r.get(0))?
    } else {
        tx.query_row("SELECT MIN(ord) FROM blocks WHERE id <> ?1", [moving], |r| r.get(0))?
    };
    let pos = match (lo.is_finite(), hi) {
        (false, None) => 0.0,
        (false, Some(h)) => h - 1.0,
        (true, None) => lo + 1.0,
        (true, Some(h)) => (lo + h) / 2.0,
    };
    if lo.is_finite() && hi.is_some_and(|h| h - lo < 1e-9) {
        renumber(tx)?;
        return ord_after(tx, after, moving);
    }
    Ok(pos)
}

fn renumber(tx: &Connection) -> Result<()> {
    let ids: Vec<String> = tx
        .prepare("SELECT id FROM blocks ORDER BY ord")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE blocks SET ord = ?1 WHERE id = ?2", params![i as f64, id])?;
    }
    Ok(())
}

fn write_block(tx: &Connection, b: &Block, ord: f64, version: u64) -> Result<()> {
    check_scene_attr(b)?;
    let old_scene: Option<Option<String>> = tx.query_row("SELECT scene_id FROM blocks WHERE id = ?1", [&b.id], |r| r.get(0)).optional()?;
    if let Some(Some(old)) = &old_scene {
        if b.scene_id.as_ref() != Some(old) {
            tx.execute("UPDATE scenes SET active = 0 WHERE id = ?1", [old])?;
        }
    }
    if let Some(sid) = &b.scene_id {
        tx.execute("INSERT INTO scenes(id, created_version) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET active = 1", params![sid, version as i64])?;
    }
    tx.execute(
        "INSERT INTO blocks(id, ord, kind, runs, scene_id, dual, break_before) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, kind = excluded.kind, runs = excluded.runs,
           scene_id = excluded.scene_id, dual = excluded.dual, break_before = excluded.break_before",
        params![b.id, ord, b.kind.as_str(), serde_json::to_string(&b.runs).unwrap_or_default(), b.scene_id, b.dual as i64, b.break_before as i64],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            StoreError::Invalid(format!("block {} reuses a scene id already in the document", b.id))
        }
        _ => StoreError::from(e),
    })?;
    Ok(())
}

fn apply_op(tx: &Connection, op: &Op, version: u64) -> Result<()> {
    match op {
        Op::Put { block, after } => {
            if after.as_deref() == Some(block.id.as_str()) {
                return Err(StoreError::Invalid("block placed after itself".into()));
            }
            let ord = ord_after(tx, after.as_deref(), &block.id)?;
            write_block(tx, block, ord, version)
        }
        Op::Update { block } => {
            let ord = ord_of(tx, &block.id)?.ok_or_else(|| StoreError::Invalid(format!("update of unknown block {}", block.id)))?;
            write_block(tx, block, ord, version)
        }
        Op::Delete { id } => {
            let scene: Option<Option<String>> = tx.query_row("SELECT scene_id FROM blocks WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            match scene {
                None => Err(StoreError::Invalid(format!("delete of unknown block {id}"))),
                Some(s) => {
                    if let Some(sid) = s {
                        tx.execute("UPDATE scenes SET active = 0 WHERE id = ?1", [sid])?;
                    }
                    tx.execute("DELETE FROM blocks WHERE id = ?1", [id])?;
                    Ok(())
                }
            }
        }
    }
}
