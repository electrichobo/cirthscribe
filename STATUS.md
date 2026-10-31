# Status

Updated 2026-10-30.

**M7 (optional integrations) closed 2026-10-30 (`docs/m7/EXIT_REVIEW.md`). Steps 1–6 built 2026-10-30:**
- Steps 1–4: Optional AI Assistant & Non-Destructive Diff Engine (`cirth_core::ai`, `app/src-tauri/src/main.rs`, `app/src/aidlg.ts`, and E2E Test 82).
  - Off by default; zero unsolicited network requests; complete offline operation preserved when disabled.
  - Bring-your-own model / endpoint (local Ollama / LM Studio or cloud providers); API keys and settings stored securely in working store.
  - Transparent scope disclosure and rule-of-thumb token estimator (~4 chars/token in English); scopes cover Selection, Block, Scene, DocumentSummary, and Project Bible.
  - Non-destructive block diff comparison engine (`compute_block_diffs`) showing added, modified, removed, and unchanged blocks with colored UI status badges.
  - Batch diff application preserving Heading `scene_id` invariants; UI dialog with generate, diff preview, and accept/reject actions.
- Step 5: Cloud Sharing & Google Workflow Compatibility Adapter (`cirth_core::export_capability`, `docs/INTEROPERABILITY.md`, `app/src/exportdlg.ts`, and E2E Test 83).
  - Export capability analysis for external formats (Google Docs .docx, Google Sheets .xlsx/.csv, FDX, PDF, Plain Text, HTML, Twee, JSON).
  - Fidelity grades (`Authoritative`, `HighFidelity`, `LossyStructural`, `Incompatible`) with explicit loss warnings (line wrap drift, sequential dual dialogue, dynamic A-page flow, non-tabular script text).
  - Dynamic export dialog guidance and comprehensive cloud collaboration documentation.
- Step 6: Compatibility Matrix, Automated Verification & Milestone 7 Exit Review.
  - Full automated suite verification (188 core tests, 4 contract tests, 355 license notices, 83 CDP tests, 82 WebDriver tests).
  - Updated `docs/COMPATIBILITY.md`, manual checks N47 and N48 in `docs/testing/MANUAL_CHECKS.md`, authored `docs/m7/EXIT_REVIEW.md`.
