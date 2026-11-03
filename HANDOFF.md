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
- **N52 macOS part (GROGU, 2026-11-02, transcribed):** build and DMG pass; DMG background drew at 75% (96 DPI tag). Fixed: 1320×800 @144 DPI, draws at 660×400 pt; recheck due. Themes, wordmarks, About, closed dialogs pass. Not checked: Dock, Cmd+Tab, Match System in macOS Light.
- **Fixed: closed dialogs drawn over the script.** Nine dialog rules set `display: flex`/`grid`, overriding the hidden state, so closed dialogs stacked at the top of the window (Branches on top, since M5 step 4). One rule now hides any closed dialog.
- **Verified 2026-11-02 (Windows):** `npm run build`; `cargo build -p cirthscribe --release`; contract 4/4; offline audit passed; notices check (357); e2e CDP 88/88, WebDriver 87/88 (1 skipped IME). `cargo test -p cirth-core` 191/191 on 2026-10-31 (no core change since).
- **Not verified:**
  - N52 Windows part (installer not built yet); DMG recheck on GROGU after the background fix.
  - Physical macOS run (N31, M1–M13, D1–D4, N1–N20), interactive Linux desktop; manual checks N47–N51.
  - Not done: file-type icons for `.cirth`/`.cirth-review` (Tauri 2 file associations use the app icon).

## In-Progress / Uncommitted State

- None. DMG background fix and N52 results committed and pushed (2026-11-02); GROGU recheck requested.

## Next Immediate Step

1. Owner reviews the art in the app (Day theme toolbar, Home, About).
2. GROGU: rebuild the DMG and recheck icon positions; Jared checks the Dock and Cmd+Tab icon. Windows: build the NSIS installer (`npx tauri build`) and run N52.
3. File-type icons need a custom NSIS template and an `Info.plist` entry if the owner wants them.
