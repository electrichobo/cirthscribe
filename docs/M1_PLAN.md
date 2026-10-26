# Milestone 1 plan: dependable writing foundation

Status: proposed, 2026-10-25. Builds on the M0 spike and ADR 0001. Goal from ROADMAP.md: a user can write and safely recover a complete screenplay; editing smoke tests pass on Windows, macOS and Linux; no unresolved corruption or data-loss defects.

Order matters: the first three items remove M0's open risks before features grow.

## 1. Close M0 risks (first)

1. ~~**Root-cause the End-key selection defect**~~ **Done 2026-10-25.** Cause: async `selectionchange` delivery vs. high-priority key input. Fix: adopt the DOM selection before key commands (`app/src/selsync.ts`). Exit met: 0/500 stress trials missed (control without the fix: 28/50), plus a startup regression test. Still to do on other platforms: rerun the stress test on WKWebView and WebKitGTK in item 2.
2. **Cross-platform harness.** Built 2026-10-25: one driver-neutral suite (`app/tests/e2e/suite.mjs`) with a DevTools driver (WebView2) and a WebDriver driver (`tauri-driver`: msedgedriver on Windows, WebKitWebDriver on Linux); skips are reported with reasons. macOS WKWebView has no WebDriver: manual checklist in `docs/testing/MANUAL_CHECKS.md`. Verified on Windows through both drivers (14/14 DevTools; 13/13 WebDriver with IME skipped). **Remaining:** first Linux run in CI; first macOS manual pass.
3. **CI builds.** `.github/workflows/ci.yml`, first results 2026-10-26 (run 40271323906):
   - Linux (Ubuntu 24.04, WebKitGTK, WebDriver under Xvfb): **green**. Core tests pass; e2e 14/14 with simulated IME skipped.
   - macOS 15: **green** (core tests including process-kill crash tests; app builds). Editing is manual (`docs/testing/MANUAL_CHECKS.md`).
   - Windows Server 2025 (MSVC): core tests and build **green**; MSVC binary imports no `WebView2Loader.dll` and no MinGW runtime (answers the M0 question). **e2e not working on the runner:** the app runs but WebView2's DevTools port never opens (90 s wait, WebView2 155.0.4283.62 installed). The WebDriver variant was cancelled before it finished. Next: rerun the WebDriver step; if it fails the same way, investigate the runner's desktop session.
   - Remaining: lint and typecheck steps.
4. **Real IME checklist** (`docs/testing/MANUAL_CHECKS.md` section 2): Microsoft Japanese, Chinese (Pinyin) and Korean IMEs on Windows; macOS Japanese/Pinyin; IBus or Fcitx on Linux. Run on test machines, not the owner's production machine, since enabling input languages changes system settings.
5. **Tail latency.** p99 input-to-paint varies 33 to 134 ms between runs with no long tasks (FINDINGS). Find the cause before relying on p99.

## 2. App shell and project lifecycle

- **Done 2026-10-25:** Home screen (project library) with New project, Samples, library cards (title, file, counts, modified, recovery badge), open, and save-and-close back to Home. Tested by e2e (create, reopen, no overwrite, recovery badge, locked project).
- Native menus and shortcuts; New, Open, Save, Save As, Close, Recent projects (file dialogs via `tauri-plugin-dialog`; add after a dependency review).
- Autosave on a timer and on close, writing the package as well as the working copy (SCHEMA.md); visible save status including "not stored" errors.
- Backups: rolling package copies (count configurable).
- Durable rename: `MoveFileExW` with write-through on Windows; fsync of the directory on Unix.
- Schema v2 and the migration framework with backup-before-migrate and stored v1 fixtures (A7).
- Detect external changes to the package and conflicting writers (A6), keeping both versions.

## 3. Editor completeness

- Contract test that Rust `model.rs` and TS `schema.ts` agree (generate TS types from Rust, or a shared JSON fixture round trip).
- Find and replace (block-type filters, undoable replace-all).
- Character and location autocomplete from the script (no bible yet), with keyboard selection.
- Word counts per block, selection and document, using one documented rule shared with Rust (A8).
- Local spell check with a user dictionary: evaluate Hunspell-compatible options (license and dictionary sources checked first; US and UK English).
- Dual-dialogue editing UI (toggle on a cue), forced page break command, section and lyric styling.
- Draft page view: page frames drawn from the Rust page map; continuous view as an alternative.

## 4. Free Writing workspace

Separate workspace database with folders, search, autosave and recovery; explicit copy or move into a project, with provenance (A4).

## 5. Export and profiles

- TXT export through a real serializer, with a small capability note.
- Letter and A4 controls in the UI (layout engine already supports both), stored per document.
- PDF stays labeled "draft proof" in M1; production PDF is M2.

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
