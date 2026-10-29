# Milestone 5 plan: review, alternatives, and branches

Status: **accepted by the owner, 2026-10-29**, with decisions A(1), B(1), C(2) below. Builds on M1–M4 (M4 closed 2026-10-29, `docs/m4/EXIT_REVIEW.md`).
ROADMAP M5 exit: conflicting changes never disappear silently; branches and alternatives survive native save/export/reopen without affecting unrelated work. Acceptance section F (Comments, alternatives, and history) is the primary gate, with C5 (branch canon) and E5 (inactive alternatives in reports/stripboard) from earlier milestones.

## Starting point (what exists)

- **Range anchors and mapping engine (ADR 0005, M4 step 3):** `cirth_core::tags` tracks spans `(document_id, block_id, start, end, quote, orphaned)` in Unicode scalar values, with left-open/right-open boundary affinity, split/join/move mapping in `Store::apply`, and orphan retention + automatic recovery on undo.
- **Planning commands and undo (ADR 0003, M3 step 1):** versioned `PlanningOp` command stream with exact inverses and atomic SQLite storage.
- **Transactional document store (`crates/cirth-core/src/store.rs`):** append-only SQLite schema migrations (currently v11), atomic save with temp-write and rename, rolling backups, crash recovery journal.
- **Series and episodes (M3 step 2):** folder tree and multi-document hierarchy with shared bible.
- **StoryScry and Stripboard (M4 steps 1–5):** reports and scheduling with version tracking (`source_version`) and staleness indicators (B6).
- **Not yet:** comments or review threads, alternative dialogue/takes, named snapshots, branches, or 3-way merge review.

## Proposed steps

Each step is a working vertical slice tested across core tests, contract tests, and both end-to-end drivers (CDP and WebDriver).

1. **Anchored local comment threads (core and UI).**
   - Core model (`crates/cirth-core/src/comments.rs`, schema v12):
     - `comment_threads(id, document_id, block_id, start_char, end_char, quote, author, created_at, resolved, orphaned)`
     - `comment_messages(id, thread_id, author, text, created_at, edited_at)`
   - Anchor mapping: reuse the proven ADR 0005 mapping in `Store::apply` for comment threads across typing before/inside/after, block split, join, move, scene omission, deletion (orphans with quote), and undo recovery (Acceptance F1, F2).
   - Planning commands (`PlanningOp`): `AddCommentThread`, `ReplyCommentThread`, `ResolveCommentThread`, `ReattachCommentThread`, `DeleteCommentThread`.
   - UI (`app/src/comments.ts`): inline ProseMirror highlight markers (`.cirth-comment-mark`), comment bubble on selection, floating thread editor, and side panel / pop-out review panel (ADR 0004). Toggle between inline markers and side panel (Acceptance F3).
   - **Built 2026-10-29:** schema v12 migration with frozen v11 fixtures; `cirth_core::comments` model with ADR 0005 anchor mapping across edits, moves, splits, joins, and deletions with orphan recovery; `PlanningOp` variants with exact inverses; 7 Tauri IPC commands and native menu item View > Tools > Comments…; ProseMirror inline highlight decorations (`.cirth-comment-mark`, `.cirth-comment-resolved`); accessible review modal dialog with filter tabs (All, Open, Resolved, Orphaned), search filter, reply box, resolve/reopen toggle, jump to text, and orphan reattach action; automated tests in core (`migrate.rs`, `store.rs`), contract, and e2e (`suite.mjs`) passing on both CDP and WebDriver drivers.
2. **Non-destructive alternatives (takes and alternate lines).**
   - Core model (`crates/cirth-core/src/alternatives.rs`):
     - Blocks can carry one or more alternate takes (`alternatives(id, document_id, block_id, alt_index, text, label, author, created_at)`), with an active take selector (`active_alt_index: 0` = original, `1..N` = alternate).
     - The document model projects the active alternative. Word counts, StoryScry reports, character sides, bible mentions, and exports immediately reflect the active take (Acceptance F4).
     - StoryScry and Stripboard exclude inactive alternatives by default; explicitly toggling them on displays an unambiguous label (Acceptance E5).
   - UI: alternative take switcher on the editor block (e.g. `Take 1/3 ▾`), inline "Add alternate take" action, and quick take cycling with preview.
3. **Named snapshots and checkpoints.**
   - Core model (`crates/cirth-core/src/snapshots.rs`):
     - Snapshot entity capturing a named, immutable point-in-time package state (`snapshots(id, label, description, created_at, author, head_version, package_blob)`).
     - Create snapshot from current project state; list snapshots with timestamp, version, and scene/word count summary.
     - Restore snapshot into a new working head (non-destructive; preserves previous history).
   - UI: `File > Snapshots…` dialog to create, inspect, preview, and restore snapshots.
4. **Visual branch history and independent branch canon.**
   - Core branching (`crates/cirth-core/src/branches.rs`):
     - Fork a new branch from current state or any snapshot (`branches(id, name, parent_branch_id, fork_version, description, created_at)`).
     - Switching active branch swaps the active working document tree, planning state, comments, alternatives, and schedule (Acceptance C5).
     - Each branch maintains its own canon: editing world facts or scenes in one branch leaves the other branch untouched.
   - UI: branch indicator in title bar / toolbar, `File > Branches…` dialog with visual branch tree showing forks and heads.
5. **Base/source/target 3-way conflict integration.**
   - Core 3-way diff (`crates/cirth-core/src/merge.rs`):
     - Given a common ancestor snapshot (base), source branch, and target branch, compute 3-way diff at scene and block granularity.
     - Detect conflicting edits on the same speeches or scenes without automatic concatenation or silent loss (Acceptance F5).
     - Locked-page baseline guard: detect when branches have different locked-page baselines and require an explicit baseline decision before merging structural changes (Acceptance F6).
   - UI: visual 3-way merge review dialog showing Base, Current Branch, and Incoming Branch side-by-side with per-conflict resolution buttons ("Keep current", "Take incoming", "Custom text").
6. **Portable review package (`.cirth-review`).**
   - Export a self-contained `.cirth-review` bundle containing script text, anchored comment threads, and alternatives for an outside reader without personal machine paths or credentials (Acceptance F7, G5).
   - Import review package: inspect outside comments/takes and merge them cleanly into the author's local project with provenance.
7. **Compatibility and regression verification, Exit Review.**
   - Verify native schema round-trips preserve comments, alternatives, and branches (`Acceptance F7`).
   - Run full automated test suites (core, contract, e2e CDP, e2e WebDriver).
   - Update `docs/COMPATIBILITY.md`, `docs/testing/MANUAL_CHECKS.md`, and author `docs/m5/EXIT_REVIEW.md`.

## Decisions (owner, 2026-10-29)

- **A. Alternatives scope: Option 1 (Block-level alternatives).** Alternative takes attach to individual blocks (dialogue lines, parentheticals, action sentences, headings). Keeps document and scene structures stable, preserves locked scene numbers and eighths calculations cleanly, and directly serves common screenwriting workflows ("alt line", "alt dialogue").
- **B. Branch storage in `.cirth` SQLite: Option 1 (Branch-isolated snapshots in SQLite).** The active branch uses standard document and planning tables; inactive branches and checkpoints are stored as verified, compressed SQLite state packages in a dedicated snapshot table. Active writing has zero table-scan or index overhead, switching branches is a clean transaction, and branch canons cannot accidentally cross-pollinate.
- **C. Comments author identity: Option 2 (Anonymous by default).** Comment threads and messages are timestamped by default without requiring an author name or profile setup. An author name or initials field can optionally be entered if desired, remaining completely local and offline.
