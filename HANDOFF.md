# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

**M2 closed by the owner on 2026-10-27** (docs/m2/EXIT_REVIEW.md: decision B option 2, close and carry; decision A option 2, non-Latin PDF text stays a reported limitation). Next is M3, connected story development. **docs/M3_PLAN.md accepted by the owner 2026-10-27** (decisions A–E; episodes moved to step 2). Step 1 not started. Owner notes 2026-10-28 became workspace steps W1–W5, before step 1; the owner answered all five questions (docs/M3_PLAN.md, "Workspace and menus"). All workspace steps W1–W5 are built. **All M3 steps 1–9 are built** (the last: the evidence board and bookmarks, schema v10); next the M3 exit review.

## Completed & Verified

- M2 steps 1–8 built; step 9 has its baseline (test pack and docs/COMPATIBILITY.md, first Mac round logged and fixed).
- Linux e2e, red in CI from d2d7bdc (M2 step 3), is green again: the More popover and floating-panel Tab traps now run in the capture phase on the document (c49ae5a, 92a2cf9). **CI on 92a2cf9: Linux, macOS and Windows all green.**
- Checks run on Windows 11 for 92a2cf9: `npm run e2e:cdp` (50/50), `npm run e2e:webdriver` (49/49, 1 skipped: IME).
- Closure recorded in STATUS, ROADMAP, M2_PLAN, the exit review, COMPATIBILITY, AGENTS, START_HERE; README brought up to date (Stage 2 done, known limits, carried items, docs table).
- Revision colours set to the Writers Guild order (owner, 2026-10-28): White (original draft, selectable, never picked for a new set), Blue … Cherry, then "Double Blue", "Triple Blue". `cargo test -p cirth-core` passes; e2e "Revision sets" passes on both drivers (CDP and WebDriver).
- W0 fixes: dropdown options use theme colours (styles.css); Home's Free Writing button sits under Open, same size (home.ts). Free Writing's independence and save-on-close checked in code (already true). e2e: CDP 50/50, WebDriver 49/49 (1 skipped: IME).
- W1 menus built (main.rs menu builder, window_command, open_releases_page, peek_file; main.ts runMenu; new exportdlg.ts, goto.ts, shortcuts.ts). Checks: `npm run build`, contract (4), e2e CDP 50/50, WebDriver 49/49 (1 skipped: IME). Manual N29 open (minimise, zoom, full screen, browser, real imports).
- W2 notes panel built (notes.ts; store project_notes; Tools > Notes). Store fix: settings changes now count as unsaved work, so a crash no longer loses notes, title page or header changes made after the last save. Checks: `cargo test -p cirth-core` (all pass), e2e CDP 51/51, WebDriver 50/50 (1 skipped: IME), contract 4.
- W3 pop-out panels built: panels.ts (main side), panelwin.ts + panel.html (window side), ScriptView in views.ts, Rust pop_out_panel / close_panel_window (async: building a window in a sync command deadlocks on Windows) / window_labels, capability panel-*. Checks: e2e CDP 52/52, WebDriver 51/51 (1 skipped: IME), contract 4. Manual N30 open.
- W4 themes built: data-theme tokens in styles.css (Day, Night, Midnight, OLED; none = Match System), UiPrefs.theme, View > Appearance > Theme. Checks: e2e CDP 53/53, WebDriver 52/52 (1 skipped: IME), contract 4.
- W5 shortcut remapping built: bindings.ts (registry, combos, conflicts), one dispatcher in main.ts, Help > Keyboard Shortcuts… (shortcuts.ts), UiPrefs.keys, Rust set_menu_texts. Checks: e2e CDP 54/54, WebDriver 53/53 (1 skipped: IME), contract 4.
- M3 step 1 built: core planning.rs + Store::apply_planning (versions, inverses), planning edits count as unsaved, board_structural per document; app commands planning_state_now / planning_command / planning_undo / set_board_structural (put_beat command removed); board undo routing in main.ts; planning writes queued so undo waits for them. Checks: `cargo test -p cirth-core` (all pass, new planning test), e2e CDP 55/55, WebDriver 54/54 (1 skipped: IME), contract 4.
- M3 step 2 built: store current_document (meta), project_tree, create_folder, create_episode, rename_item, move_item (cycle-safe); load/apply/beats follow the current document; app shell uses current_document everywhere; open_document command; projecttree.ts dialog; export names include the episode. Checks: `cargo test -p cirth-core` (all pass, new series test), e2e CDP 56/56, WebDriver 55/55 (1 skipped: IME), contract 4.
- M3 step 3 built: navigator.rs, schema v6 scene_labels, label names, PlanningOp::SetSceneLabel, paginate returns scene_stats, navigator_info / set_label_name commands; views.ts renderNavigator with tabs, filter, scope; labelnames.ts; pop-out window gets nav data. Checks: `cargo test -p cirth-core` (all pass; new navigator and v5-upgrade tests), e2e CDP 57/57, WebDriver 56/56 (1 skipped: IME), contract 4.
- M3 step 4 built: schema v7 (beats kind/title/parent), check_outline_place, Outline tab in views.ts (planWith runs moves in the write queue), board shows beats in outline order, reorderFromOutline under the permission, delete via DeleteBeat. Checks: `cargo test -p cirth-core` (all pass; outline and v6-upgrade tests), e2e CDP 58/58, WebDriver 57/57 (1 skipped: IME), contract 4.
- M3 step 5 built: board grouped into acts (views.ts renderBoard), Add acts… starting structures, card Act menu, drop onto an act, pacing strip; SceneStat.position in core; navigator layout fixes found by screenshot. Checks: `cargo test -p cirth-core` (all pass), e2e CDP 59/59, WebDriver 58/58 (1 skipped: IME), contract 4.
- M3 step 6 built: overview.ts dialog (map and list), navigator_info project scenes carry page/eighths/position per document, View > Tools > Overview…, bindings entry without a default key. Checks: `cargo test -p cirth-core` (all pass), e2e CDP 60/60, WebDriver 59/59 (1 skipped: IME), contract 4.
- M3 step 7 built: bible.rs, schema v8, PutEntity/DeleteEntity/Reject planning ops, apply_rename; shell bible_state / bible_rename_preview / bible_rename_apply; bible.ts dialog; Characters tab groups aliases (navigator::characters_named); autocomplete offers bible names. Checks: `cargo test -p cirth-core` (all pass; bible and v7-upgrade tests), e2e CDP 61/61, WebDriver 60/60 (1 skipped: IME), contract 4.
- M3 step 8 built: timeline.rs, schema v9, PutEvent/DeleteEvent, timeline_state, timeline.ts dialog, scenes.ts reorderScenes (one transaction). Checks: `cargo test -p cirth-core` (all pass; timeline and v8-upgrade tests), e2e CDP 62/62, WebDriver 61/61 (1 skipped: IME), contract 4.
- M3 step 9 built: evidence.rs, schema v10, card/string/bookmark planning ops, evidence_state / add_picture / picture_data / open_link, evidence.ts canvas, bookmarks.ts. Checks: `cargo test -p cirth-core` (all pass; evidence and v9-upgrade tests), e2e CDP 63/63, WebDriver 62/62 (1 skipped: IME), contract 4.
- M3 plan drafted from ROADMAP M3, PRODUCT_SPEC 3–4, ACCEPTANCE B and C, and the current code (one document in the UI; structural permission not stored; planning edits not undoable).
- Not verified (carried into M3):
  - external app results (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print);
  - the Mac recheck of pack v2 (deferred by the owner);
  - manual checks N20–N28;
  - M1 carry-overs: Linux latency, reference machines, defect 3;
  - known limits as in the exit review (non-Latin PDF glyphs, dual dialogue stacked in DOCX/RTF/HTML).

## In-Progress / Uncommitted State

None once the step 9 commit is made.

## Next Immediate Step

1. M3 exit review (docs/m3/EXIT_REVIEW.md, like docs/m2/EXIT_REVIEW.md): check ROADMAP's M3 items and exit line ("cards, navigator, script, chronology and bible stay consistent after edits and undo; no duplicated scene prose or accidental reorder") and ACCEPTANCE B1–B6, C1–C4 against code, tests and CI; list what is not done (C5 needs M5; manual checks; Mac and Linux desktop runs of the new dialogs); ask the owner how to close.
2. Then M3 step 1: write ADR 0003 (focus-routed undo), store the structural permission in `document:<id>` settings (store.rs, main.ts `structural`), then planning commands with a core-side undo history.
3. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`, and a failed job's annotations under `/check-runs/<job id>/annotations`.
