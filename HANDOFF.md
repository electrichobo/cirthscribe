# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-30.

## Current Milestone & Goal

**Milestone 6 (additional formats and language tools)** in progress (`docs/M6_PLAN.md`). Steps 1–4 complete. Next: M6 Step 5 (general rich-text / treatment documents & bible integration).

## Completed & Verified

- **Milestones 0–5 complete; M6 Steps 1–4 complete:**
  - Step 1: Document formats & profiles model (schema v16, `DocumentProfile`, layout profiles, duplicate-and-convert). Committed `26d0b06`.
  - Step 2: Comic book & graphic novel scripting (`cirth_core::comic`, comic Tab/Enter cycles, dialog, text/HTML exports, E2E Test 77). Committed `3f3f6f3`.
  - Step 3: Stage play & TV multi-camera profiles (`cirth_core::stage_teleplay`, lettered scenes, uppercase dialogue, Act/Scene headings, bracketed stage directions, profile layout pagination, text exports, E2E Test 78). Committed `fe2a3e6`.
  - Step 4: Immersive & branching interactive storytelling (`cirth_core::interactive`, passages, inline choice syntax, conditions, BFS graph integrity validator, Twee 3 export, standalone playable offline HTML runner, JSON graph export, interactive inspector/playtester dialog, E2E Test 79). Committed `05dc032`.
- **Verified:**
  - `cargo test -p cirth-core` (165/165 passed: 105 unit including 7 interactive, 4 golden, 6 layout, 21 migration v1–v16, 29 store).
  - `npm --prefix app run build` (clean).
  - `cargo build -p cirthscribe --release` (clean).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (355 components passed).
  - `npm --prefix app run e2e:cdp` (79/79 passed, 0 skipped, clean audit).
  - `npm --prefix app run e2e:webdriver` (78/78 passed, 1 skipped: simulated IME).
- **Not verified (carried into M6):**
  - M5 manual checks N37–N40 (comments, alternatives, branches, review packages);
  - M4 manual checks N32–N36 (external spreadsheet and viewer verification);
  - from M3: Mac run (N31), N29, N30, limits in `docs/m3/EXIT_REVIEW.md` §1;
  - from M2/M1: external screenplay interchange, non-Latin PDF glyphs, reference machine latency, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

- Documentation updated for Step 5 start. Commencing M6 Step 5: General rich-text / treatment documents & bible integration.

## Next Immediate Step

1. Build M6 Step 5: General rich-text / treatment documents & bible integration (`crates/cirth-core/src/treatment.rs`, exports, UI dialog, and E2E Test 80).
