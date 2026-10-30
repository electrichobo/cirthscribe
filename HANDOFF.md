# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**Milestone 6 (additional formats and language tools)** in progress (`docs/M6_PLAN.md`). Step 1 complete. Next: M6 Step 2 (comic book & graphic novel scripting).

## Completed & Verified

- **Milestones 0–5 complete; M6 Step 1 complete:**
  - Step 1: Document formats and profiles model (schema v16, `DocumentProfile` enum in `cirth_core::model`, layout engine profile geometries in `cirth_core::layout::Profile`, duplicate-and-convert preservation, frozen `schema-v15-*.cirth` upgrade tests).
- **Verified:**
  - `cargo test -p cirth-core` (145/145 passed: 85 unit, 4 golden, 6 layout, 21 migration v1–v16, 29 store).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (355 components passed).
  - `npm --prefix app run e2e:cdp` (76/76 passed, 0 skipped, clean audit).
  - `npm --prefix app run e2e:webdriver` (75/75 passed, 1 skipped: simulated IME).
- **Not verified (carried into M6):**
  - M5 manual checks N37–N40 (comments, alternatives, branches, review packages);
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Clean working tree with M6 Step 1 built and verified across all test suites, ready for commit.

## Next Immediate Step

1. Commit and push M6 Step 1: Document formats and profiles model (schema v16 & layout engine extensions).
2. Proceed to M6 Step 2: Comic book & graphic novel scripting (`docs/M6_PLAN.md`).
