# Proposed native schema and container (M0)

Status: proposed. Schema v1 below is what the spike implements; the M1 additions are proposals.

## Container

- A project file `.cirth` is a **SQLite database** (one file, open schema, readable with standard tools).
- While a project is open, CirthScribe works in a **working copy** in the app's local data folder (WAL mode, `synchronous=FULL`, exclusive lock). Every acknowledged batch is durable in the working copy.
- **Save** writes the package: `VACUUM INTO` a temp file beside the target, integrity check, flush, rename over the target. An interrupted save leaves the previous package intact.
- **Reopen**: if the working copy for the same `project_id` has commits newer than its last package save, it is recovered and the user is told; otherwise the package is copied to a fresh working copy.
- The working copy never lives in a cloud-synced folder; the package may. The package holds no absolute paths or credentials.
- Package files are written in rollback-journal mode, so a copied `.cirth` is a single self-contained file.

Implemented in M1 (2026-10-26):
- The package is written on Save, on Home, on window close (the close handler flushes pending edits first; if saving fails the window stays open once and says so), and by autosave every 60 s when the store has moved past the last file save. A Rust exit hook saves again as a safety net. The working copy remains the crash-recovery journal.
- Package replacement is crash-safe: Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`; Unix `rename` plus a directory fsync (`cirth-core/src/fsutil.rs`).
- Rolling backups (`cirth-core/src/backup.rs`) in the app's `backups` folder: before a package is replaced, the current file is copied as `<name>--<UTC time>Z--v<version>.cirth`; at most one per 10 minutes from autosave, always on an explicit Save of a changed file, never two of the same version; the newest 20 are kept. Each backup is a complete project file. A restore command in the UI is not built yet.

## Schema v1 (implemented)

`PRAGMA user_version = 1`. A higher version is refused; a lower one will be migrated after a backup copy (M1).

| Table | Columns | Notes |
| - | - | - |
| `meta` | `key`, `value` | `version` (document version, +1 per batch), `saved_version`, `title`, `project_id`, `opened_at` |
| `blocks` | `id` (UUID), `ord` (REAL), `kind`, `runs` (JSON), `scene_id` (UNIQUE, heading only), `dual`, `break_before` | Order by `ord`; inserts take the midpoint; renumber when gaps get too small |
| `scenes` | `id`, `created_version`, `active` | Registry of every scene id ever used; inactive when its heading is gone, never deleted |
| `beats` | `id`, `summary`, `scene_id`, `pos` | Authored planning text; `pos` is planning order, independent of script order |
| `oplog` | `version`, `tx_id` (UNIQUE), `applied_at`, `batch` (JSON) | Every committed batch; idempotency and future history/branching input |

Inline content is stored as runs (`text`, `bold`, `italic`, `underline`), so persisted data contains no character offsets. Where offsets are needed (page map, future anchors), Rust uses Unicode scalar values and the TypeScript boundary converts to UTF-16.

## Schema v2 (implemented in M1, 2026-10-26)

Added by migration `migrate_v2` (`cirth-core/src/store.rs`):

| Table / column | Notes |
| - | - |
| `documents` | `id`, `kind` (`screenplay`), `title`, `profile` (`us-letter`), `container_id`, `pos`. A project holds one or more documents; the UI shows the default one until multi-document work (M3). |
| `containers` | `id`, `parent_id`, `title`, `pos`: series/season/episode grouping. Acyclicity is enforced by the commands that will edit it (none yet). |
| `settings` | `scope` (`project` or a document id), `key`, `value`. |
| `blocks.document_id`, `beats.document_id` | Every block and beat belongs to a document. Ordering (`ord`) is per document. |
| `meta.default_document` | The document the editor opens. |

Rules:
- Batches carry an optional `document_id` (none = default document). Anchors and targets must be in that document; moving blocks between documents is refused for now.
- A new database is created at v1 and run through the same migrations as old files; a test checks that new and upgraded databases have identical tables and columns.
- All pending migrations and the `user_version` update run in one transaction (a crash leaves the old schema; not crash-tested yet).
- Opening an older package first copies it, untouched, to `backups/<name>--pre-schema-v2--<UTC time>Z--from-v1.cirth` (outside rotation, never pruned; an identical copy is reused). The upgrade happens in the working copy; the `.cirth` file stays old until the next save. Home marks such files "Older format".
- Tests use real v1 files frozen before the change (`crates/cirth-core/tests/data/schema-v1-*.cirth`).

Still proposed: `free_writing` in a separate workspace database, not in projects.

Comment anchors, revisions, page baselines, branches and alternatives get their tables with the milestones that need them; their id and anchor rules (block id + scalar offset + affinity, original quote kept) are fixed now so M1 data stays compatible.
