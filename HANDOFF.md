# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

**M2 closed by the owner on 2026-10-27** (docs/m2/EXIT_REVIEW.md: decision B option 2, close and carry; decision A option 2, non-Latin PDF text stays a reported limitation). Next is M3, connected story development. **docs/M3_PLAN.md accepted by the owner 2026-10-27** (decisions A–E; episodes moved to step 2). Step 1 not started. Owner notes 2026-10-28 became workspace steps W1–W5, before step 1; the owner answered all five questions (docs/M3_PLAN.md, "Workspace and menus"). **W1 (menus) is built**; next W2 (notes panel).

## Completed & Verified

- M2 steps 1–8 built; step 9 has its baseline (test pack and docs/COMPATIBILITY.md, first Mac round logged and fixed).
- Linux e2e, red in CI from d2d7bdc (M2 step 3), is green again: the More popover and floating-panel Tab traps now run in the capture phase on the document (c49ae5a, 92a2cf9). **CI on 92a2cf9: Linux, macOS and Windows all green.**
- Checks run on Windows 11 for 92a2cf9: `npm run e2e:cdp` (50/50), `npm run e2e:webdriver` (49/49, 1 skipped: IME).
- Closure recorded in STATUS, ROADMAP, M2_PLAN, the exit review, COMPATIBILITY, AGENTS, START_HERE; README brought up to date (Stage 2 done, known limits, carried items, docs table).
- Revision colours set to the Writers Guild order (owner, 2026-10-28): White (original draft, selectable, never picked for a new set), Blue … Cherry, then "Double Blue", "Triple Blue". `cargo test -p cirth-core` passes; e2e "Revision sets" passes on both drivers (CDP and WebDriver).
- W0 fixes: dropdown options use theme colours (styles.css); Home's Free Writing button sits under Open, same size (home.ts). Free Writing's independence and save-on-close checked in code (already true). e2e: CDP 50/50, WebDriver 49/49 (1 skipped: IME).
- W1 menus built (main.rs menu builder, window_command, open_releases_page, peek_file; main.ts runMenu; new exportdlg.ts, goto.ts, shortcuts.ts). Checks: `npm run build`, contract (4), e2e CDP 50/50, WebDriver 49/49 (1 skipped: IME). Manual N29 open (minimise, zoom, full screen, browser, real imports).
- M3 plan drafted from ROADMAP M3, PRODUCT_SPEC 3–4, ACCEPTANCE B and C, and the current code (one document in the UI; structural permission not stored; planning edits not undoable).
- Not verified (carried into M3):
  - external app results (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print);
  - the Mac recheck of pack v2 (deferred by the owner);
  - manual checks N20–N28;
  - M1 carry-overs: Linux latency, reference machines, defect 3;
  - known limits as in the exit review (non-Latin PDF glyphs, dual dialogue stacked in DOCX/RTF/HTML).

## In-Progress / Uncommitted State

None once the W1 commit is made.

## Next Immediate Step

1. W2: the notes panel (a project-saved scratchpad, listed under View > Tools). Then W3 pop-out panels (ADR on window state), W4 themes, W5 shortcut remapping.
2. Then M3 step 1: write ADR 0003 (focus-routed undo), store the structural permission in `document:<id>` settings (store.rs, main.ts `structural`), then planning commands with a core-side undo history.
3. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`, and a failed job's annotations under `/check-runs/<job id>/annotations`.
