# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-29.

## Current Milestone & Goal

**M4 (production analysis and stripboard)** in progress (docs/M4_PLAN.md). Steps 1–6 (reports, StoryScry, report exports, breakdown tags, tag reports/character participation, stripboard/schedule, and character sides) are built and verified. Next: M4 step 7, compatibility checks and exit review.

## Completed & Verified

- **M4 steps 1–5 built & pushed (`791b37b`, `1fc0528`, `f5736f0`, `6d4cefb`, `a14d610`):** reports, StoryScry, exports, breakdown tags, character participation, stripboard/schedule.
- **M4 step 6 built (2026-10-29):**
  - **Character sides (ROADMAP M4, PRODUCT_SPEC §6):** `cirth_core::sides` with `list_characters`, `analyze_scenes`, `generate_sides`, and `export_sides`; modes `scenes_only` and `cross_out` (with diagonal/horizontal strike-outs); preserves authoritative locked scene numbers in margins and page labels from production pagination; preserves both speakers of dual-dialogue pairs whole; title banner, watermark, custom header; modal UI `#sides-dialog` via `View > Tools > Character Sides…` and `File > Export…`.
- **Verified (2026-10-29):** `cargo test -p cirth-core` (130 passed: 74 unit, 27 store, 16 migrate, 6 layout, 4 golden, 3 contract); `cd app && npm run build`; `cargo build -p cirthscribe --release`; `npm run test:contract` (4/4); e2e tests passing on CDP and WebDriver; visual check of `out/screens-cdp/character-sides.png`; `node app/scripts/third-party-notices.mjs --check`.
- **Not verified (carried):**
  - M4 manual checks N32–N35;
  - from M3: Mac run (N31), N29, N30, known limits in docs/m3/EXIT_REVIEW.md §1, C5 (M5);
  - from M2: external app results, Mac recheck of compat pack v2, N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3, Windows e2e on hosted runner.

## In-Progress / Uncommitted State

Files modified for M4 step 6:
- `crates/cirth-core/src/sides.rs`, `crates/cirth-core/src/lib.rs`, `crates/cirth-core/src/pdf.rs`, `crates/cirth-core/tests/store.rs`: core sides engine and tests.
- `app/src-tauri/src/main.rs`: Tauri commands `sides_characters`, `export_sides`, menu item.
- `app/src/sides.ts`, `app/src/bindings.ts`, `app/src/exportdlg.ts`, `app/src/main.ts`, `app/src/styles.css`: sides UI dialog, shortcuts, export wiring, styles.
- `app/tests/e2e/suite.mjs`: e2e automated test for Character sides.
- `docs/M4_PLAN.md`, `README.md`, `HANDOFF.md`: plan progress, checklist, and handoff state.

## Next Immediate Step

1. Commit and push M4 step 6 when the owner asks.
2. M4 step 7: compatibility checks (Google Sheets, Excel, LibreOffice; browser HTML/PDF) and exit review.
3. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`.