- Post-M7 Onboarding, Font Packaging & Cross-Platform Hardening (2026-10-30):
  - Software Tour onboarding dialog (`app/src/tour.ts`, `app/src-tauri/src/main.rs`, `app/src/main.ts`, and E2E Test 84). 6-card illustrated walkthrough (Canvas, Focus, Planning, Production, Versions, Formats), keyboard navigation (Left/Right/Esc), skip/complete with localStorage persistence, and re-launchable via `Help > Software Tour…`.
  - Non-Latin script screen font packaging (`assets/fonts/noto-sans/`, `assets/fonts/noto-serif/`, `app/src/styles.css`, `app/src/a11y.ts`, `docs/m0/LICENSES.md`, `assets/legal/THIRD-PARTY-NOTICES.txt`). SIL OFL 1.1 TrueType fonts covering full international Unicode ranges (Cyrillic, Greek, Hebrew, Arabic, Devanagari, CJK ideographs) across Serif and Sans screen font settings.
  - Cross-platform macOS & Linux audit hardening:
    - `cirth_core::fsutil::replace_file`: best-effort parent directory `sync_all` on Unix, preventing false save errors on APFS, FAT32/exFAT, and network shares.
    - macOS focus restoration & full screen (`app/src-tauri/src/main.rs`, `app/src/bindings.ts`): dual-pulse focus restoration (150 ms + 350 ms safety net) on macOS exit from full screen; native menu and shortcut updated to `Cmd+Ctrl+F` (`Mod+Ctrl+F`) on macOS per Apple HIG to prevent system interception of `F11`.
    - Platform detection & focus trapping (`app/src/main.ts`, `app/src/tour.ts`): dual `isMac` check across `navigator.platform` and `navigator.userAgent`; WebKitGTK / WKWebView Tab / `ISO_Left_Tab` focus trap and width layout fix on tour dialog.
  - File Associations, Bundler & Drag-and-Drop (`app/src-tauri/tauri.conf.json`, `app/src-tauri/src/main.rs`, `app/src/main.ts`, and E2E Test 85):
    - Native OS file associations for `.cirth` (Kolbítar Project) and `.cirth-review` (Review Package).
    - Bundler configuration across Windows NSIS, macOS DMG, and Linux Deb/AppImage.
    - CLI argument parsing (`startup_file`) and `tauri::WindowEvent::DragDrop` handler auto-opening dropped project or screenplay import files.
  - Automated Offline & Zero-Telemetry Audit (`app/scripts/offline-audit.mjs`, `npm --prefix app run test:offline`):
    - Static CSP validation, dependency audit against telemetry/analytics libraries, codebase network scan, and live process socket table inspection verifying 0 external connections.
  - UI Vector SVG Icon Registry (`app/src/icons.ts`):
    - Comprehensive 24×24 stroke icon system (35+ icons) utilizing `currentColor` for dynamic light, dark, midnight, OLED, and Windows contrast themes.
  - Sorkinesque High-Fantasy Showcase Script (*The Obsidian Seal*, `fixtures/high-council.json`, `app/src-tauri/src/main.rs`, `app/src/home.ts`, E2E Test 86):
    - Rapid-fire walk-and-talk rhythm script fixture exercising characters, dialogue, scene transitions, and production beats with zero AI cliches.
  - Native Print Stylesheet & Printing (`app/src/styles.css`, `app/src-tauri/src/main.rs`, `app/src/bindings.ts`, `app/src/main.ts`, E2E Test 87, Manual Check N50):
    - `@media print` rules enforcing physical Letter portrait page dimensions, Courier Prime 12pt, margin-aligned scene numbers, screen color markup suppression, and `File > Print…` / `Ctrl+P` (`Cmd+P`) action.
  - Cross-Platform VM Setup Scripts (`scripts/setup-linux.sh`, `scripts/setup-mac.sh`):
    - Turnkey provisioning scripts for Debian/Ubuntu, Fedora, Arch Linux, and macOS installing dependencies, building release binaries, and running smoke test suites.
  - Windows NSIS Installer Bundle (`target/release/bundle/nsis/Kolbítar_0.0.1_x64-setup.exe`):
    - Verified single-file installer wizard packaging release binary, icons, file associations, and uninstaller cleanly.
  - Full automated suite verified: 188 core tests, 4 contract tests, 357 license notices, offline audit 100% passed, 87 CDP tests, 86 WebDriver tests (1 skipped). Added manual check N50 in `docs/testing/MANUAL_CHECKS.md`.

**M6 (additional formats and language tools) closed 2026-10-30 (`docs/m6/EXIT_REVIEW.md`). Steps 1–7 built 2026-10-29 / 2026-10-30:**
- Step 1: document formats and profiles model (schema v16, `DocumentProfile` enum in `cirth_core::model` covering US/UK screenplays, multi-cam teleplays, stage plays, comics, interactive stories, and treatments; frozen `schema-v15-*.cirth` upgrade tests; layout engine profile support in `cirth_core::layout::Profile`; Decision A duplicate-and-convert preservation; full e2e tests passing on CDP 76/76 and WebDriver 75/75).
- Step 2: comic book & graphic novel scripting (`cirth_core::comic` with explicit page/panel hierarchy, speech balloons, captions, sound effects, sequential continuity warnings, panel renumbering reconciliation, and format exports in Plain Text and HTML; profile-aware comic Tab/Enter cycles; comic script analysis dialog; automated E2E Test 77 passing on CDP 77/77 and WebDriver 76/76).
- Step 3: stage play & TV multi-camera profiles (`cirth_core::stage_teleplay` with `convert_to_teleplay_multicam`, `convert_to_stageplay`, and text exports; profile-aware PDF pagination and plain-text exports; automated E2E Test 78 passing on CDP 78/78 and WebDriver 77/77).
- Step 4: immersive & branching interactive storytelling (`cirth_core::interactive` with passage/choice parser, inline syntax, BFS graph validation, Twee 3, standalone offline playable HTML runner, and JSON graph exports; interactive dialog with live playtester; automated E2E Test 79 passing on CDP 79/79 and WebDriver 78/78).
- Step 5: general rich-text / treatment documents & bible integration (`cirth_core::treatment` with structural hierarchy H1–H3, body paragraphs, blockquotes, bullet lists, character spotlights, reading time estimates, and Project Bible entity cross-referencing; semantic HTML, Plain Text, and DOCX exports; treatment inspector dialog; automated E2E Test 80 passing on CDP 80/80 and WebDriver 79/79).
- Step 6: offline grammar, style & dialogue analysis engine (`cirth_core::grammar` with 100% offline rule-based detection for duplicate words, passive voice in action lines, screenplay dialogue quotation rules, parenthetical casing and terminal periods, screenplay cliches and fillers, and spacing anomalies; one-click replacement fix; grammar analysis review dialog; automated E2E Test 81 passing on CDP 81/81 and WebDriver 80/80).
- Step 7: compatibility matrix, format fixtures, manual checks & milestone 6 exit review (synthetic format fixtures in `fixtures/`, unit tests in `fixtures::tests`, `docs/COMPATIBILITY.md`, manual checks N41–N46 in `docs/testing/MANUAL_CHECKS.md`, and `docs/m6/EXIT_REVIEW.md`).
Next: Milestone 7 (Optional extras: bring-your-own AI, cloud sharing workflows). M5 closed 2026-10-29 (`docs/m5/EXIT_REVIEW.md`); M4 closed 2026-10-29 (`docs/m4/EXIT_REVIEW.md`); M3 closed 2026-10-28 (`docs/m3/EXIT_REVIEW.md`); M2 closed 2026-10-27 (`docs/m2/EXIT_REVIEW.md`); M1 and M1b closed 2026-10-27 (`docs/m1/EXIT_REVIEW.md`); M0 complete. The working state between sessions is in `HANDOFF.md`.

