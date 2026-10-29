# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-28.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md accepted 2026-10-28: A original SVG charts; B tags tracked as separate anchored records, ADR 0005; C report PDFs/RTF from the core; D E5 and branch scope wait for M5; E reports first). Steps 1, 2 and 3 (report engine, StoryScry, report exports, and breakdown tags) are built and verified. Next: M4 step 4, tag reports and character participation.

## Completed & Verified

- **M4 steps 1 & 2 built & pushed (`791b37b`, `1fc0528`, 2026-10-28):** `cirth_core::reports`, `cirth_core::report_export` (CSV, TSV, XLSX, HTML, PDF, RTF), and `View > Tools > StoryScry…` (`app/src/storyscry.ts`).
- **M4 step 3 built (2026-10-28):**
  - **ADR 0005 (`docs/adr/0005-anchored-records.md`)** and `docs/DECISIONS.md`: text-range anchors stored as separate records (`document_id`, `block_id`, `start`/`end` in Unicode scalar values, `quote`, `orphaned`), with left-open/right-open boundary affinity, split/join/move mapping in `Store::apply`, and orphan retention + automatic recovery on script undo.
  - **Schema v11 (`crates/cirth-core/src/store.rs`, `tests/migrate.rs`):** frozen v10 fixtures (`schema-v10-page-boundaries.cirth`, `schema-v10-unicode-marks.cirth`) and `migrate_v11` (`breakdown_tags` table + `breakdown_tags_doc_block` index).
  - **Core (`crates/cirth-core/src/tags.rs`, `bible.rs`, `planning.rs`, `store.rs`):** 10 standard breakdown categories (`cast`, `extras`, `props`, `costume`, `vehicles`, `sound`, `vfx_sfx`, `stunts`, `makeup`, `set_dressing`) plus custom writer categories in `settings('tags', 'categories')`; expanded bible kinds and `derive_with_tags` counting tag occurrences under bible entries; whole-word action-line tag suggestions (`tags::suggest`) from bible names and aliases; undoable `PlanningOp::PutTag` and `PlanningOp::DeleteTag`.
  - **UI (`app/src/tags.ts`, `app/src/bible.ts`, `app/src/main.ts`, `app/src-tauri/src/main.rs`):** `View > Tools > Breakdown Tags…` dialog (`#tags-dialog`) and ProseMirror inline decorations (`.cirth-tag-mark`) with UTF-16 ↔ Unicode scalar conversion.
- **Verified (2026-10-28):** `cargo test -p cirth-core` (120 passed: 66 unit, 25 store, 16 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); `npm run e2e:cdp` (66/66 passed) and `npm run e2e:webdriver` (65/65 passed, 1 skipped: IME); visual check of `out/screens-cdp/breakdown-tags.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual checks N32 (StoryScry on macOS/high-contrast), N33 (external spreadsheet/doc checks in Google Sheets, Excel, LibreOffice, M4 step 7), and N34 (breakdown tags manual check);
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

None.

## Next Immediate Step

1. M4 step 4: tag reports and character participation (`cirth_core::reports` and `report_export` for breakdown tag categories keeping occurrences and distinct scenes apart [E2] with scene links [E1], plus character participation combining speaking scenes, present-but-silent scenes from `cast` tags, dialogue share, and documented estimated participation time never labelled "screen time" [E6, E7]).
2. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
