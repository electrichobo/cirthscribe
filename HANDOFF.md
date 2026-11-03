# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-31.

## Current Milestone & Goal

**RC Alpha prep** (owner, 2026-11-02): an RC Alpha for a tester group, not 1.0. M0–M7 closed; owner art integrated and checked (N52, N53). Decisions in docs/DECISIONS.md ("Release stage", "Home samples", identifier, fonts).

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
- **Earlier today:** owner art, dark icon set, document icons, Finder double-click (N52, N53 pass).
- **Not verified:** N54 (non-Latin on screen and in PDFs by hand); Linux `.deb` icons; migration on a real old data folder; installer size with the 8.3 MB CJK font. Open: Home list blank on two macOS cold launches (not reproduced). Enter-miss under stress: not a blocker (owner).

## In-Progress / Uncommitted State

- None. RC Alpha prep committed and pushed (2026-11-02).

## Next Immediate Step

1. RC Alpha release: version number, GitHub release with installers, README rewritten as a public product README with "How can you help" and GitHub issues for bugs (milestones stay in STATUS and HANDOFF).
2. Testers run N54 and the open manual checks; results come back as GitHub issues.
