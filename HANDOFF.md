# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**Milestone 5 (review, alternatives, and branches)** in progress (`docs/M5_PLAN.md`). Steps 1–3 complete. Next: M5 Step 4 (visual branch history and independent branch canon).

## Completed & Verified

- **Milestones 0–4 complete; M5 Steps 1–3 complete:**
  - Step 1: Anchored local comment threads (`cirth_core::comments`, schema v12) with review dialog.
  - Step 2: Non-destructive block alternatives (`cirth_core::alternatives`, schema v13) with take badges.
  - Step 3: Named snapshots and checkpoints (`cirth_core::snapshots`, schema v14) with `snapshots` table, non-destructive restore, automatic pre-restore checkpoints, `File > Snapshots…` dialog.
- **Verified:**
  - `cargo test -p cirth-core` (137/137 passed: 77 unit, 4 golden, 6 layout, 19 migration v1–v14, 29 store, 2 cli).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (355 components passed).
  - `npm --prefix app run e2e:cdp` (72/72 passed, 0 skipped, clean audit).
  - `npm --prefix app run e2e:webdriver` (71/71 passed, 1 skipped: simulated IME).
- **Not verified (carried into M5):**
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Docs: `README.md` and `HANDOFF.md` updated with Stage 5 progress.

## Next Immediate Step

1. Commit and push docs update (`README.md` and `HANDOFF.md`).
2. Proceed to M5 Step 4: visual branch history and independent branch canon (`crates/cirth-core/src/branches.rs`).
