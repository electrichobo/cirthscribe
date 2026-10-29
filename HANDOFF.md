# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md). Steps 1–5 (report engine, StoryScry, report exports, breakdown tags, tag reports/character participation, and stripboard/schedule) are built and verified. Next: M4 step 6, character sides.

## Completed & Verified

- **M4 steps 1–4 built & pushed (`791b37b`, `1fc0528`, `f5736f0`, `6d4cefb`):** reports engine, StoryScry dashboard, multi-format report exports, ADR 0005 anchored tags, schema v11, tag reports, and character participation.
- **M4 step 5 built (2026-10-29):**
  - **Stripboard & schedule (`E3`, `E4`, `E9`):** `cirth_core::stripboard` with `reconcile_schedule` preserving user schedule order while updating live scene numbers, page numbers, eighths, headings, and tags from screenplay (`E3`); omitted/deleted scenes flagged visibly rather than dropped (`E4`); color legend pairing high-contrast symbols (`○`, `●`, `☼`, `☽`, `◈`) with names; day breaks, banners, unscheduled pile, and sorting; `PlanningOp::SetSchedule` with undo/redo (`ADR 0003`); exports in PDF (Courier Prime 12pt, repeated headers, legend, unclipped descriptions, `E9`), HTML (print CSS, legend, unclipped), XLSX (OpenXML, formula-safe), and CSV (UTF-8, RFC 4180, formula-safe); modal dialog (`#stripboard-dialog`) via `View > Tools > Stripboard…`.
- **Verified (2026-10-29):** `cargo test -p cirth-core` (126 passed: 71 unit, 26 store, 16 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); `npm run e2e:cdp` (68/68 passed) and `npm run e2e:webdriver` (67/67 passed, 1 skipped: IME); visual check of `out/screens-cdp/stripboard.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual checks N32 (StoryScry on macOS/high-contrast), N33 (external spreadsheet/doc checks in Google Sheets, Excel, LibreOffice, M4 step 7), N34 (breakdown tags manual check), N35 (stripboard external exports);
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

Files modified for M4 step 5:
- `crates/cirth-core/src/stripboard.rs`, `crates/cirth-core/src/lib.rs`, `crates/cirth-core/src/planning.rs`, `crates/cirth-core/src/store.rs`, `crates/cirth-core/tests/store.rs`: core stripboard engine, reconciliation, exports, planning op, tests.
- `app/src-tauri/src/main.rs`: Tauri commands `stripboard_state`, `save_stripboard`, `export_stripboard`, menu item.
- `app/src/stripboard.ts`, `app/src/bindings.ts`, `app/src/main.ts`, `app/src/styles.css`: stripboard UI dialog, styles, shortcuts, scene reorder.
- `app/tests/e2e/suite.mjs`: e2e test for Stripboard independent order, omitted reconciliation, color legend, exports.
- `docs/M4_PLAN.md`, `README.md`, `HANDOFF.md`: progress notes, checklist and handoff state.

## Next Immediate Step

1. Commit and push M4 step 5 when the owner asks.
2. M4 step 6: character sides (`docs/M4_PLAN.md` step 6; actor sides PDF with scene-only and struck-through pages, locked scene numbers and page labels kept, dual-dialogue pairs preserved, built on the production PDF).
3. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
