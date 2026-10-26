# Milestone 1 plan: dependable writing foundation

Status: proposed, 2026-10-25. Builds on the M0 spike and ADR 0001. Goal from ROADMAP.md: a user can write and safely recover a complete screenplay; editing smoke tests pass on Windows, macOS and Linux; no unresolved corruption or data-loss defects.

Order matters: the first three items remove M0's open risks before features grow.

## 1. Close M0 risks (first)

1. **Root-cause the End-key selection defect** (FINDINGS open defect 1). Instrument ProseMirror's DOM observer around open; try physical keys; fix or work around; turn the repro into a regular test. Exit: 0 misses in 500 scripted trials including right after open.
2. **Cross-platform harness.** Replace the DevTools-only driver with WebDriver (`tauri-driver`: WebView2 on Windows, WebKitGTK on Linux) plus a manual checklist for macOS WKWebView, where Tauri has no WebDriver. Run the A2/A3/B tests on all three. Exit: results recorded per OS and WebView version.
3. **MSVC CI build** for Windows (GitHub Actions), Linux and macOS builds; Rust tests, TypeScript typecheck and the e2e suite where available. Confirm the manifest warning is gone and the binary needs no loader DLL.
4. **Real IME checklist**: Microsoft Japanese, Chinese (Pinyin) and Korean IMEs on Windows; macOS Japanese/Pinyin; IBus or Fcitx on Linux. Run on test machines, not VADER, since enabling input languages changes system settings.

## 2. App shell and project lifecycle

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
