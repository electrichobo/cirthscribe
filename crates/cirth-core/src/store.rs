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
//!
//! Schema versions: a new database is created at v1 (`SCHEMA_V1`, frozen)
//! and brought forward by the same numbered migrations that upgrade old
//! files, so new and upgraded projects cannot drift apart. All pending
//! migrations run in one transaction together with the `user_version`
//! update: a crash leaves the old schema intact. Opening an older package
//! first copies the untouched original into the backup folder.

use crate::model::{Beat, Block, BlockKind, Document, Id, Run};
use crate::ops::{Ack, Batch, Op};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SCHEMA_VERSION: i64 = 6;

static CRASH_HOOK: std::sync::OnceLock<fn(&'static str)> = std::sync::OnceLock::new();

/// Test hook for the crash tests: `f` is called at each named point of a
/// package save and a migration, so a child process can stop there and be
/// killed. Never set by the app.
#[doc(hidden)]
pub fn set_crash_hook_for_test(f: fn(&'static str)) {
    let _ = CRASH_HOOK.set(f);
}

fn crash_point(name: &'static str) {
    if let Some(f) = CRASH_HOOK.get() {
        f(name);
    }
}

#[derive(Debug)]
pub enum StoreError {
    /// Another connection or process holds the project.
    Locked,
    /// Written by a newer Kolbítar; refused rather than guessed at.
    FutureSchema(i64),
    Stale { base: u64, current: u64 },
    Invalid(String),
    Sql(rusqlite::Error),
    Io(std::io::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Locked => write!(f, "project is open in another Kolbítar window or process"),
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

/// Scene label colours, in palette order (names are the project's, see `label_names`).
pub const LABELS: [&str; 8] = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"];

/// One folder or document in a project's tree (`Store::project_tree`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TreeItem {
    pub id: Id,
    /// "folder", or the document's kind ("screenplay").
    pub kind: String,
    pub title: String,
    /// The folder it is in; None at the top level.
    pub parent: Option<Id>,
    pub pos: f64,
    /// Scenes in a document (0 for a folder).
    pub scenes: u64,
}

pub struct Store {
    conn: Connection,
    path: PathBuf,
    migrated_from: Option<i64>,
}

/// Schema v1 exactly as shipped in M0. Frozen: never edit, add a migration.
const SCHEMA_V1: &str = "
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

/// v1 -> v2: documents (a project can hold several), a container tree for
/// series/season/episode grouping, per-project and per-document settings.
/// Every existing block and beat moves into one default document titled
/// like the project. Ids, order, text and history are unchanged.
fn migrate_v2(tx: &Transaction) -> Result<()> {
    tx.execute_batch(
        "
        CREATE TABLE containers (
          id TEXT PRIMARY KEY,
          parent_id TEXT REFERENCES containers(id),
          title TEXT NOT NULL,
          pos REAL NOT NULL
        );
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          profile TEXT NOT NULL,
          container_id TEXT REFERENCES containers(id),
          pos REAL NOT NULL
        );
        CREATE TABLE settings (
          scope TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (scope, key)
        );
        ALTER TABLE blocks ADD COLUMN document_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE beats ADD COLUMN document_id TEXT NOT NULL DEFAULT '';
        CREATE INDEX blocks_doc_ord ON blocks(document_id, ord);
        ",
    )?;
    let doc = crate::model::new_id();
    let title: String = tx.query_row("SELECT value FROM meta WHERE key = 'title'", [], |r| r.get(0)).optional()?.unwrap_or_else(|| "Untitled".into());
    tx.execute("INSERT INTO documents(id, kind, title, profile, container_id, pos) VALUES (?1, 'screenplay', ?2, 'us-letter', NULL, 0)", params![doc, title])?;
    tx.execute("UPDATE blocks SET document_id = ?1", [&doc])?;
    tx.execute("UPDATE beats SET document_id = ?1", [&doc])?;
    tx.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('default_document', ?1)", [&doc])?;
    Ok(())
}

/// v2 -> v3: beats get a logline (one authored line shown on cards above
/// the summary). Existing beats get an empty one; nothing else changes.
fn migrate_v3(tx: &Transaction) -> Result<()> {
    tx.execute_batch("ALTER TABLE beats ADD COLUMN logline TEXT NOT NULL DEFAULT '';")?;
    Ok(())
}

/// v3 -> v4: locked scene numbers, by document and stable scene id (see
/// numbering.rs). Existing projects start unlocked, with no numbers.
fn migrate_v4(tx: &Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE scene_numbers (
          document_id TEXT NOT NULL,
          scene_id TEXT NOT NULL,
          number TEXT NOT NULL,
          omitted INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (document_id, scene_id)
        );",
    )?;
    Ok(())
}

/// v4 -> v5: revision sets per document (revisions.rs). Revision tags live
/// on text runs (`Run::revision`, already free-form JSON); no set exists yet.
fn migrate_v5(tx: &Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE revision_sets (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          label TEXT NOT NULL,
          colour TEXT NOT NULL,
          date TEXT NOT NULL,
          mark TEXT NOT NULL,
          author TEXT NOT NULL,
          pos REAL NOT NULL
        );",
    )?;
    Ok(())
}

/// v5 -> v6: a colour label per scene (the navigator, M3 step 3). Keyed by
/// stable scene id; no row means no label. Existing scenes start without one.
fn migrate_v6(tx: &Transaction) -> Result<()> {
    tx.execute_batch("CREATE TABLE scene_labels (scene_id TEXT PRIMARY KEY, label TEXT NOT NULL);")?;
    Ok(())
}

type Migration = fn(&Transaction) -> Result<()>;

/// (target version, step). Append only; never edit a shipped step.
const MIGRATIONS: &[(i64, Migration)] = &[(2, migrate_v2), (3, migrate_v3), (4, migrate_v4), (5, migrate_v5), (6, migrate_v6)];

/// Bring a database from `from` to `SCHEMA_VERSION` in one transaction.
fn migrate(conn: &mut Connection, from: i64) -> Result<()> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for (to, step) in MIGRATIONS.iter().filter(|(to, _)| *to > from) {
        step(&tx)?;
        tx.pragma_update(None, "user_version", to)?;
    }
    crash_point("migration-uncommitted");
    tx.commit()?;
    Ok(())
}

