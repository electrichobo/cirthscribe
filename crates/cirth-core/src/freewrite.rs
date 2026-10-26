//! Free Writing: a workspace of plain-text pieces in folders, independent of
//! projects (PRODUCT_SPEC 1). Its own SQLite file in the app data folder,
//! WAL with synchronous=FULL like project stores, held with an exclusive
//! lock. Pieces are never deleted here: "delete" moves them to the trash.
//! Copying a piece into a project leaves the piece in place and records
//! where it went (provenance); moving is an explicit copy followed by trash.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub struct FreeError(pub String);

impl std::fmt::Display for FreeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<rusqlite::Error> for FreeError {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(f, _) = &e {
            if matches!(f.code, rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) {
                return FreeError("Free Writing is open in another CirthScribe window".into());
            }
        }
        FreeError(format!("database error: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, FreeError>;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PieceSummary {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    /// First characters of the body, for lists.
    pub preview: String,
    pub created: String,
    pub modified: String,
    pub trashed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Piece {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub body: String,
    pub created: String,
    pub modified: String,
    pub trashed: bool,
    /// Human-readable record of copies and moves into projects.
    pub provenance: Vec<String>,
}

pub struct FreeStore {
    conn: Connection,
}

const SCHEMA: &str = "
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE pieces (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  trashed INTEGER NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL DEFAULT '[]'
);
";

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

fn preview(body: &str) -> String {
    let one_line: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut p: String = one_line.chars().take(140).collect();
    if one_line.chars().count() > 140 {
        p.push('…');
    }
    p
}

fn summary(p: &Piece) -> PieceSummary {
    PieceSummary { id: p.id.clone(), folder_id: p.folder_id.clone(), title: p.title.clone(), preview: preview(&p.body), created: p.created.clone(), modified: p.modified.clone(), trashed: p.trashed }
}

impl FreeStore {
    pub fn open(path: &Path) -> Result<FreeStore> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_millis(0))?;
        conn.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
        let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if v > SCHEMA_VERSION {
            return Err(FreeError(format!("Free Writing data is from a newer CirthScribe (format {v})")));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        if v == 0 {
            conn.execute_batch(&format!("BEGIN; {SCHEMA} PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;"))?;
        }
        // Take and keep the exclusive lock now.
        conn.execute_batch("BEGIN IMMEDIATE; COMMIT;")?;
        Ok(FreeStore { conn })
    }

    pub fn folders(&self) -> Result<Vec<Folder>> {
        let mut st = self.conn.prepare("SELECT id, name FROM folders ORDER BY name COLLATE NOCASE")?;
        let out = st.query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)? }))?.collect::<std::result::Result<_, _>>()?;
        Ok(out)
    }

    pub fn create_folder(&self, name: &str) -> Result<Folder> {
        let name = if name.trim().is_empty() { "New folder" } else { name.trim() };
        let f = Folder { id: crate::model::new_id(), name: name.to_string() };
        self.conn.execute("INSERT INTO folders(id, name) VALUES (?1, ?2)", params![f.id, f.name])?;
        Ok(f)
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        if name.trim().is_empty() {
            return Err(FreeError("a folder needs a name".into()));
        }
        self.conn.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name.trim()])?;
        Ok(())
    }

    fn row(r: &rusqlite::Row) -> rusqlite::Result<Piece> {
        let prov: String = r.get(7)?;
        Ok(Piece {
            id: r.get(0)?,
            folder_id: r.get(1)?,
            title: r.get(2)?,
            body: r.get(3)?,
            created: r.get(4)?,
            modified: r.get(5)?,
            trashed: r.get::<_, i64>(6)? != 0,
            provenance: serde_json::from_str(&prov).unwrap_or_default(),
        })
    }

    const COLS: &'static str = "id, folder_id, title, body, created, modified, trashed, provenance";

    pub fn get(&self, id: &str) -> Result<Piece> {
        self.conn
            .query_row(&format!("SELECT {} FROM pieces WHERE id = ?1", Self::COLS), [id], Self::row)
            .optional()?
            .ok_or_else(|| FreeError(format!("no such piece {id}")))
    }

    fn all(&self) -> Result<Vec<Piece>> {
        let mut st = self.conn.prepare(&format!("SELECT {} FROM pieces ORDER BY modified DESC", Self::COLS))?;
        let out = st.query_map([], Self::row)?.collect::<std::result::Result<_, _>>()?;
        Ok(out)
    }

    /// Pieces, newest first. `folder`: `Some(id)` for one folder, `None` for all;
    /// `trash`: list the trash instead of live pieces.
    pub fn list(&self, folder: Option<&str>, trash: bool) -> Result<Vec<PieceSummary>> {
        Ok(self.all()?.iter().filter(|p| p.trashed == trash && (folder.is_none() || p.folder_id.as_deref() == folder)).map(summary).collect())
    }

    /// Case-insensitive search of titles and text (Unicode-aware), live pieces only.
    pub fn search(&self, query: &str) -> Result<Vec<PieceSummary>> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return self.list(None, false);
        }
        Ok(self.all()?.iter().filter(|p| !p.trashed && (p.title.to_lowercase().contains(&q) || p.body.to_lowercase().contains(&q))).map(summary).collect())
    }

    pub fn create(&self, folder_id: Option<&str>, title: &str) -> Result<Piece> {
        let id = crate::model::new_id();
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        self.conn.execute("INSERT INTO pieces(id, folder_id, title) VALUES (?1, ?2, ?3)", params![id, folder_id, title])?;
        self.get(&id)
    }

    /// Store new text. Returns the piece's modified time (unchanged if nothing changed).
    pub fn save(&self, id: &str, title: &str, body: &str) -> Result<String> {
        let title = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        self.conn.execute(
            &format!("UPDATE pieces SET title = ?2, body = ?3, modified = {NOW} WHERE id = ?1 AND (title <> ?2 OR body <> ?3)"),
            params![id, title, body],
        )?;
        Ok(self.get(id)?.modified)
    }

    pub fn move_to(&self, id: &str, folder_id: Option<&str>) -> Result<()> {
        self.conn.execute("UPDATE pieces SET folder_id = ?2 WHERE id = ?1", params![id, folder_id])?;
        Ok(())
    }

    pub fn set_trashed(&self, id: &str, trashed: bool) -> Result<()> {
        self.conn.execute("UPDATE pieces SET trashed = ?2 WHERE id = ?1", params![id, trashed as i64])?;
        Ok(())
    }

    pub fn add_provenance(&self, id: &str, entry: &str) -> Result<()> {
        let mut p = self.get(id)?.provenance;
        p.push(entry.to_string());
        self.conn.execute("UPDATE pieces SET provenance = ?2 WHERE id = ?1", params![id, serde_json::to_string(&p).unwrap_or_default()])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cirth-free-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.join("freewriting.db")
    }

    #[test]
    fn pieces_folders_search_trash_and_reopen() {
        let path = tmp("basic");
        {
            let s = FreeStore::open(&path).unwrap();
            let f = s.create_folder("Ideas").unwrap();
            let a = s.create(Some(&f.id), "Harbor").unwrap();
            let b = s.create(None, "").unwrap();
            assert_eq!(b.title, "Untitled");
            s.save(&a.id, "Harbor", "The CAFÉ by the harbor; Zoë waits.").unwrap();
            s.save(&b.id, "Loose", "Nothing to see.").unwrap();
            assert_eq!(s.list(Some(&f.id), false).unwrap().len(), 1);
            assert_eq!(s.list(None, false).unwrap().len(), 2);
            // Unicode-aware, case-insensitive search in title and text.
            assert_eq!(s.search("café").unwrap().len(), 1);
            assert_eq!(s.search("ZOË").unwrap()[0].id, a.id);
            assert_eq!(s.search("harbor").unwrap().len(), 1);
            // Trash, not delete; search skips the trash.
            s.set_trashed(&b.id, true).unwrap();
            assert_eq!(s.list(None, false).unwrap().len(), 1);
            assert_eq!(s.list(None, true).unwrap().len(), 1);
            assert!(s.search("nothing").unwrap().is_empty());
            s.move_to(&a.id, None).unwrap();
            s.add_provenance(&a.id, "Copied into The Tide Ledger").unwrap();
        }
        // Everything survives reopening.
        let s = FreeStore::open(&path).unwrap();
        let all = s.list(None, false).unwrap();
        assert_eq!(all.len(), 1);
        let a = s.get(&all[0].id).unwrap();
        assert_eq!(a.body, "The CAFÉ by the harbor; Zoë waits.");
        assert_eq!(a.folder_id, None);
        assert_eq!(a.provenance, vec!["Copied into The Tide Ledger"]);
        assert_eq!(s.folders().unwrap()[0].name, "Ideas");
        assert_eq!(s.list(None, true).unwrap().len(), 1, "trashed piece kept");
    }

    #[test]
    fn unchanged_save_keeps_modified_time_and_second_opener_is_refused() {
        let path = tmp("lock");
        let s = FreeStore::open(&path).unwrap();
        let p = s.create(None, "A").unwrap();
        let m1 = s.save(&p.id, "A", "text").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(s.save(&p.id, "A", "text").unwrap(), m1, "no change, no new time");
        assert!(FreeStore::open(&path).is_err(), "one writer at a time");
    }
}
