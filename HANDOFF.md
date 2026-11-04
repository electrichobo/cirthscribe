# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-31.

## Current Milestone & Goal

**0.8.2** (owner, 2026-11-03): all of the owner's notes in `docs/0.8.2_PLAN.md` (sections A–C), plus Linux builds and the 0.8.1 known issues. 0.8.1 RC Alpha is tagged (`v0.8.1`); its GitHub release is the owner's step.

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
- **0.8.2 section C, part 1 (2026-11-03, committed):** stripboard vertical and compact views; timeline Line view with a playhead; Feedback kinds (schema v17, frozen v16 files), margin icons with a pop-up, right-click Add Feedback/Suggestion/Note; three 0.8.1 known issues fixed.
- **0.8.2 section B built (2026-11-03, committed):** StoryScry pop-out and Thoughts pop-out button; Thoughts rich text (`thoughts.ts`, light markup); Home card menu (rename, picture, export, backups) with `home.json`/`covers/`, and sorting; title page and header/footer previews (`page_preview`, `pagepreview.ts`); runtime rail (`runtime.ts`); writing sprints (`sprint.ts`); Branches in plain words, delete asks first. Verified: core tests, app tests 2/2, contract 4/4, notices 371, CDP 90/90, WebDriver 89/90 (1 skipped IME).
- **0.8.2 section A built (2026-11-03, committed 212bf52):** tour rebuilt (theme colours, 10 cards, icon art); Tools and Go To top-level menus; Go To Anything fixes; renames (Feedback, Cork Board, Notecard View, Thoughts); island Overview/StoryScry and a text-formatting panel; StoryScry Back; Home Import; About "The name" (wording awaiting owner); revision sets (Original White, delete + close-up, Lock Pages offer); tag colours; icons at 96 px. Details under "Built" in `docs/0.8.2_PLAN.md`. Verified: core tests pass (incl. new revision and tag-colour tests), contract 4/4, CDP 88/88, WebDriver 87/88 (1 skipped IME).
- **0.8.1 release prep:** version 0.8.1 (Cargo workspace, `app/package.json`, lockfile); public README (Download with unsigned-installer steps, How you can help via GitHub Issues, Known limits); README's stage checklist moved to STATUS.md. Owner checked N54 and the `.deb` icons (pass).
- **Earlier today:** owner art, dark icon set, document icons, Finder double-click (N52, N53 pass).
- **Not verified:** migration on a real old data folder; installer size with the 8.3 MB CJK font. Open: Home list blank on two macOS cold launches (not reproduced). Enter-miss under stress: not a blocker (owner).

## In-Progress / Uncommitted State

- None. Section C part 1 committed and pushed (2026-11-03).

## Next Immediate Step

1. Section C: Feedback window pop-out; Cork Board canvas; Notecard View redesign, PDF import, 0.8.1 known issues, Linux build.