/// Schema version of a database file, read without taking any lock.
pub fn schema_of(path: &Path) -> Result<i64> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(c.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

/// Result of opening a package for editing.
pub struct OpenedPackage {
    pub store: Store,
    /// Unsaved commits from an earlier session were recovered.
    pub recovered: bool,
    /// The project was in an older format and was upgraded in the working copy.
    pub migrated_from: Option<i64>,
    /// Untouched copy of the older-format package, kept before upgrading.
    pub pre_migration_backup: Option<PathBuf>,
}

impl Store {
    /// Open or create a working store, upgrade its schema if it is older,
    /// and take the exclusive writer lock.
    pub fn open(path: &Path) -> Result<Store> {
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_millis(0))?;
        conn.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
        let mut user_version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if user_version > SCHEMA_VERSION {
            return Err(StoreError::FutureSchema(user_version));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        let mut migrated_from = None;
        if user_version == 0 {
            conn.execute_batch(&format!("BEGIN; {SCHEMA_V1} PRAGMA user_version = 1;"))?;
            conn.execute("INSERT INTO meta(key, value) VALUES ('version', '0'), ('saved_version', '0'), ('title', 'Untitled'), ('project_id', ?1)", [crate::model::new_id()])?;
            conn.execute_batch("COMMIT;")?;
            user_version = 1;
        } else if user_version < SCHEMA_VERSION {
            migrated_from = Some(user_version);
        }
        if user_version < SCHEMA_VERSION {
            migrate(&mut conn, user_version)?;
        }
        // A write now takes and keeps the exclusive lock.
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('opened_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [])?;
        Ok(Store { conn, path: path.to_path_buf(), migrated_from })
    }

    /// Schema version this store was upgraded from when it was opened.
    pub fn migrated_from(&self) -> Option<i64> {
        self.migrated_from
    }

    pub fn default_document(&self) -> Result<Id> {
        self.meta("default_document")?.ok_or_else(|| StoreError::Invalid("project has no default document".into()))
    }

    /// Page profile of a document: "us-letter" or "a4".
    pub fn document_profile(&self, document_id: &str) -> Result<String> {
        Ok(self.conn.query_row("SELECT profile FROM documents WHERE id = ?1", [document_id], |r| r.get(0))?)
    }

    pub fn set_document_profile(&self, document_id: &str, profile: &str) -> Result<()> {
        if !matches!(profile, "us-letter" | "a4") {
            return Err(StoreError::Invalid(format!("unknown page profile {profile}")));
        }
        if self.page_lock(document_id)?.is_some() && self.document_profile(document_id)? != profile {
            return Err(StoreError::Invalid("pages are locked for the current page size; unlock pages before changing it".into()));
        }
        let n = self.conn.execute("UPDATE documents SET profile = ?2 WHERE id = ?1", [document_id, profile])?;
        if n == 0 {
            return Err(StoreError::Invalid(format!("no document {document_id}")));
        }
        Ok(())
    }

    // --- Episodes and series (M3 step 2) -------------------------------------
    //
    // A project is a tree: folders (containers: a series, a season) holding
    // documents (episodes, a feature) and other folders, each ordered by `pos`
    // among its siblings. One document is "current": the editor, scene list,
    // board, numbering, revisions and exports work on it. Ids never change;
    // titles are labels.

    /// The document the editor shows (the default one until another is opened).
    pub fn current_document(&self) -> Result<Id> {
        if let Some(id) = self.meta("current_document")? {
            if self.conn.query_row("SELECT 1 FROM documents WHERE id = ?1", [&id], |_| Ok(())).optional()?.is_some() {
                return Ok(id);
            }
        }
        self.default_document()
    }

    pub fn set_current_document(&self, id: &str) -> Result<()> {
        if self.conn.query_row("SELECT 1 FROM documents WHERE id = ?1", [id], |_| Ok(())).optional()?.is_none() {
            return Err(StoreError::Invalid(format!("no document {id}")));
        }
        Self::set_meta(&self.conn, "current_document", id)
    }

    /// Every folder and document, each with its parent folder and position.
    pub fn project_tree(&self) -> Result<Vec<TreeItem>> {
        let mut out = Vec::new();
        let mut stmt = self.conn.prepare("SELECT id, title, parent_id, pos FROM containers ORDER BY pos")?;
        for r in stmt.query_map([], |r| Ok(TreeItem { id: r.get(0)?, kind: "folder".into(), title: r.get(1)?, parent: r.get(2)?, pos: r.get(3)?, scenes: 0 }))? {
            out.push(r?);
        }
        let mut stmt = self.conn.prepare(
            "SELECT d.id, d.kind, d.title, d.container_id, d.pos, (SELECT COUNT(*) FROM blocks b WHERE b.document_id = d.id AND b.scene_id IS NOT NULL) FROM documents d ORDER BY d.pos",
        )?;
        for r in stmt.query_map([], |r| Ok(TreeItem { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, parent: r.get(3)?, pos: r.get(4)?, scenes: r.get::<_, i64>(5)? as u64 }))? {
            out.push(r?);
        }
        out.sort_by(|a, b| a.pos.total_cmp(&b.pos));
        Ok(out)
    }

    fn check_folder(&self, folder: Option<&str>) -> Result<()> {
        if let Some(f) = folder {
            if self.conn.query_row("SELECT 1 FROM containers WHERE id = ?1", [f], |_| Ok(())).optional()?.is_none() {
                return Err(StoreError::Invalid(format!("no folder {f}")));
            }
        }
        Ok(())
    }

    fn next_pos(&self, folder: Option<&str>) -> Result<f64> {
        Ok(self.project_tree()?.iter().filter(|i| i.parent.as_deref() == folder).map(|i| i.pos).fold(0.0, f64::max) + 1.0)
    }

    /// A new folder (a series or a season), last in `parent`.
    pub fn create_folder(&self, title: &str, parent: Option<&str>) -> Result<Id> {
        self.check_folder(parent)?;
        let id = crate::model::new_id();
        let pos = self.next_pos(parent)?;
        self.conn.execute("INSERT INTO containers(id, parent_id, title, pos) VALUES (?1, ?2, ?3, ?4)", params![id, parent, title.trim(), pos])?;
        self.mark_unsaved()?;
        Ok(id)
    }

    /// A new screenplay document (an episode), last in `folder`, starting
    /// with one empty scene heading, like a new project.
    pub fn create_episode(&mut self, title: &str, folder: Option<&str>) -> Result<Id> {
        self.check_folder(folder)?;
        let id = crate::model::new_id();
        let pos = self.next_pos(folder)?;
        self.conn.execute("INSERT INTO documents(id, kind, title, profile, container_id, pos) VALUES (?1, 'screenplay', ?2, 'us-letter', ?3, ?4)", params![id, title.trim(), folder, pos])?;
        let base = self.version()?;
        self.apply(&Batch { tx_id: crate::model::new_id(), base_version: base, document_id: Some(id.clone()), ops: vec![Op::Put { block: Block::new(BlockKind::Heading, ""), after: None }] })?;
        Ok(id)
    }

    /// Rename a folder or a document. The default document's title is also
    /// the project's title (as on Home).
    pub fn rename_item(&self, id: &str, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err(StoreError::Invalid("a title cannot be empty".into()));
        }
        if self.default_document()? == id {
            self.set_title(title)?;
        } else if self.conn.execute("UPDATE documents SET title = ?2 WHERE id = ?1", [id, title])? == 0 && self.conn.execute("UPDATE containers SET title = ?2 WHERE id = ?1", [id, title])? == 0 {
            return Err(StoreError::Invalid(format!("nothing called {id} in this project")));
        }
        self.mark_unsaved()
    }

    /// Move a folder or document into `parent` (None: the top level) at
    /// position `index` among its new siblings. A folder cannot go inside
    /// itself or one of its own folders.
    pub fn move_item(&self, id: &str, parent: Option<&str>, index: usize) -> Result<()> {
        self.check_folder(parent)?;
        let tree = self.project_tree()?;
        let Some(item) = tree.iter().find(|i| i.id == id) else {
            return Err(StoreError::Invalid(format!("nothing called {id} in this project")));
        };
        if item.kind == "folder" {
            let mut at = parent.map(str::to_string);
            while let Some(p) = at {
                if p == id {
                    return Err(StoreError::Invalid("a folder cannot go inside itself".into()));
                }
                at = tree.iter().find(|i| i.id == p).and_then(|i| i.parent.clone());
            }
        }
        let mut siblings: Vec<&TreeItem> = tree.iter().filter(|i| i.parent.as_deref() == parent && i.id != id).collect();
        siblings.insert(index.min(siblings.len()), item);
        let tx = self.conn.unchecked_transaction()?;
        for (i, it) in siblings.iter().enumerate() {
            let pos = (i + 1) as f64;
            if it.kind == "folder" {
                tx.execute("UPDATE containers SET pos = ?2, parent_id = ?3 WHERE id = ?1", params![it.id, pos, parent])?;
            } else {
                tx.execute("UPDATE documents SET pos = ?2, container_id = ?3 WHERE id = ?1", params![it.id, pos, parent])?;
            }
        }
        tx.commit()?;
        self.mark_unsaved()
    }

    /// Add an empty document (for multi-document projects; no UI yet).
    pub fn create_document(&self, title: &str) -> Result<Id> {
        let id = crate::model::new_id();
        self.conn.execute(
            "INSERT INTO documents(id, kind, title, profile, container_id, pos) VALUES (?1, 'screenplay', ?2, 'us-letter', NULL, (SELECT COALESCE(MAX(pos), 0) + 1 FROM documents))",
            params![id, title],
        )?;
        Ok(id)
    }

    pub fn documents(&self) -> Result<Vec<(Id, String)>> {
        let mut stmt = self.conn.prepare("SELECT id, title FROM documents ORDER BY pos")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // --- Scene numbers (numbering.rs) ---------------------------------------

    pub fn scene_numbers_locked(&self, document_id: &str) -> Result<bool> {
        Ok(self.setting(&format!("document:{document_id}"), "scene_numbers_locked")?.as_deref() == Some("1"))
    }

    pub fn scene_numbers(&self, document_id: &str) -> Result<crate::numbering::Numbers> {
        let mut stmt = self.conn.prepare("SELECT scene_id, number, omitted FROM scene_numbers WHERE document_id = ?1")?;
        let rows = stmt.query_map([document_id], |r| Ok(crate::numbering::SceneNumber { scene_id: r.get(0)?, number: r.get(1)?, omitted: r.get::<_, i64>(2)? != 0 }))?;
        let mut out = crate::numbering::Numbers::new();
        for n in rows {
            let n = n?;
            out.insert(n.scene_id.clone(), n);
        }
        Ok(out)
    }

    /// Scene ids of the default document's headings, in script order.
    fn scene_order(&self) -> Result<Vec<String>> {
        Ok(self.load()?.blocks.iter().filter_map(|b| b.scene_id.clone()).collect())
    }

    /// Number every scene 1..N in script order and lock the numbers.
    pub fn lock_scene_numbers(&self, document_id: &str) -> Result<usize> {
        let order = self.scene_order()?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM scene_numbers WHERE document_id = ?1", [document_id])?;
        for (i, id) in order.iter().enumerate() {
            tx.execute("INSERT INTO scene_numbers(document_id, scene_id, number, omitted) VALUES (?1, ?2, ?3, 0)", params![document_id, id, (i + 1).to_string()])?;
        }
        tx.execute("INSERT OR REPLACE INTO settings(scope, key, value) VALUES (?1, 'scene_numbers_locked', '1')", [format!("document:{document_id}")])?;
        tx.commit()?;
        Ok(order.len())
    }

    /// Remove all scene numbers (and omissions) and unlock.
    pub fn unlock_scene_numbers(&self, document_id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM scene_numbers WHERE document_id = ?1", [document_id])?;
        tx.execute("INSERT OR REPLACE INTO settings(scope, key, value) VALUES (?1, 'scene_numbers_locked', '0')", [format!("document:{document_id}")])?;
        tx.commit()?;
        Ok(())
    }

    /// While locked, give scenes added since locking their A/B numbers
    /// (idempotent; run after edits). Returns how many were numbered.
    pub fn number_new_scenes(&self, document_id: &str) -> Result<usize> {
        if !self.scene_numbers_locked(document_id)? {
            return Ok(0);
        }
        let new = crate::numbering::assign_missing(&self.scene_order()?, &self.scene_numbers(document_id)?);
        for (id, n) in &new {
            self.conn.execute("INSERT INTO scene_numbers(document_id, scene_id, number, omitted) VALUES (?1, ?2, ?3, 0)", params![document_id, id, n])?;
        }
        Ok(new.len())
    }

    /// Lock with numbers that came with an import (FDX, Fountain); scenes
    /// without one get A/B numbers from their neighbours.
    pub fn lock_scene_numbers_with(&self, document_id: &str, given: &[(String, String)]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM scene_numbers WHERE document_id = ?1", [document_id])?;
        for (id, n) in given {
            tx.execute("INSERT OR IGNORE INTO scene_numbers(document_id, scene_id, number, omitted) VALUES (?1, ?2, ?3, 0)", params![document_id, id, n])?;
        }
        tx.execute("INSERT OR REPLACE INTO settings(scope, key, value) VALUES (?1, 'scene_numbers_locked', '1')", [format!("document:{document_id}")])?;
        tx.commit()?;
        self.number_new_scenes(document_id)?;
        Ok(())
    }

    /// Omit or restore a numbered scene. Its number and text are kept.
    pub fn set_scene_omitted(&self, document_id: &str, scene_id: &str, omitted: bool) -> Result<()> {
        let n = self.conn.execute("UPDATE scene_numbers SET omitted = ?3 WHERE document_id = ?1 AND scene_id = ?2", params![document_id, scene_id, omitted as i64])?;
        if n == 0 {
            return Err(StoreError::Invalid("only scenes with a locked number can be omitted".into()));
        }
        Ok(())
    }

    // --- Revision sets (revisions.rs) ---------------------------------------

    /// A document's revision sets in the order they were created.
    pub fn revision_sets(&self, document_id: &str) -> Result<Vec<crate::revisions::RevisionSet>> {
        let mut stmt = self.conn.prepare("SELECT id, label, colour, date, mark, author FROM revision_sets WHERE document_id = ?1 ORDER BY pos")?;
        let rows = stmt
            .query_map([document_id], |r| Ok(crate::revisions::RevisionSet { id: r.get(0)?, label: r.get(1)?, colour: r.get(2)?, date: r.get(3)?, mark: r.get(4)?, author: r.get(5)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Add a set (at the end) or change an existing one in place.
    pub fn put_revision_set(&self, document_id: &str, set: &crate::revisions::RevisionSet) -> Result<()> {
        if set.id.trim().is_empty() || set.label.trim().is_empty() {
            return Err(StoreError::Invalid("a revision set needs an id and a label".into()));
        }
        if !crate::revisions::COLOURS.contains(&set.colour.as_str()) {
            return Err(StoreError::Invalid(format!("unknown revision colour {}", set.colour)));
        }
        let n = self.conn.execute(
            "UPDATE revision_sets SET label = ?3, colour = ?4, date = ?5, mark = ?6, author = ?7 WHERE id = ?1 AND document_id = ?2",
            params![set.id, document_id, set.label.trim(), set.colour, set.date.trim(), set.mark.trim(), set.author.trim()],
        )?;
        if n == 0 {
            self.conn.execute(
                "INSERT INTO revision_sets(id, document_id, label, colour, date, mark, author, pos) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(pos), 0) + 1 FROM revision_sets))",
                params![set.id, document_id, set.label.trim(), set.colour, set.date.trim(), set.mark.trim(), set.author.trim()],
            )?;
        }
        Ok(())
    }

    /// Remove a set that no text is tagged with (mistakes); a set in use is refused.
    pub fn delete_revision_set(&self, document_id: &str, id: &str) -> Result<()> {
        if crate::revisions::passages(&self.load_document(document_id)?.blocks, id) > 0 {
            return Err(StoreError::Invalid("this revision set still marks text in the script; clear its marks first".into()));
        }
        self.conn.execute("DELETE FROM revision_sets WHERE id = ?1 AND document_id = ?2", [id, document_id])?;
        if self.active_revision(document_id)?.is_none() {
            self.set_active_revision(document_id, None)?;
        }
        Ok(())
    }

    /// The set new changes go into and exports print (if any).
    pub fn active_revision(&self, document_id: &str) -> Result<Option<crate::revisions::RevisionSet>> {
        let id = self.setting(&format!("document:{document_id}"), "revision_active")?.unwrap_or_default();
        Ok(self.revision_sets(document_id)?.into_iter().find(|s| s.id == id))
    }

    pub fn set_active_revision(&self, document_id: &str, id: Option<&str>) -> Result<()> {
        if let Some(id) = id {
            if !self.revision_sets(document_id)?.iter().any(|s| s.id == id) {
                return Err(StoreError::Invalid(format!("no revision set {id}")));
            }
        }
        let scope = format!("document:{document_id}");
        self.set_setting(&scope, "revision_active", id.unwrap_or(""))?;
        if id.is_none() {
            self.set_setting(&scope, "revision_mode", "0")?;
        }
        Ok(())
    }

    /// Revision mode: the editor tags changes with the active set.
    pub fn revision_mode(&self, document_id: &str) -> Result<bool> {
        Ok(self.setting(&format!("document:{document_id}"), "revision_mode")?.as_deref() == Some("1") && self.active_revision(document_id)?.is_some())
    }

    pub fn set_revision_mode(&self, document_id: &str, on: bool) -> Result<()> {
        if on && self.active_revision(document_id)?.is_none() {
            return Err(StoreError::Invalid("choose or add a revision set first".into()));
        }
        self.set_setting(&format!("document:{document_id}"), "revision_mode", if on { "1" } else { "0" })
    }

    // --- Locked pages (locked.rs) ------------------------------------------

    /// The document's locked page baseline, if its pages are locked.
    pub fn page_lock(&self, document_id: &str) -> Result<Option<crate::locked::PageLock>> {
        let json = self.setting(&format!("document:{document_id}"), "page_lock")?.filter(|j| !j.is_empty());
        json.map(|j| serde_json::from_str(&j).map_err(|e| StoreError::Invalid(format!("unreadable page lock: {e}")))).transpose()
    }

    /// Lock pages as laid out in `map` (the current production layout).
    pub fn lock_pages(&self, document_id: &str, map: &crate::layout::PageMap) -> Result<usize> {
        if self.page_lock(document_id)?.is_some() {
            return Err(StoreError::Invalid("pages are already locked; unlock them first to lock a new baseline".into()));
        }
        let lock = crate::locked::PageLock::from_map(map);
        let json = serde_json::to_string(&lock).map_err(|e| StoreError::Invalid(e.to_string()))?;
        self.set_setting(&format!("document:{document_id}"), "page_lock", &json)?;
        Ok(lock.labels.len())
    }

    /// Unlock: pages flow freely again and A pages are renumbered.
    pub fn unlock_pages(&self, document_id: &str) -> Result<()> {
        self.set_setting(&format!("document:{document_id}"), "page_lock", "")
    }

    /// A document's title page (empty if never set).
    pub fn title_page(&self, document_id: &str) -> Result<crate::title::TitlePage> {
        let json = self.setting(&format!("document:{document_id}"), "title_page")?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default())
    }

    pub fn set_title_page(&self, document_id: &str, tp: &crate::title::TitlePage) -> Result<()> {
        if self.conn.query_row("SELECT COUNT(*) FROM documents WHERE id = ?1", [document_id], |r| r.get::<_, i64>(0))? == 0 {
            return Err(StoreError::Invalid(format!("no document {document_id}")));
        }
        let json = serde_json::to_string(tp).map_err(|e| StoreError::Invalid(e.to_string()))?;
        self.set_setting(&format!("document:{document_id}"), "title_page", &json)
    }

    /// "Board may reorder script" for a document (PRODUCT_SPEC 3: a stored,
    /// per-document permission; off unless the writer turns it on).
    pub fn board_structural(&self, document_id: &str) -> Result<bool> {
        Ok(self.setting(&format!("document:{document_id}"), "board_structural")?.as_deref() == Some("1"))
    }

    pub fn set_board_structural(&self, document_id: &str, on: bool) -> Result<()> {
        self.set_setting(&format!("document:{document_id}"), "board_structural", if on { "1" } else { "0" })
    }

    // --- Scene labels (navigator, M3 step 3) ---------------------------------

    /// Every labelled scene: scene id -> palette key (`LABELS`).
    pub fn scene_labels(&self) -> Result<std::collections::HashMap<Id, String>> {
        let mut stmt = self.conn.prepare("SELECT scene_id, label FROM scene_labels")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn scene_label(&self, scene_id: &str) -> Result<String> {
        Ok(self.conn.query_row("SELECT label FROM scene_labels WHERE scene_id = ?1", [scene_id], |r| r.get(0)).optional()?.unwrap_or_default())
    }

    /// Give a scene a label ("" removes it). Planning data: use the planning
    /// command (`PlanningOp::SetSceneLabel`) so it can be undone.
    pub fn set_scene_label(&self, scene_id: &str, label: &str) -> Result<()> {
        if label.is_empty() {
            self.conn.execute("DELETE FROM scene_labels WHERE scene_id = ?1", [scene_id])?;
        } else if LABELS.contains(&label) {
            self.conn.execute("INSERT OR REPLACE INTO scene_labels(scene_id, label) VALUES (?1, ?2)", [scene_id, label])?;
        } else {
            return Err(StoreError::Invalid(format!("unknown label {label}")));
        }
        self.mark_unsaved()
    }

    /// The label palette with the project's names for it (renamable; the
    /// colour stays, so a label is always shown with its name).
    pub fn label_names(&self) -> Result<Vec<(String, String)>> {
        let custom: std::collections::HashMap<String, String> = self.setting("project", "label_names")?.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
        Ok(LABELS.iter().map(|k| (k.to_string(), custom.get(*k).cloned().unwrap_or_else(|| { let mut n = k.to_string(); n[..1].make_ascii_uppercase(); n }))).collect())
    }

    pub fn set_label_name(&self, key: &str, name: &str) -> Result<()> {
        if !LABELS.contains(&key) {
            return Err(StoreError::Invalid(format!("unknown label {key}")));
        }
        let mut custom: std::collections::HashMap<String, String> = self.setting("project", "label_names")?.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
        let name = name.trim();
        if name.is_empty() {
            custom.remove(key);
        } else {
            custom.insert(key.to_string(), name.chars().take(40).collect());
        }
        self.set_setting("project", "label_names", &serde_json::to_string(&custom).unwrap_or_default())
    }

    /// Every document's blocks, in tree order (folders first-come), for project-wide views.
    pub fn all_documents(&self) -> Result<Vec<(Id, String, Vec<Block>)>> {
        let tree = self.project_tree()?;
        let mut order: Vec<&TreeItem> = Vec::new();
        fn walk<'a>(tree: &'a [TreeItem], parent: Option<&str>, out: &mut Vec<&'a TreeItem>) {
            let mut kids: Vec<&TreeItem> = tree.iter().filter(|i| i.parent.as_deref() == parent).collect();
            kids.sort_by(|a, b| a.pos.total_cmp(&b.pos));
            for k in kids {
                if k.kind == "folder" {
                    walk(tree, Some(&k.id), out);
                } else {
                    out.push(k);
                }
            }
        }
        walk(&tree, None, &mut order);
        order.into_iter().map(|d| Ok((d.id.clone(), d.title.clone(), self.load_document(&d.id)?.blocks))).collect()
    }

    /// The project's notes panel: free text saved with the project and tied
    /// to no document, scene or block (owner, 2026-10-28). Empty if never written.
    pub fn project_notes(&self) -> Result<String> {
        Ok(self.setting("project", "notes")?.unwrap_or_default())
    }

    pub fn set_project_notes(&self, text: &str) -> Result<()> {
        self.set_setting("project", "notes", text)
    }

    pub fn setting(&self, scope: &str, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE scope = ?1 AND key = ?2", [scope, key], |r| r.get(0)).optional()?)
    }

    /// Settings are not script commits, so they do not move `version`. A
    /// counter marks them as unsaved instead: after a crash, a working store
    /// with newer settings (notes, title page, headers) is recovered like one
    /// with newer script edits.
    pub fn set_setting(&self, scope: &str, key: &str, value: &str) -> Result<()> {
        self.conn.execute("INSERT OR REPLACE INTO settings(scope, key, value) VALUES (?1, ?2, ?3)", params![scope, key, value])?;
        self.mark_unsaved()
    }

    /// Count a change that is not a script commit (a setting, a planning
    /// edit), so `has_unsaved_work` sees it. The meta key keeps its first name.
    fn mark_unsaved(&self) -> Result<()> {
        let n = self.meta_count("settings_changes")? + 1;
        Self::set_meta(&self.conn, "settings_changes", &n.to_string())
    }

    fn meta_count(&self, key: &str) -> Result<u64> {
        Ok(self.meta(key)?.and_then(|v| v.parse().ok()).unwrap_or(0))
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

    /// True when the working store holds commits or settings newer than the
    /// last package save, for example after a crash.
    pub fn has_unsaved_work(&self) -> Result<bool> {
        Ok(self.version()? > self.saved_version()? || self.meta_count("settings_changes")? > self.meta_count("settings_saved")?)
    }

    /// Project title (also the default document's title while projects hold
    /// one document in the UI).
    pub fn set_title(&self, title: &str) -> Result<()> {
        Self::set_meta(&self.conn, "title", title)?;
        self.conn.execute("UPDATE documents SET title = ?1 WHERE id = (SELECT value FROM meta WHERE key = 'default_document')", [title])?;
        Ok(())
    }

    /// The current document (the one the editor shows).
    pub fn load(&self) -> Result<Document> {
        self.load_document(&self.current_document()?)
    }

    pub fn load_document(&self, document_id: &str) -> Result<Document> {
        let mut stmt = self.conn.prepare("SELECT id, kind, runs, scene_id, dual, break_before FROM blocks WHERE document_id = ?1 ORDER BY ord")?;
        let blocks = stmt
            .query_map([document_id], |r| {
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
        // The document's own title (an episode's); the default document's is the project's.
        let title: Option<String> = self.conn.query_row("SELECT title FROM documents WHERE id = ?1", [document_id], |r| r.get(0)).optional()?;
        let title = match title {
            Some(t) if !t.is_empty() => t,
            _ => self.meta("title")?.unwrap_or_default(),
        };
        Ok(Document { title, version: self.version()?, blocks })
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
        self.apply(&Batch { tx_id: crate::model::new_id(), base_version: base, document_id: None, ops })
    }

    pub fn apply(&mut self, batch: &Batch) -> Result<Ack> {
        // A batch without a document edits the current one.
        let current_doc = match &batch.document_id {
            Some(_) => None,
            None => Some(self.current_document()?),
        };
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(v) = tx.query_row("SELECT version FROM oplog WHERE tx_id = ?1", [&batch.tx_id], |r| r.get::<_, i64>(0)).optional()? {
            return Ok(Ack { version: v as u64, duplicate: true });
        }
        let current: u64 = tx.query_row("SELECT value FROM meta WHERE key='version'", [], |r| r.get::<_, String>(0))?.parse().unwrap_or(0);
        if batch.base_version != current {
            return Err(StoreError::Stale { base: batch.base_version, current });
        }
        let doc = match &batch.document_id {
            Some(d) => d.clone(),
            None => current_doc.unwrap_or_default(),
        };
        if tx.query_row("SELECT 1 FROM documents WHERE id = ?1", [&doc], |_| Ok(())).optional()?.is_none() {
            return Err(StoreError::Invalid(format!("unknown document {doc}")));
        }
        let next = current + 1;
        for op in &batch.ops {
            apply_op(&tx, &doc, op, next)?;
        }
        Self::set_meta(&tx, "version", &next.to_string())?;
        tx.execute(
            "INSERT INTO oplog(version, tx_id, batch) VALUES (?1, ?2, ?3)",
            params![next as i64, batch.tx_id, serde_json::to_string(batch).unwrap_or_default()],
        )?;
        tx.commit()?;
        Ok(Ack { version: next, duplicate: false })
    }

    /// The current document's cards.
    pub fn beats(&self) -> Result<Vec<Beat>> {
        let doc = self.current_document()?;
        let mut stmt = self.conn.prepare("SELECT id, logline, summary, scene_id, pos FROM beats WHERE document_id = ?1 ORDER BY pos")?;
        let beats = stmt
            .query_map([&doc], |r| Ok(Beat { id: r.get(0)?, logline: r.get(1)?, summary: r.get(2)?, scene_id: r.get(3)?, pos: r.get(4)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(beats)
    }

    /// Planning edits. They never touch script text or script order. Like a
    /// settings change, they count as unsaved work until the next save.
    pub fn put_beat(&self, beat: &Beat) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO beats(id, logline, summary, scene_id, pos, document_id) VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT document_id FROM beats WHERE id = ?1), ?6))",
            params![beat.id, beat.logline, beat.summary, beat.scene_id, beat.pos, self.current_document()?],
        )?;
        self.mark_unsaved()
    }

    pub fn beat(&self, id: &str) -> Result<Option<Beat>> {
        Ok(self
            .conn
            .query_row("SELECT id, logline, summary, scene_id, pos FROM beats WHERE id = ?1", [id], |r| Ok(Beat { id: r.get(0)?, logline: r.get(1)?, summary: r.get(2)?, scene_id: r.get(3)?, pos: r.get(4)? }))
            .optional()?)
    }

    /// The planning data's version: one more for every planning command.
    pub fn planning_version(&self) -> Result<u64> {
        self.meta_count("planning_version")
    }

    /// Apply a planning command (cirth_core::planning), checked against
    /// `base` when given. Returns the new planning version and the command
    /// that undoes this one.
    pub fn apply_planning(&self, op: &crate::planning::PlanningOp, base: Option<u64>) -> Result<(u64, crate::planning::PlanningOp)> {
        use crate::planning::PlanningOp;
        let current = self.planning_version()?;
        if let Some(base) = base {
            if base != current {
                return Err(StoreError::Stale { base, current });
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        let backward = match op {
            PlanningOp::PutBeat(b) => {
                if b.id.trim().is_empty() || !b.pos.is_finite() {
                    return Err(StoreError::Invalid("a card needs an id and a position".into()));
                }
                let before = self.beat(&b.id)?;
                self.put_beat(b)?;
                match before {
                    Some(old) => PlanningOp::PutBeat(old),
                    None => PlanningOp::DeleteBeat(b.id.clone()),
                }
            }
            PlanningOp::SetSceneLabel { scene_id, label } => {
                let before = self.scene_label(scene_id)?;
                self.set_scene_label(scene_id, label)?;
                PlanningOp::SetSceneLabel { scene_id: scene_id.clone(), label: before }
            }
            PlanningOp::DeleteBeat(id) => {
                let Some(old) = self.beat(id)? else {
                    return Err(StoreError::Invalid(format!("no card {id}")));
                };
                self.conn.execute("DELETE FROM beats WHERE id = ?1", [id])?;
                self.mark_unsaved()?;
                PlanningOp::PutBeat(old)
            }
        };
        let version = current + 1;
        Self::set_meta(&self.conn, "planning_version", &version.to_string())?;
        tx.commit()?;
        Ok((version, backward))
    }

    /// Write a consistent snapshot to `dest` via temp file and rename.
    pub fn save_package(&self, dest: &Path) -> Result<u64> {
        self.save_package_with_backup(dest, None, std::time::SystemTime::now(), false)
    }

    /// Like `save_package`, but first copies the current package into the
    /// backup folder when the policy calls for it (`force` = explicit Save).
    /// `backup` is the policy and the name backups of this file go under.
    pub fn save_package_with_backup(&self, dest: &Path, backup: Option<(&crate::backup::BackupPolicy, &str)>, now: std::time::SystemTime, force: bool) -> Result<u64> {
        if let Some((policy, name)) = backup {
            let current = if dest.exists() { Store::inspect(dest).map(|i| i.saved_version).unwrap_or(0) } else { 0 };
            crate::backup::before_replace(dest, name, current, policy, now, force)?;
        }
        let version = self.version()?;
        let settings = self.meta_count("settings_changes")?;
        let tmp = dest.with_extension("cirth.tmp");
        if tmp.exists() {
            std::fs::remove_file(&tmp)?;
        }
        self.conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
        crash_point("snapshot-written");
        {
            let pkg = Connection::open(&tmp)?;
            pkg.execute("UPDATE meta SET value = ?1 WHERE key = 'saved_version'", [version.to_string()])?;
            pkg.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('settings_saved', ?1), ('settings_changes', ?1)", [settings.to_string()])?;
            pkg.execute("DELETE FROM meta WHERE key = 'opened_at'", [])?;
            let ok: String = pkg.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if ok != "ok" {
                return Err(StoreError::Invalid(format!("package snapshot failed integrity check: {ok}")));
            }
        }
        crate::fsutil::sync_file(&tmp)?;
        crash_point("snapshot-synced");
        crate::fsutil::replace_file(&tmp, dest)?;
        crash_point("package-replaced");
        Self::set_meta(&self.conn, "saved_version", &version.to_string())?;
        Self::set_meta(&self.conn, "settings_saved", &settings.to_string())?;
        Ok(version)
    }

    /// Start a working store from a package. If a working store for the same
    /// project already holds unsaved commits, it is kept (recovery) and the
    /// package is not copied over it. An older-format package is copied,
    /// untouched, into `backup_dir` before anything is upgraded; the package
    /// file itself stays old until the next save.
    pub fn open_package(pkg: &Path, work: &Path, backup_dir: Option<&Path>) -> Result<OpenedPackage> {
        let pkg_schema = schema_of(pkg)?;
        if pkg_schema > SCHEMA_VERSION {
            return Err(StoreError::FutureSchema(pkg_schema));
        }
        let pre_migration_backup = match backup_dir {
            Some(dir) if pkg_schema < SCHEMA_VERSION => Some(keep_pre_migration_copy(pkg, pkg_schema, dir)?),
            _ => None,
        };
        if work.exists() {
            let candidate = Store::open(work)?;
            let same_project = {
                let p = Connection::open_with_flags(pkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let pid: Option<String> = p.query_row("SELECT value FROM meta WHERE key='project_id'", [], |r| r.get(0)).optional()?;
                pid == candidate.meta("project_id")?
            };
            if same_project && candidate.has_unsaved_work()? {
                let migrated_from = candidate.migrated_from.or((pkg_schema < SCHEMA_VERSION).then_some(pkg_schema));
                return Ok(OpenedPackage { store: candidate, recovered: true, migrated_from, pre_migration_backup });
            }
            drop(candidate);
            remove_store_files(work)?;
        }
        std::fs::copy(pkg, work)?;
        let store = Store::open(work)?;
        let migrated_from = store.migrated_from;
        Ok(OpenedPackage { store, recovered: false, migrated_from, pre_migration_backup })
    }

    /// Summary of a project file without opening it for writing. Fails with
    /// `Locked` if another connection holds the exclusive lock.
    pub fn inspect(path: &Path) -> Result<PackageInfo> {
        let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        c.busy_timeout(std::time::Duration::from_millis(0))?;
        c.pragma_update(None, "query_only", true)?;
        let schema: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if schema > SCHEMA_VERSION {
            return Err(StoreError::FutureSchema(schema));
        }
        let meta = |k: &str| -> Result<String> { Ok(c.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get(0)).optional()?.unwrap_or_default()) };
        Ok(PackageInfo {
            schema,
            project_id: meta("project_id")?,
            title: meta("title")?,
            version: meta("version")?.parse().unwrap_or(0),
            saved_version: meta("saved_version")?.parse().unwrap_or(0),
            blocks: c.query_row("SELECT COUNT(*) FROM blocks", [], |r| r.get::<_, i64>(0))? as u64,
            scenes: c.query_row("SELECT COUNT(*) FROM blocks WHERE scene_id IS NOT NULL", [], |r| r.get::<_, i64>(0))? as u64,
        })
    }

    /// Move this working store to `to` (Save As, conflict copy): close the
    /// connection (checkpointing the WAL), move the files, reopen with the lock.
    pub fn relocate(&mut self, to: &Path) -> Result<()> {
        let old = std::mem::replace(&mut self.conn, Connection::open_in_memory()?);
        old.close().map_err(|(_, e)| StoreError::from(e))?;
        move_store_files(&self.path, to)?;
        *self = Store::open(to)?;
        Ok(())
    }

    pub fn project_id(&self) -> Result<Id> {
        Ok(self.meta("project_id")?.unwrap_or_default())
    }

    /// Change the project's identity. Save As gives the copy a new one, so
    /// two copies never share recovery files; it restores the old id if the
    /// save fails.
    pub fn set_project_id(&self, id: &str) -> Result<()> {
        Self::set_meta(&self.conn, "project_id", id)
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

/// Copy an older-format package into `dir` before upgrading, as
/// `<stem>--pre-schema-v<new>--<UTC time>Z--from-v<old>.cirth`. These copies
/// are outside backup rotation (never pruned). An identical copy already
/// there is reused instead of duplicated.
fn keep_pre_migration_copy(pkg: &Path, from: i64, dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let stem = pkg.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let prefix = format!("{stem}--pre-schema-v{SCHEMA_VERSION}--");
    let bytes = std::fs::read(pkg)?;
    for e in std::fs::read_dir(dir)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) && name.ends_with(".cirth") && std::fs::read(e.path())? == bytes {
            return Ok(e.path());
        }
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let target = dir.join(format!("{prefix}{}Z--from-v{from}.cirth", crate::backup::utc_stamp(now)));
    let tmp = target.with_extension("cirth.tmp");
    std::fs::write(&tmp, &bytes)?;
    crate::fsutil::sync_file(&tmp)?;
    crate::fsutil::replace_file(&tmp, &target)?;
    Ok(target)
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct PackageInfo {
    /// Schema version of the file (older ones are upgraded when opened).
    pub schema: i64,
    pub project_id: String,
    pub title: String,
    pub version: u64,
    pub saved_version: u64,
    pub blocks: u64,
    pub scenes: u64,
}

/// Move a closed working store (and any WAL/SHM files) to a new path.
pub fn move_store_files(from: &Path, to: &Path) -> Result<()> {
    remove_store_files(to)?;
    for suffix in ["", "-wal", "-shm"] {
        let src = PathBuf::from(format!("{}{suffix}", from.display()));
        if src.exists() {
            crate::fsutil::replace_file(&src, &PathBuf::from(format!("{}{suffix}", to.display())))?;
        }
    }
    Ok(())
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

/// Document a block belongs to, if it exists.
fn block_document(tx: &Connection, id: &str) -> Result<Option<String>> {
    Ok(tx.query_row("SELECT document_id FROM blocks WHERE id = ?1", [id], |r| r.get(0)).optional()?)
}

fn ord_of(tx: &Connection, doc: &str, id: &str) -> Result<Option<f64>> {
    Ok(tx.query_row("SELECT ord FROM blocks WHERE id = ?1 AND document_id = ?2", [id, doc], |r| r.get(0)).optional()?)
}

fn ord_after(tx: &Connection, doc: &str, after: Option<&str>, moving: &str) -> Result<f64> {
    let lo = match after {
        Some(a) => ord_of(tx, doc, a)?.ok_or_else(|| StoreError::Invalid(format!("unknown anchor block {a} in this document")))?,
        None => f64::NEG_INFINITY,
    };
    let hi: Option<f64> = if lo.is_finite() {
        tx.query_row("SELECT MIN(ord) FROM blocks WHERE document_id = ?1 AND ord > ?2 AND id <> ?3", params![doc, lo, moving], |r| r.get(0))?
    } else {
        tx.query_row("SELECT MIN(ord) FROM blocks WHERE document_id = ?1 AND id <> ?2", params![doc, moving], |r| r.get(0))?
    };
    let pos = match (lo.is_finite(), hi) {
        (false, None) => 0.0,
        (false, Some(h)) => h - 1.0,
        (true, None) => lo + 1.0,
        (true, Some(h)) => (lo + h) / 2.0,
    };
    if lo.is_finite() && hi.is_some_and(|h| h - lo < 1e-9) {
        renumber(tx, doc)?;
        return ord_after(tx, doc, after, moving);
    }
    Ok(pos)
}

fn renumber(tx: &Connection, doc: &str) -> Result<()> {
    let ids: Vec<String> = tx
        .prepare("SELECT id FROM blocks WHERE document_id = ?1 ORDER BY ord")?
        .query_map([doc], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE blocks SET ord = ?1 WHERE id = ?2", params![i as f64, id])?;
    }
    Ok(())
}

fn write_block(tx: &Connection, doc: &str, b: &Block, ord: f64, version: u64) -> Result<()> {
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
        "INSERT INTO blocks(id, ord, kind, runs, scene_id, dual, break_before, document_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, kind = excluded.kind, runs = excluded.runs,
           scene_id = excluded.scene_id, dual = excluded.dual, break_before = excluded.break_before",
        params![b.id, ord, b.kind.as_str(), serde_json::to_string(&b.runs).unwrap_or_default(), b.scene_id, b.dual as i64, b.break_before as i64, doc],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            StoreError::Invalid(format!("block {} reuses a scene id already in the project", b.id))
        }
        _ => StoreError::from(e),
    })?;
    Ok(())
}

/// The block must not exist, or must exist in `doc`.
fn require_in_doc(tx: &Connection, doc: &str, id: &str, must_exist: bool) -> Result<()> {
    match block_document(tx, id)? {
        Some(d) if d != doc => Err(StoreError::Invalid(format!("block {id} belongs to another document; moving blocks between documents is not supported yet"))),
        None if must_exist => Err(StoreError::Invalid(format!("unknown block {id} in this document"))),
        _ => Ok(()),
    }
}

fn apply_op(tx: &Connection, doc: &str, op: &Op, version: u64) -> Result<()> {
    match op {
        Op::Put { block, after } => {
            if after.as_deref() == Some(block.id.as_str()) {
                return Err(StoreError::Invalid("block placed after itself".into()));
            }
            require_in_doc(tx, doc, &block.id, false)?;
            let ord = ord_after(tx, doc, after.as_deref(), &block.id)?;
            write_block(tx, doc, block, ord, version)
        }
        Op::Update { block } => {
            require_in_doc(tx, doc, &block.id, true)?;
            let ord = ord_of(tx, doc, &block.id)?.ok_or_else(|| StoreError::Invalid(format!("update of unknown block {}", block.id)))?;
            write_block(tx, doc, block, ord, version)
        }
        Op::Delete { id } => {
            require_in_doc(tx, doc, id, true)?;
            let scene: Option<String> = tx.query_row("SELECT scene_id FROM blocks WHERE id = ?1", [id], |r| r.get(0))?;
            if let Some(sid) = scene {
                tx.execute("UPDATE scenes SET active = 0 WHERE id = ?1", [sid])?;
            }
            tx.execute("DELETE FROM blocks WHERE id = ?1", [id])?;
            Ok(())
        }
    }
}