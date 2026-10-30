# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**Milestone 5 (review, alternatives, and branches)** in progress (`docs/M5_PLAN.md`). Steps 1–4 complete. Next: M5 Step 5 (base/source/target 3-way conflict integration).

## Completed & Verified

- **Milestones 0–4 complete; M5 Steps 1–4 complete:**
  - Step 1: Anchored local comment threads (`cirth_core::comments`, schema v12) with review dialog.
  - Step 2: Non-destructive block alternatives (`cirth_core::alternatives`, schema v13) with take badges.
  - Step 3: Named snapshots and checkpoints (`cirth_core::snapshots`, schema v14) with `snapshots` table in SQLite, non-destructive restore, automatic pre-restore checkpoints, `File > Snapshots…` dialog.
  - Step 4: Visual branch history and independent branch canon (`cirth_core::branches`, schema v15) with branch-isolated snapshots in SQLite, fork/switch/delete management, `File > Branches…` dialog, and status bar branch pill.
- **Verified:**
  - `cargo test -p cirth-core` (138/138 passed: 77 unit, 4 golden, 6 layout, 20 migration v1–v15, 29 store, 2 cli).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (355 components passed).
  - `npm --prefix app run e2e:cdp` (73/73 passed, 0 skipped, clean audit).
  - `npm --prefix app run e2e:webdriver` (72/72 passed, 1 skipped: simulated IME).
- **Not verified (carried into M5):**
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Clean working tree ready for commit.

## Next Immediate Step

1. Commit and push M5 Step 4 (visual branch history and independent branch canon).
2. Proceed to M5 Step 5: Base/source/target 3-way conflict integration (`crates/cirth-core/src/merge.rs`).
