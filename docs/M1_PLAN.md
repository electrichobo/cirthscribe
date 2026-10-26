# Milestone 1 plan: dependable writing foundation

Status: proposed, 2026-10-25. Builds on the M0 spike and ADR 0001. Goal from ROADMAP.md: a user can write and safely recover a complete screenplay; editing smoke tests pass on Windows, macOS and Linux; no unresolved corruption or data-loss defects.

Order matters: the first three items remove M0's open risks before features grow.

## 1. Close M0 risks (first)

1. ~~**Root-cause the End-key selection defect**~~ **Done 2026-10-25.** Cause: async `selectionchange` delivery vs. high-priority key input. Fix: adopt the DOM selection before key commands (`app/src/selsync.ts`). Exit met: 0/500 stress trials missed (control without the fix: 28/50), plus a startup regression test. Still to do on other platforms: rerun the stress test on WKWebView and WebKitGTK in item 2.
2. **Cross-platform harness.** Built 2026-10-25: one driver-neutral suite (`app/tests/e2e/suite.mjs`) with a DevTools driver (WebView2) and a WebDriver driver (`tauri-driver`: msedgedriver on Windows, WebKitWebDriver on Linux); skips are reported with reasons. macOS WKWebView has no WebDriver: manual checklist in `docs/testing/MANUAL_CHECKS.md`. Verified on Windows through both drivers (14/14 DevTools; 13/13 WebDriver with IME skipped). **Remaining:** first Linux run in CI; first macOS manual pass.
3. **CI builds.** `.github/workflows/ci.yml`, first results 2026-10-26 (run 40271323906):
   - Linux (Ubuntu 24.04, WebKitGTK, WebDriver under Xvfb): **green**. Core tests pass; e2e 14/14 with simulated IME skipped.
   - macOS 15: **green** (core tests including process-kill crash tests; app builds). Editing is manual (`docs/testing/MANUAL_CHECKS.md`).
   - Windows Server 2025 (MSVC): core tests and build **green**; MSVC binary imports no `WebView2Loader.dll` and no MinGW runtime (answers the M0 question). **Open item: e2e does not run on the hosted runner.** DevTools driver: the app runs but WebView2's DevTools port never opens (90 s wait, WebView2 155.0.4283.62 installed). WebDriver driver: the step hung with no output past the runner's 25-minute deadline and the 30-minute step limit (run 40274314737), so the in-runner deadline also failed to fire on Windows (a harness defect). Guess, unconfirmed: WebView2 cannot start in the runner's desktop session. Update (run 40397042653, 2026-10-26): with an 8-minute cap the WebDriver suite's own deadline did fire, before the first test, so the app never reached Home on the runner; the DevTools driver again saw the app running with no debugging port. Since 2026-10-26 both Windows e2e steps are `continue-on-error` with a 10-minute cap and do not gate CI. **Windows e2e is a local check** on a desktop session (`npm run e2e:cdp`, `npm run e2e:webdriver`) until this is solved. Next: read the job log (needs a GitHub sign-in), then try a self-hosted or interactive-session runner.
   - Remaining: lint and typecheck steps.
4. **Real IME checklist** (`docs/testing/MANUAL_CHECKS.md` section 2): Microsoft Japanese, Chinese (Pinyin) and Korean IMEs on Windows; macOS Japanese/Pinyin; IBus or Fcitx on Linux. Run on test machines, not the owner's production machine, since enabling input languages changes system settings.
5. **Tail latency.** p99 input-to-paint varies 33 to 134 ms between runs with no long tasks (FINDINGS). Find the cause before relying on p99.

## 2. App shell and project lifecycle

- **Done 2026-10-25:** Home screen (project library) with New project, Samples, library cards (title, file, counts, modified, recovery badge), open, and save-and-close back to Home. Tested by e2e (create, reopen, no overwrite, recovery badge, locked project).
- **Done 2026-10-26:** Open and Save As anywhere through native dialogs (`tauri-plugin-dialog` 2.8.3, MIT/Apache-2.0); recent files outside the library on Home, with "File not found" and "Remove from list"; outside-change detection with conflict copies (A6 "second writer cannot overwrite unnoticed", for writers outside the app). Tested by e2e with the dialog bypassed; dialog appearance is a manual check.
- **Done 2026-10-26:** native File menu (New Project, Open, Save, Save As, Export PDF, Close Project, Quit; macOS also gets the app menu and an Edit menu); shortcuts Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+O handled in the web UI (same on every platform, testable); restore-from-backup on Home ("Backups (n)…", restore as a new library project, nothing overwritten); opening another project saves the current one first. Menu appearance and the macOS Edit menu are manual checks.
- ~~Native menus and shortcuts; New, Open, Save, Save As, Close, Recent projects~~ Done (see above). (file dialogs via `tauri-plugin-dialog`; add after a dependency review).
- **Done 2026-10-26:** autosave of the project file every 60 s and on window close (flushes pending edits first), file-save status in the toolbar; rolling backups (20 kept, 10-minute spacing, always on explicit Save); crash-safe replacement (`MoveFileExW` write-through on Windows, rename + directory fsync on Unix). Tests: core rotation/replace tests; e2e "autosave, Save backs up, closing saves the last edits". **Still to do:** configurable counts. (Restore from backup: done, see below.)
- **Done 2026-10-26:** schema v2 (documents, containers, settings; blocks and beats scoped to a document) and the migration framework: numbered steps in one transaction, untouched pre-migration copy kept outside rotation, upgrade in the working copy, file rewritten at next save. Tested against real v1 files frozen before the change, plus an e2e upgrade test (A7). **Not tested:** a crash during migration.
- ~~Detect external changes to the package and conflicting writers (A6), keeping both versions.~~ Done (see above).

