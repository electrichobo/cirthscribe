# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**Milestone 5 (review, alternatives, and branches)** in progress (`docs/M5_PLAN.md`). Steps 1 & 2 complete. Next: M5 Step 3 (named snapshots and checkpoints).

## Completed & Verified

- **Milestones 0–4 complete; M5 Steps 1 & 2 complete:**
  - Step 1: Anchored local comment threads (`cirth_core::comments`, schema v12) with quote preservation, resolution tracking, left-open/right-open mapping, orphan recovery, planning undo, inline decorations, and accessible review dialog.
  - Step 2: Non-destructive block alternatives (`cirth_core::alternatives`, schema v13) with `block_alternatives` table, automatic baseline Take 0 capture, atomic take switching/syncing, planning undo, StoryScry report inactive take label (Acceptance E5), take badge widget (`.cirth-take-badge`), and take picker.
- **Verified:** `cargo test -p cirth-core` (136 passed); `npm --prefix app run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); e2e alternatives, comments, and menus tests passing on CDP and WebDriver; `node app/scripts/third-party-notices.mjs --check` (355 components).
- **Not verified (carried into M5):**
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Core: `crates/cirth-core/src/alternatives.rs`, `lib.rs`, `planning.rs`, `store.rs`, `reports.rs`, `tests/migrate.rs`, `tests/store.rs`, fixtures `schema-v12-*.cirth`.
- Tauri & UI: `app/src-tauri/src/main.rs`, `app/src/alternatives.ts`, `app/src/main.ts`, `app/src/styles.css`, `app/tests/e2e/suite.mjs`.
- Docs: `docs/M5_PLAN.md`, `STATUS.md`, `HANDOFF.md`.

## Next Immediate Step

1. Commit M5 Step 2 with message `M5 step 2: non-destructive alternatives and takes` and push when requested.
2. Begin M5 Step 3: named snapshots and checkpoints (`crates/cirth-core/src/snapshots.rs`).
