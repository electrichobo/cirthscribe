# M1 exit review

Date: 2026-10-26. Commit reviewed: `16af402`. Reviewer: coding agent, for the owner.

**Verdict: M1 is not done.** (Updated later on 2026-10-26: blockers 3, 6 and 7 are closed; see section 3.) Every M1 feature item is built and tested automatically on Windows. Linux has partial automated coverage. macOS has none for editing. M1's exit gate asks for more than that: editing smoke tests on all three OSes, crash tests on all three, and performance measured on each OS. Those runs are missing, and two tests the gate depends on do not exist yet. Nothing found so far is a known data-loss defect. The gaps are untested paths, not failures.

Gate sources: ROADMAP.md (M1 exit) and the exit tests in docs/M1_PLAN.md.

## 1. What passes (measured, with where)

| Area | Evidence | Platforms |
| - | - | - |
| Core library: store, transactions, migrations, layout, word counts, spell check, text export, Free Writing store | `cargo test -p cirth-core`: 18 lib, 3 contract, 4 layout, 7 migrate and 14 store tests (plus the TypeScript contract test, 4 checks) | Windows (local); Linux, macOS and Windows in CI |
| Hard-kill crash tests at the store level: acknowledged batches survive `kill`; a mid-transaction kill leaves the previous state | `tests/store.rs` (`killed_process_keeps_every_acknowledged_batch`, `killed_mid_transaction_leaves_previous_state`) | All three, in CI |
| End-to-end app suite (editing, paste, Unicode, simulated IME, autosave and recovery after a hard kill, second instance, migrations, find/replace, autocomplete, word counts, spelling, dual dialogue, page view, Save As, outside-change conflict copies, backups, Free Writing and Flow mode, About, page size and TXT export, accessibility audit, keyboard-only, display preferences) | `app/tests/e2e/suite.mjs` | Windows local: DevTools 34/34; WebDriver 33/33, 1 skipped (simulated IME needs DevTools) |
| Same suite on Linux | CI, WebKitGTK under Xvfb | Linux CI (green as of `d20f479`, including the third-party notices check; see section 4 for `16af402`) |
| Latency and open time on the long fixture (127 pages) | FINDINGS: p95 input-to-paint 29 to 35 ms over four runs (target < 50 ms); warm open 65 ms (target < 3 s) | Windows dev machine only |
| No open data-loss or corruption defect | STATUS "Open defects": the two open items are a Windows dev-build linker warning and Windows e2e on the hosted runner. The End-key defect is fixed, with a 0/500 stress result | n/a |

ROADMAP M1 feature list, built:
- App shell and keyboard-first editor.
- Letter/A4 per document.
- Create, open, save and save-as; autosave, undo, recovery, backups and migrations.
- Find and replace; cue and location suggestions; word counts.
- Spell check with user dictionaries.
- Free Writing.
- `.cirth` package and TXT export.
- Panel focus, accessibility basics and the page view.

Not built or only partial:
- **Project tree.** Schema v2 has documents and containers, but there is no tree UI; the app shows the navigator for one document. I'm reading "project tree" as a UI item. If you meant the data model, this is done.
- Configurable backup counts.

## 2. What is still manual (not run)

All of these need a test machine, not the owner's production machine. Checklists are in `docs/testing/MANUAL_CHECKS.md`. The results log there is empty.

| Check | Section | Why it is manual |
| - | - | - |
| macOS editing pass (M1 to M11) | 1 | WKWebView has no WebDriver. It covers the End/Enter defect on WebKit, paste, Unicode, board moves, crash recovery and a second instance. |
| Native Open/Save As dialogs (D1 to D4) | 1b | No driver can operate OS dialogs. |
| Native menus, macOS Edit menu, dual-dialogue caret, TXT in a real editor (N1 to N8) | 1c | OS menus can't be automated. |
| Real IMEs: Japanese, Pinyin, Korean on Windows, macOS and Linux | 2 | Only simulated composition is automated. Adding input languages changes system settings. |
| Screen readers: Narrator, VoiceOver, Orca (A1 to A10) | 3 | Only a real reader shows what is spoken. Screen readers talk aloud and take over input. |
| High DPI | (no checklist yet) | Not tested anywhere. |
| End-key stress test on WKWebView and WebKitGTK | M1_PLAN 1.1 | The Linux e2e runs the startup regression test. The 500-trial stress test is Windows-only (DevTools), and macOS has none. |

## 3. What blocks calling M1 done

In priority order. Items 1 to 4 are the gate. Items 5 to 7 are gaps where the gate is not stated clearly enough to pass.