## 3. Editor completeness

- Contract test that Rust `model.rs` and TS `schema.ts` agree (generate TS types from Rust, or a shared JSON fixture round trip).
- **Done 2026-10-26:** find and replace (Ctrl/Cmd+F, Edit menu): match case, Unicode-aware whole word, block-type filter (e.g. rename a character in cues only), highlights with a counter, replace one, replace all as one undo step, inline marks kept. Tested end to end, including scrolling each match into view (a bug the test caught) and replace-all on the 127-page script (about 7 ms for 70 cues). Not yet: search within a selection, regular expressions, replace preview.
- **Done 2026-10-26:** autocomplete from the script (no bible yet): cue names (most frequent first, extensions stripped), extensions after "(", heading prefixes, known locations, times of day, transitions. Up/Down, Tab accepts, Escape closes; Enter accepts and continues Final Draft style. Not shown during IME composition. Not yet: screen-reader announcement of the list, suggestions from a bible.
- **Done 2026-10-26:** word counts with one rule (`cirth-core/src/words.rs`, documented there; 26 shared cases in `fixtures/word-count-cases.json`): footer shows block, selection and script counts (script total from the store, with dialogue and action). The editor asks Rust for counts, so live and report numbers cannot drift (A8).
- **Done 2026-10-26:** spell check (ADR 0002): spellbook 0.4.2 with SCOWL US/UK large dictionaries embedded; language per project (US, UK, off); underlines as decorations; right-click or Ctrl/Cmd+. for suggestions, Ignore, Add to project dictionary, Add to my dictionary; corrections are undoable edits; cue names accepted automatically. Whole 127-page script checked in about 32 ms. Not yet: other languages; grammar (separate, later).
- **Done 2026-10-26:** dual dialogue toggle (Ctrl/Cmd+D, Edit menu) with the layout engine's pairing rule, refused with a message where the layout could not pair; pairs shown side by side in the editor at the profile's dual columns. Forced page break (Ctrl/Cmd+Enter, Edit menu). View: Continuous or Pages; page view draws a gap at every page boundary from the Rust page map (also inside a split speech) and never changes pagination. Tested end to end against the Rust page map. Not yet: section and lyric styling beyond the defaults; dual pairs taller than a page (layout falls back to sequential speeches with a warning).

## 4. Free Writing workspace

Separate workspace database with folders, search, autosave and recovery; explicit copy or move into a project, with provenance (A4).

- **Done 2026-10-26:** Free Writing (Home, toolbar, no project needed). Pieces live in `freewriting.db` in the app data folder (`cirth-core/src/freewrite.rs`), not in any project. Folders (double-click to rename), case-insensitive search, Trash with Restore (nothing is deleted), autosave 0.5 s after typing stops and on leaving, plain-text export. Copy into project inserts each paragraph as an action block at the script cursor as one undoable edit and keeps the piece; Move does the same and puts the piece in Trash. Both are recorded on the piece and in the project's settings. **Flow mode** turns off editing for brain dumps: Backspace, Delete, arrows, Home/End, undo, cut and select-all do nothing; clicks and paste cannot move the insertion point from the end; spelling underlines and the sidebar are hidden; Esc turns editing back on. Tested end to end with both drivers, including a hard kill after autosave. Not yet: rich text in pieces, a timed or word-goal session, a bulk export.

## 5. Export and profiles

- TXT export through a real serializer, with a small capability note.
- Letter and A4 controls in the UI (layout engine already supports both), stored per document.
- PDF stays labeled "draft proof" in M1; production PDF is M2.
- **Done 2026-10-26:** page size (US Letter or A4) is stored per document in the project file (`documents.profile`); the toolbar control loads it on open, and pagination, PDF and text export use it. Plain-text export (File menu and toolbar, `cirth-core/src/txt.rs`) writes the authoritative page map as fixed-pitch text: same line breaks, indents (columns from the action margin), (MORE)/(CONT'D), dual dialogue side by side, form feeds between pages and page numbers from page 2. After export the app says what plain text cannot keep (font, exact margins, bold/italic/underline, with a count). Tested in core (every laid-out line present in order; columns; page numbers) and end to end (A4 kept after reopening; page count equals the A4 page map). Not yet: an unformatted "paragraphs only" text option; Fountain (M2 interchange).
- **Done 2026-10-26:** About and licences screen (Home link; Help menu on Windows/Linux, app menu on macOS): attribution, copyright, GPL notice and no-warranty statement, the full NOTICE and GPL text, and every bundled third-party license from `assets/legal/THIRD-PARTY-NOTICES.txt` (generated by `app/scripts/third-party-notices.mjs` across Windows, Linux and macOS targets; CI fails if it is out of date).

## 6. Accessibility

Focus order across panels, screen-reader labels and live regions (save status), high-contrast and UI scale settings, keyboard-only navigator and board operations. Test with Narrator, VoiceOver and Orca.

## Exit tests (in addition to ROADMAP's M1 gate)

- All M0 tests plus new ones pass on Windows, macOS and Linux CI or recorded manual runs.
- Long fixture: p95 input-to-paint < 50 ms on each OS's reference machine; warm open < 3 s.
- Crash tests (kill after acknowledged autosave, kill during package save) on all three OSes.
- No open data-loss or corruption defect.

## Decisions needed from the owner during M1 (not blocking the start)

- Project license (affects how MPL-2.0 dependencies are listed, not whether they can be used).
- Minimum OS versions and CPU architectures.
- Spell-check engine and dictionary sources once options are compared.
- Whether `.cirth` stays the extension.
