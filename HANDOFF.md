# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-11-03.

## Current Milestone & Goal

**0.8.2** (owner, 2026-11-03): all of the owner's notes in `docs/0.8.2_PLAN.md` (sections A–C), plus the 0.8.1 known issues. Linux builds held back until Windows and macOS are further along (owner, 2026-11-03). 0.8.1 RC Alpha is tagged (`v0.8.1`); its GitHub release is the owner's step.

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
- **0.8.2 release prep (2026-11-03, committed, tagged v0.8.2):** version 0.8.2 (Cargo workspace, `app/package.json`, lockfiles); README (0.8.2 note, file names, new names, PDF import limit); STATUS.md entry. Verified: core 204 pass, app 2/2, CDP 92/92, WebDriver 91/92 (1 skipped IME), contract 4/4, notices 394. Windows installer `target/release/bundle/nsis/Kolbítar_0.8.2_x64-setup.exe` (17.35 MiB, SHA-256 dfe27392…5201a). Not yet: DMG on GROGU, GitHub release (owner).
- **0.8.2 PDF import (2026-11-03, committed):** `pdf-extract` 0.12.1 approved and added (LICENSES.md, notices 394); `crates/cirth-core/src/pdf_import.rs` (best-guess elements from page position, report); `import_pdf` command; `importerFor`/`importAny`/open-file take `.pdf`; ToUnicode fix in `pdf::fix_to_unicode` (export) and `repair_to_unicode` (import). Verified: core tests 204 pass (new unit and round-trip tests), clippy clean for the new code; e2e "PDF import" and the menu test pass on CDP and WebDriver. Full suites after it: CDP 92/92, WebDriver 91/92 (1 skipped IME), contract 4/4, notices check passes. Manual check N59 (PDFs from other apps).
- **0.8.1 known issue, Arabic gap in PDFs (2026-11-03, committed):** `pdf::fit` widens narrow shaped text up to 12% and centres it in its columns; unit test; `cargo test -p cirth-core` 197 pass. Not checked by eye (no PDF renderer on VADER; manual check N58).
- **0.8.2 section C, Notecard View redesign (2026-11-03, committed):** storylines (schema v18, `model::Storyline`, `PutStoryline`/`DeleteStoryline`/`RestoreStoryline` planning ops, `project_outline`; frozen `schema-v17-*.cirth` + upgrade test; snapshot/branch table lists); Notecard View toolset, card colours, act columns, storyline grid, season view (`views.ts`), pop-out board wired; contract fixture has `storyline`; manual check N57. Verified: core tests 196 pass, app tests 2/2, contract 4/4, CDP 91/91. WebDriver: the first full run failed five late tests in a row (from "Export Capability Analysis" on: "no project open", then the editor never opened); that test passed alone and a second full run passed 90/91 (1 skipped IME). Not reproduced; watch for it.
- **0.8.2 section C, Cork Board canvas (2026-11-03, committed):** `app/src/evidence.ts` rewritten as a free canvas (tools, pin-drag strings, curved strings you can click, double-click notes, pan, zoom, Fit); Cork Board CSS; e2e extended; manual checks N55 (canvas) and N56 (Feedback window). No core change. Verified: build, full CDP 90/90 and WebDriver 89/90 (1 skipped IME), contract 4/4; the board test again on both drivers after the last placement fix.
- **0.8.2 section C, Feedback pop-out (2026-11-03, committed):** Feedback in its own window (`panels.ts` feedback panel, `feedbackWrite`/`jumpBlock` commands, `panelwin.ts` `drawFeedback`, Tools menu item); writes go through `opts.write` in `comments.ts`; Feedback dialog overlay styling (it drew unstyled below the status bar). Verified: tsc, build, CDP 90/90, WebDriver 89/90 (1 skipped IME). Not checked by eye: the popped window itself.
- **0.8.2 section C, part 1 (2026-11-03, committed):** stripboard vertical and compact views; timeline Line view with a playhead; Feedback kinds (schema v17, frozen v16 files), margin icons with a pop-up, right-click Add Feedback/Suggestion/Note; three 0.8.1 known issues fixed.
- **0.8.2 section B built (2026-11-03, committed):** StoryScry pop-out and Thoughts pop-out button; Thoughts rich text (`thoughts.ts`, light markup); Home card menu (rename, picture, export, backups) with `home.json`/`covers/`, and sorting; title page and header/footer previews (`page_preview`, `pagepreview.ts`); runtime rail (`runtime.ts`); writing sprints (`sprint.ts`); Branches in plain words, delete asks first. Verified: core tests, app tests 2/2, contract 4/4, notices 371, CDP 90/90, WebDriver 89/90 (1 skipped IME).
- **0.8.2 section A built (2026-11-03, committed 212bf52):** tour rebuilt (theme colours, 10 cards, icon art); Tools and Go To top-level menus; Go To Anything fixes; renames (Feedback, Cork Board, Notecard View, Thoughts); island Overview/StoryScry and a text-formatting panel; StoryScry Back; Home Import; About "The name" (wording awaiting owner); revision sets (Original White, delete + close-up, Lock Pages offer); tag colours; icons at 96 px. Details under "Built" in `docs/0.8.2_PLAN.md`. Verified: core tests pass (incl. new revision and tag-colour tests), contract 4/4, CDP 88/88, WebDriver 87/88 (1 skipped IME).
- **0.8.1 release prep:** version 0.8.1 (Cargo workspace, `app/package.json`, lockfile); public README (Download with unsigned-installer steps, How you can help via GitHub Issues, Known limits); README's stage checklist moved to STATUS.md. Owner checked N54 and the `.deb` icons (pass).
- **Earlier today:** owner art, dark icon set, document icons, Finder double-click (N52, N53 pass).
- **Not verified:** migration on a real old data folder; installer size with the 8.3 MB CJK font. Open: Home list blank on two macOS cold launches (not reproduced). Enter-miss under stress: not a blocker (owner).

## In-Progress / Uncommitted State

- None. PDF import committed.

## Next Immediate Step

1. All of 0.8.2 and the four 0.8.1 known issues are built and pushed (efb20cf). Owner's first look at N55–N59 passes (2026-11-03). Next: the 0.8.2 release steps for Windows and macOS (version bump, README, installers). Linux builds held back.
