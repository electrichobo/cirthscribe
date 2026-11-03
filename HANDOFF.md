# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-31.

## Current Milestone & Goal

**Milestones 0–7 complete (`docs/m7/EXIT_REVIEW.md`).** The art-asset hold ended 2026-11-02: the owner delivered 52 files, now integrated (`docs/ART_ASSETS.md`). Next: owner review of the art in the app, then manual checks and the macOS hardware run.

## Completed & Verified

- **Owner art integration (2026-11-02, `docs/ART_ASSETS.md`):**
  - Delivered SVGs each wrap one PNG; converted with Windows' built-in .NET imaging, no new tools.
  - App icon (`tauri icon`): `.ico`, Linux PNGs, `.icns` from the macOS-grid version; masters in `assets/art/`.
  - NSIS header and sidebar BMPs, DMG background; wired in `tauri.conf.json`.
  - Wordmark on Home and About: colour (light), white (dark), single-colour (high contrast), text (Windows contrast).
  - UI icons: owner art on light themes only (owner decision); line icons elsewhere. `ART` in `icons.ts`, rules at the end of `styles.css`.
  - Wordmark lettering "Kółbítar" is a stylization (owner); the text name stays Kolbítar.
  - e2e theme test now asserts which art each theme shows and that the files load; adds `theme-day-art` screenshot.
- **N52 macOS part (GROGU, 2026-11-02, transcribed):** build and DMG pass; DMG background drew at 75% (96 DPI tag). Fixed: 1320×800 @144 DPI; recheck at c682424 passes (fills window, sharp, icons on target), except the painted nib tip crossed the "Kolbítar" label. Fixed (owner chose lightening): light bands behind both labels at GROGU's measured positions; window 660×432 so the title bar no longer hides the art's bottom 32 pt. Recheck at ebbcb7f passes. Themes, wordmarks, About, closed dialogs pass. Not checked: Dock, Cmd+Tab, Match System in macOS Light.
- **N52 passed (2026-11-02):** owner reports the Mac checks good (Dock, Cmd+Tab, Match System in Light) and the Windows installer works with the app opening after install.
- **Fixed: closed dialogs drawn over the script.** Nine dialog rules set `display: flex`/`grid`, overriding the hidden state, so closed dialogs stacked at the top of the window (Branches on top, since M5 step 4). One rule now hides any closed dialog.
- **Verified 2026-11-02 (Windows):** `npm run build`; `cargo build -p cirthscribe --release`; contract 4/4; offline audit passed; notices check (357); e2e CDP 88/88, WebDriver 87/88 (1 skipped IME). `cargo test -p cirth-core` 191/191 on 2026-10-31 (no core change since).
- **Not verified:**
  - Physical macOS run (N31, M1–M13, D1–D4, N1–N20), interactive Linux desktop; manual checks N47–N51.
  - Not done: file-type icons for `.cirth`/`.cirth-review` (Tauri 2 file associations use the app icon).

## In-Progress / Uncommitted State

- Uncommitted: N52 owner results in MANUAL_CHECKS.md, HANDOFF, STATUS, README.

## Next Immediate Step

1. Remaining manual checks N47–N51 and the physical macOS run; owner picks the next priority.
2. File-type icons need a custom NSIS template and an `Info.plist` entry if the owner wants them.