M2 progress: steps 1–8 built (title page, Fountain, FDX, scene numbers, production PDF, revision sets, locked pages, DOCX/RTF/HTML exports; details under each step in `docs/M2_PLAN.md`). Step 9, the compatibility matrix, has its baseline: the test pack and the record (`docs/COMPATIBILITY.md`), with the first Mac round logged and its defects fixed. Linux e2e, red in CI since M2 step 3 (Tab traps on WebKitGTK), is green again from 92a2cf9: all three CI jobs pass. **Carried into M3:** external app tests (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print), the Mac recheck of pack v2, manual checks N20–N28, and the M1 carry-overs (Linux latency, reference machines, defect 3). Non-Latin PDF text (CJK, Hebrew, Arabic, emoji) prints blank and is reported by the export; a fallback font comes in a later milestone. The working state between sessions is in `HANDOFF.md`.

M1 progress:
- 1.1 done: End-key selection defect fixed; regression and stress tests.
- 1.2 done: driver-neutral e2e suite with DevTools and WebDriver drivers; passes on Windows through both and on Linux in CI. macOS is a manual checklist (not run yet).
- 1.3 CI: Linux green (WebKitGTK e2e, IME skipped); macOS green (core tests, build); Windows builds and core tests green with MSVC, but e2e cannot start WebView2 on the GitHub runner. Windows e2e steps are non-blocking in CI (10-minute cap); Windows e2e is run locally on a desktop session until this is solved.
- 2 Home screen (project library) at startup: lists projects in the app's library folder with scene/block counts, modified time, backup count and a recovery badge; creates projects (titles never overwrite an existing file); opens samples; the toolbar's Home button saves and closes the project. Opening files from elsewhere on disk (file dialogs) is not built yet.
- 2 Saving: the project file autosaves every 60 s and on window close; rolling backups (20 kept); crash-safe file replacement. No restore-from-backup UI yet.

- 2 Schema v2 and migrations: older project files are upgraded on open, with the untouched original kept in backups; Home flags older files.

- 2 Files anywhere: Open and Save As through native dialogs; recent files on Home; outside changes never overwritten (conflict copy beside the file).

- 2 Menus and backups: native File menu (plus the standard macOS app and Edit menus), Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+O; restore any backup as a new project from Home; switching projects saves the current one first.

- 3 Find and replace: Ctrl/Cmd+F, match case, whole word, block-type filter, replace one/all (one undo).

- 3 Autocomplete (cues, extensions, heading prefix/location/time, transitions) and word counts (one documented rule in Rust; block, selection, script).

- 3 Spell check (ADR 0002): US/UK/off per project, project and personal dictionaries, suggestions by right-click or Ctrl/Cmd+.

