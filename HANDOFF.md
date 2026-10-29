# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-28.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md accepted 2026-10-28: A original SVG charts; B tags tracked as separate anchored records, ADR at step 3; C report PDFs/RTF from the core; D E5 and branch scope wait for M5; E reports first). Steps 1 and 2 (report engine, StoryScry, and report exports) are built and verified. Next: M4 step 3, breakdown tags (starting with an ADR for the anchor design).

## Completed & Verified

- **M4 step 1 built & pushed (`791b37b`, 2026-10-28):** `cirth_core::reports`, `Store::beats_of`, and `View > Tools > StoryScry…` (`app/src/storyscry.ts`) with 7 reports, original SVG charts + table toggle (E8), scope/omitted filters, and live staleness detection (B6).
- **M4 step 2 built (2026-10-28):**
  - `cirth_core::report_export`: exports any individual report (`scenes`, `characters`, `locations`, `action_dialogue`, `int_ext`, `day_night`, `revisions`) or all seven together (`all`) in CSV, TSV, XLSX (OpenXML via `zip` with typed numeric/boolean cells and deterministic Unix 0644 attributes), HTML, PDF (Courier Prime 12 pt, wrapped columns and repeated table headers on page breaks, E9) and RTF. Every export states scope, `source_version`, `planning_version` and estimate notes; tabular exports include both human scene numbers and stable source IDs (`document_id`, `scene_id`, `set_id`) and prefix formula-leading text cells (`=`, `+`, `-`, `@`, `\t`, `\r`) with `'`.
  - UI & IPC: `export_report` Tauri command (`app/src-tauri/src/main.rs`), StoryScry export bar (`#storyscry-export-report`, `#storyscry-export-format`, `#storyscry-export-btn`), and `File > Export… > Reports (StoryScry)…` (`app/src/exportdlg.ts`).
- **Verified (2026-10-28):** `cargo test -p cirth-core` (115 passed: 63 unit, 24 store, 15 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); `npm run e2e:cdp` (65/65 passed) and `npm run e2e:webdriver` (64/64 passed, 1 skipped: IME); visual check of `out/screens-cdp/storyscry-dashboard.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual checks N32 (StoryScry on macOS/high-contrast) and N33 (external spreadsheet/doc checks in Google Sheets, Excel, LibreOffice, M4 step 7);
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

None.

## Next Immediate Step

1. M4 step 3: write ADR 0005 (`docs/adr/0005-anchored-records.md`) for text-range anchors (block id + Unicode scalar offsets + quoted text, mapped through edits, orphan handling), freeze schema v10 fixtures, add schema v11 migration for breakdown tags, and implement tag categories, bible linking, and suggested tags.
2. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
