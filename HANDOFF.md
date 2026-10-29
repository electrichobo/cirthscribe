# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-28.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md accepted 2026-10-28: A original SVG charts; B tags tracked as separate anchored records, ADR at step 3; C report PDFs/RTF from the core; D E5 and branch scope wait for M5; E reports first). Step 1 (report engine and StoryScry) is built and verified. Next: M4 step 2, report exports.

## Completed & Verified

- **M4 step 1 built (2026-10-28):**
  - `cirth_core::reports`: computes `ReportBundle` stamped with `source_version` and `planning_version` for any scope (`document`, selected `episodes`, or whole `project`; `include_omitted` off by default) and `Store::beats_of`. Seven reports: **Scenes** (number, omitted, INT/EXT, location, time of day, page, eighths [estimate], speakers, dual pairs, linked card logline), **Characters** (bible aliases merged, speeches, dual speeches, words, share %, scenes, first appearance), **Locations** (bible aliases merged, INT/EXT, scenes, eighths, first/last use), **Action vs dialogue** (words, lines and shares per scene and overall), **Interior vs exterior**, **Day vs night**, and **Revisions** (changed pages, labels, passages).
  - `View > Tools > StoryScry…` (`app/src/storyscry.ts`): dashboard of original SVG charts (Nightingale/polar area, bullet, dot plot, bar), "Show charts as tables" toggle from the same rows (E8), sortable/filterable full reports with scene-jump buttons, estimate labels, non-colour signals (stroke dash patterns + symbols), and live staleness detection (`B6`) with Refresh when the script or planning changes.
- **Verified (2026-10-28):** `cargo test -p cirth-core` (112 passed: 60 unit, 24 store, 15 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); `npm run e2e:cdp` (64/64 passed) and `npm run e2e:webdriver` (63/63 passed, 1 skipped: IME); visual check of `out/screens-cdp/storyscry-dashboard.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual check N32 (StoryScry on macOS/high-contrast);
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

None.

## Next Immediate Step

1. M4 step 2: report exports (CSV, TSV, XLSX via `zip`, HTML, PDF and RTF for each report independently, with scope and source-version header).
2. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
