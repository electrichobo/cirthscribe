# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**Milestone 5 (review, alternatives, and branches)** in progress (`docs/M5_PLAN.md`). Step 1 (anchored comment threads and review) complete. Next: M5 Step 2 (non-destructive alternatives: takes and alternate lines).

## Completed & Verified

- **Milestones 0–4 complete; M5 Step 1 complete:**
  - Anchored local comment threads (`cirth_core::comments`, schema v12) with quote preservation, resolution tracking, left-open/right-open mapping across typing, block splits, joins, moves, deletions (orphan quote retention and recovery), and planning undo.
  - Tauri commands, View > Tools > Comments… menu item, ProseMirror inline decorations (`.cirth-comment-mark`), and accessible review dialog.
- **Verified:** `cargo test -p cirth-core` (135 passed); `npm --prefix app run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); e2e comments and menus tests passing on CDP and WebDriver; `node app/scripts/third-party-notices.mjs --check` (355 components).
- **Not verified (carried into M5):**
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Core: `crates/cirth-core/src/comments.rs`, `backup.rs`, `lib.rs`, `planning.rs`, `store.rs`, `tests/migrate.rs`, `tests/store.rs`, fixtures `schema-v11-*.cirth`.
- Tauri & UI: `app/src-tauri/src/main.rs`, `app/src/comments.ts`, `app/src/main.ts`, `app/src/styles.css`, `app/tests/e2e/suite.mjs`.
- Docs: `docs/M5_PLAN.md`, `docs/DECISIONS.md`, `START_HERE.md`, `STATUS.md`, `HANDOFF.md`.

## Next Immediate Step

1. Commit M5 Step 1 with message `M5 step 1: anchored comment threads and review` and push when requested.
2. Begin M5 Step 2: non-destructive alternatives model and active take projection (`crates/cirth-core/src/alternatives.rs`).