1. **macOS editing smoke test has never run.** The ROADMAP gate says "editing smoke tests pass on Windows, Mac, and Linux". This needs the MANUAL_CHECKS section 1 run on a Mac (unavailable for a few days) and logged.
2. **Real IME run is missing.** A3 says that with an IME "no characters disappear, duplicate, or corrupt". Simulated composition passes, but a real IME is where editors usually lose text. At least one CJK IME should be checked on each OS before M1 can be called free of data-loss risk.
3. ~~**There is no real kill-during-package-save test.**~~ **Closed 2026-10-26.** `cirth-cli crash-at <point>` stops a real save at three points: snapshot written, snapshot flushed, and file replaced. The test kills it with the same hard kill as the store crash tests (`killed_during_package_save_keeps_a_valid_package_and_every_edit`). The package is always a whole file (old or new) and every acknowledged edit comes back on reopen. The next save works despite the leftover temp file. A deliberately non-atomic save (delete, then write) fails the test. A crash inside the migration transaction is covered too (`killed_during_migration_leaves_the_original_and_reopens_cleanly`): the project file and pre-migration copy are untouched, the working copy rolls back to v1, and reopening migrates cleanly with no duplicate backup. These run in CI on all three OSes as part of `cargo test -p cirth-core`.
4. **Performance is measured on one OS only.** The gate wants p95 < 50 ms and warm open < 3 s "on each OS's reference machine". Linux and macOS have no measurement and no reference machine is defined. Linux CI under Xvfb is not a fair reference. The p99 tail (33 to 134 ms between runs) is still unexplained (M1_PLAN 1.5).
5. **Windows CI e2e does not run.** WebView2 doesn't start on the hosted runner, and the step is non-blocking. Windows is covered by local runs, which the gate accepts as "recorded manual runs". Record those runs in the results log, or fix the runner. Not a hard blocker if the log is kept.
6. ~~**No model contract test.**~~ **Closed 2026-10-26.** `fixtures/model-contract.json` holds every block kind, every field, marks, Unicode, beats and a batch with each op. Rust (`tests/contract.rs`) must serialize it back byte-for-byte as JSON values. The editor's own conversion code (`app/tests/contract.mjs`, run by Node with no build step) must return every block unchanged, and its diff may only emit the contract's op shapes. Renaming one field on the TypeScript side fails the test. It runs in CI's frontend step on all three OSes.
7. ~~**No A1 offline test.**~~ **Closed 2026-10-26, with a stated limit.** The e2e test runs this flow:
   - create a project, type and save;
   - reopen it;
   - export text and PDF;
   - write in Free Writing;
   - open About.
   It records every request the page makes. On Windows that was 48 requests, all to the app's own origins (`tauri.localhost`, `ipc.localhost`). It also proves the content policy refuses an outside address. The probe uses a `.invalid` name, so nothing could leave even without the policy. Static facts: `cirth-core` has no network crate; the app grants no http, shell or fs permission. **Limit:** this does not switch the machine's network off (that changes system settings, which this machine must not have). The Tauri framework itself links an HTTP client, `reqwest`, which CirthScribe never calls. Requests the WebView makes outside the page, such as browser updates or SmartScreen, are not visible to the page. A run with the network adapter disabled belongs on a test machine.

Owner decisions (2026-10-26):
- **macOS 11 Big Sur or later.** CI now builds with `MACOSX_DEPLOYMENT_TARGET=11.0` and checks the binary's minimum OS.
- **Windows x64 only,** no 32-bit build.
- **`.cirth` stays.**

Still open:
- Minimum Windows version (WebView2 needs 10 or 11).
- Windows on ARM.
- Linux distributions.
- Which machine is the reference machine for each OS.

I'm inferring that macOS builds cover both Apple Silicon and Intel, since Big Sur runs on both.

Not an M1 gate item, but it blocks any binary release: 19 bundled crates publish no licence file. The third-party notices list their authors instead of a licence text (`docs/m0/LICENSES.md`).

## 4. CI for this commit

Run 40438344525 on `16af402` is **green** on all three jobs:
- Linux: core tests, the frontend build (which includes `tsc --noEmit`), the third-party notices check, the app build and the WebDriver e2e suite.
- macOS: core tests and the app build.
- Windows: core tests and the app build.

The two Windows e2e steps also show "success", but they are `continue-on-error`. The public API reports such a step as a success even when it fails, and reading the job log needs a GitHub sign-in. So this does not show that Windows e2e ran on the runner.

## 5. Proposed order to close M1

1. ~~Add the kill-during-package-save test and the model contract test.~~ Done.
2. ~~Add an offline smoke test.~~ Done in-app; a network-off run is still due on a test machine.
3. Owner: name a reference machine per OS, the minimum Windows version and the Linux distributions.
4. Run on test machines and log the results:
   - macOS: section 1 checks, plus latency on the long fixture.
   - Real IMEs: section 2.
   - Screen readers: section 3.
   - Linux desktop: latency.
5. Fix whatever those runs find, then repeat this review.
