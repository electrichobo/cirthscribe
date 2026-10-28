# Status

Updated 2026-10-27.

**M2 closed by the owner on 2026-10-27 (`docs/m2/EXIT_REVIEW.md`). Next milestone: M3, connected story development; plan accepted by the owner 2026-10-27 (`docs/M3_PLAN.md`); step 1 not started.** Workspace steps from the owner's notes come first: W1 (menus) and W2 (notes panel) built 2026-10-28; W3–W5 next. Fixed on the way: settings changed after the last save (notes, title page, headers, revision sets) were lost if the app crashed before saving; they are now recovered like script edits. Revision colours follow the Writers Guild order (owner, 2026-10-28): White original, Blue … Cherry, then Double Blue. M1 and M1b closed by the owner on 2026-10-27, with Linux latency, reference machines, defect 3 and macOS check N20 carried forward (`docs/m1/EXIT_REVIEW.md`). M0 complete.

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
