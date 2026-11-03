# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-31.

## Current Milestone & Goal

**0.8.1 RC Alpha** (owner, 2026-11-02): first test release for a tester group, not 1.0. Version set to 0.8.1; README is now the public product page; the milestone checklist moved to STATUS.md. Decisions in docs/DECISIONS.md ("Release stage", "Home samples", identifier, fonts).

## Completed & Verified

- **RC Alpha prep (2026-11-02):**
  - File > Export/Import Review Package… and palette entries (commands existed since M5 step 6, unreachable).
  - Island Comments button opens Comments (was a stale "not available yet" placeholder); e2e updated.
  - Home: one sample, The Obsidian Seal ("Untitled Fantasy Feature"), as a Projects-grid card; other fixtures test-only.
  - Identifier `org.kolbitar.app`; `migrate_data_dir` copies `org.cirthscribe.spike` on first launch (unit test). UTIs `org.kolbitar.cirth(-review)`. AGENTS.md updated.
  - Linux `.deb`: MIME XML, document icons, postinst/postrm (`app/src-tauri/linux/`). Not built (needs Linux).
  - Fonts: Noto Sans Hebrew, Arabic, Devanagari, SC (screen; `unicode-range`). PDF prints Hebrew/Arabic/Devanagari via rustybuzz + unicode-bidi (owner-approved): visual order per paragraph direction, shaped, squeezed to the layout's columns; fallbacks embedded only when used. CJK screen only (CFF outlines). Sample PDF checked by eye (`out/fontcheck/`).
  - Licences: OFL.txt per font, LICENSES.md, notices regenerated (371).
- **Verified 2026-11-02 (Windows):** `cargo test -p cirth-core` 192/192 (new PDF fallback test); `cargo test -p cirthscribe` 1/1; `npm run build`; release build; contract 4/4; offline audit passed; notices check (371); e2e CDP 88/88, WebDriver 87/88 (1 skipped IME).
- **0.8.1 release prep:** version 0.8.1 (Cargo workspace, `app/package.json`, lockfile); public README (Download with unsigned-installer steps, How you can help via GitHub Issues, Known limits); README's stage checklist moved to STATUS.md. Owner checked N54 and the `.deb` icons (pass).
- **Earlier today:** owner art, dark icon set, document icons, Finder double-click (N52, N53 pass).
- **Not verified:** migration on a real old data folder; installer size with the 8.3 MB CJK font. Open: Home list blank on two macOS cold launches (not reproduced). Enter-miss under stress: not a blocker (owner).

## In-Progress / Uncommitted State

- None. 0.8.1 committed, pushed and tagged `v0.8.1` (2026-11-02). Windows installer built locally (16.4 MiB); GROGU asked for the DMG.

## Next Immediate Step

1. Release builds: Windows NSIS here; macOS DMG on GROGU (aarch64); Linux `.deb` and AppImage on the Linux runner.
2. Publish the GitHub release "Kolbítar 0.8.1 RC Alpha" (pre-release) with the three builds and notes, only with the owner's go-ahead.
3. Testers report through GitHub Issues; transcribe manual check results into MANUAL_CHECKS.md.
