# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-28.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md accepted 2026-10-28: A original SVG charts; B tags tracked as separate anchored records, ADR 0005; C report PDFs/RTF from the core; D E5 and branch scope wait for M5; E reports first). Steps 1–4 (report engine, StoryScry, report exports, breakdown tags, tag reports and character participation) are built and verified. Next: M4 step 5, stripboard and schedule.

## Completed & Verified

- **M4 steps 1–3 built & pushed (`791b37b`, `1fc0528`, `f5736f0`, 2026-10-28):** `cirth_core::reports`, `cirth_core::report_export`, StoryScry dashboard, ADR 0005 anchored tags, schema v11, Breakdown Tags dialog.
- **M4 step 4 built (2026-10-28):**
  - **Tag breakdown reports (`E1`, `E2`, `E8`):** `cirth_core::reports` computes `TagCategoryReport` for all categories, keeping total occurrences and distinct scenes strictly apart (`E2`) with clickable scene links (`E1`); StoryScry card + Breakdown Tags tab with category filter and paired SVG bar chart (occurrences vs distinct scenes); independent single-category (`tag:<category>`) and all-tag (`tags`) exports across all 6 formats (`E1`).
  - **Character participation & timing estimates (`E6`, `E7`, `E8`):** speaking scenes, silent scenes (from `cast` breakdown tags), total scenes, V.O./O.S./dual speeches; dialogue speaking time (150 wpm) vs scene participation time (1 page = 8 eighths ≈ 1.0 min); overlapping character durations are not divided or forced to 100%; documented estimate methodology note; never labelled "screen time".
- **Verified (2026-10-28):** `cargo test -p cirth-core` (122 passed: 68 unit, 25 store, 16 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); `npm run e2e:cdp` (67/67 passed) and `npm run e2e:webdriver` (66/66 passed, 1 skipped: IME); visual check of `out/screens-cdp/storyscry-character-participation.png` and `storyscry-tags.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual checks N32 (StoryScry on macOS/high-contrast), N33 (external spreadsheet/doc checks in Google Sheets, Excel, LibreOffice, M4 step 7), and N34 (breakdown tags manual check);
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

Files modified for M4 step 4:
- `crates/cirth-core/src/reports.rs` & `crates/cirth-core/src/report_export.rs`: tag category aggregation, character participation metrics, single-category exports.
- `app/src-tauri/src/main.rs`: export command report kind handling.
- `app/src/storyscry.ts`: tag reports tab, character participation chart, badges, estimate note.
- `app/tests/e2e/suite.mjs`: e2e test for tag reports and character participation.
- `docs/M4_PLAN.md`, `README.md`, `HANDOFF.md`: progress notes and status.

## Next Immediate Step

1. Commit and push M4 step 4 when the owner asks.
2. M4 step 5: stripboard and schedule (`docs/M4_PLAN.md` step 5; scene strips, schedule order, day breaks, banners, unscheduled pile, PDF/HTML/XLSX/CSV export, E3, E4, E9).
3. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