- 3 Dual dialogue toggle (side by side in the editor), forced page break, page view (gaps from the Rust page map).
- 5 Page size (Letter/A4) stored per document; plain-text export from the page map, with a note on what text cannot keep.
- 6 Accessibility (automated parts): F6 between panels; keyboard-only scene list and board with announced moves; quiet save status; UI size and high contrast in the View menu, kept across restarts. Testing with real screen readers is not part of M1 (owner, 2026-10-26).
- About and licences screen (attribution, GPL, third-party licences); notices file generated and checked in CI.
- M1b (accepted 2026-10-26) in progress. Built: focus mode; panel toggles (View menu and toolbar dropdown); full menu bar on every OS; island toolbar with block type and B/I/U; typewriter mode; scene cards with logline and summary (schema v3, older files upgraded on open); on-screen font and size (screen only); text colour and highlight (screen-only markup, never printed). The add-comment button moved to M5 with the rest of comments (owner decision C, 2026-10-27), so M1b's feature list is complete; macOS checks M13 and N10–N16 passed on 2026-10-27 (GROGU, macOS 26.2); N17 passes on f5de878 (the web view is made first responder again after macOS simple full screen switches). N18 passes; the window has a minimum size of 900 × 560, but at that size with both side panels shown the page is wider than its column (changed afterwards: panels shrink, then float over the script from the island). N19 passed on macOS (64d712c); Tab now stays inside a floating panel; N20 recheck due for the arrow-key report.
- 4 Free Writing: notes outside any project (own database), folders, search, Trash, autosave that survives a hard kill, .txt export, copy or move into the open script with provenance. Flow mode turns off editing so text only grows at the end.

M1 exit review (2026-10-26, `docs/m1/EXIT_REVIEW.md`): **not done.** Features are built and tested on Windows (and Linux in CI), but the gate still needs a macOS editing run, a real IME run and latency measured on each OS. Closed since the review: a real kill-during-package-save test (and a crash during migration), a Rust/TypeScript model contract test, and an in-app offline test. Platforms (owner): Windows 10 or later (x64 only), macOS 11 or later, Linux distribution-agnostic; `.cirth` stays. Real-IME testing is waived by the owner (not run, not passed); screen-reader testing is not part of M1; the network-off check is deferred. Next: the macOS pass and latency on macOS and Linux (Help > Typing Latency… gives copyable numbers on any OS).

The repository contains a feasibility spike, not a usable application. Nothing here is a release.

| Item | Where |
| - | - |
| Findings, measurements, platform coverage, defects, risks | `docs/m0/FINDINGS.md` |
| Framework decision | `docs/adr/0001-desktop-stack.md` |
| Native schema and container proposal | `docs/m0/SCHEMA.md` |
| Dependency, font and tool licenses | `docs/m0/LICENSES.md` |
| Synthetic fixtures (original text) | `fixtures/` (regenerate: `cirth-cli gen-fixtures fixtures`) |

## Open defects

1. GNU-toolchain linker warning about manifests (Windows dev builds only).
2. Windows e2e on the GitHub-hosted runner: WebView2 does not start; the e2e runner's own deadline also failed to fire there. Non-blocking in CI; see `docs/M1_PLAN.md` 1.3.
3. End then Enter right after typing, under an artificially busy main thread (stress test, 40 ms of blocking every 50 ms): **rare miss, about 1 in 4,000 trials, cause not found.** Investigated 2026-10-27:
   - **Counts:** 2 misses in about 8,000 trials across 16 full-suite runs; 0 in 10,500 trials run on their own. The control without the fix still misses about 65–70%, so the test still detects the original race.
   - **The one detailed log** shows a different failure from the original race. The editor's selection and the DOM's agreed (so the M1 fix had nothing to adopt). The editor did not take in Home's caret move, and did not handle the final Enter at all (not marked handled). The browser's own Enter then did nothing, so "abc" stayed and no new line appeared.
   - **Likely causes:** both symptoms fit ProseMirror skipping its handlers, which happens when the keys are not delivered to the editor or while it believes an input-method composition is active.
   - **Effect:** no text lost; Enter does not make a new line once.
   - **Next:** the suite's stress test now records focus target, composition state and input events on any miss, so the next occurrence will say which.

Fixed: native End key right after typing missed by the editor (M1, see `docs/m0/FINDINGS.md`).

## Untested

macOS editing (manual checklist not yet run), real IMEs (waived by the owner 2026-10-26), screen readers (not part of M1, owner 2026-10-26), high DPI. Linux is covered by CI (WebKitGTK under Xvfb on Ubuntu 24.04), not by a desktop session.

## How to run (Windows, dev machine)

Toolchains are local to this checkout and the user profile; nothing is installed system-wide. In PowerShell:

```
. .\scripts\dev-env.ps1
cargo test -p cirth-core
cd app; npm ci; npm run build; cd ..
cargo build -p cirthscribe --release
target\release\cirthscribe.exe
cd app; npm run e2e:cdp
npm run e2e:webdriver   # needs tauri-driver (cargo install tauri-driver) and msedgedriver matching your WebView2 version on PATH
```
