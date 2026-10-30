# Milestone 6 Plan: Additional Formats and Language Tools

Accepted 2026-10-29.

Milestone 6 expands Kolbítar from single-camera US feature screenplays into a versatile writing suite supporting television formats (single-camera and multi-camera sitcoms), UK screenplay and radio profiles, theatrical stage plays, comic books and graphic novels, interactive branching stories, general rich-text treatments, and offline grammar and style analysis.

## Core Rules for Milestone 6

- **Every format is a real structured editor:** A label in a template menu does not count as support (`ROADMAP.md` M6). Each format has its own block types, indentation/spacing rules, page layout, and dedicated exports.
- **100% Offline & No AI:** Grammar, style, and dialogue analysis engines run strictly on local, deterministic rule-based logic using bundled open dictionaries. Zero network calls, zero telemetry, zero generative AI.
- **Shared Canonical Universe:** Different document formats (e.g. pilot screenplay, series bible treatment, comic spinoff, branching episode) live within the same `.cirth` project tree and share the canonical Bible, character profiles, locations, and breakdown tags.
- **Preserve the Author's Original Work:** Document profiles are set at creation. Converting an existing script to a different format duplicates and converts the document, retaining the untouched original script.

## Steps

1. **Document Formats & Profiles Model (Schema v16 & Layout Engine Extensions).**
   - Define `DocumentProfile` enum in `cirth_core::model`:
     - `ScreenplayUs` (standard US feature screenplay, Courier Prime 12pt, US Letter default).
     - `ScreenplayUk` (UK/BBC screenplay: A4 default, tailored margins and capitalization rules).
     - `TeleplayMultiCam` (TV multi-camera sitcom: double-spaced dialogue, uppercase dialogue text, centered cues, scene letters).
     - `StagePlay` (standard theatrical format: Dramatists Guild style; centered character names, indented dialogue, italicized directions).
     - `ComicScript` (graphic novels and comics: Page and Panel hierarchy, speech balloons, captions, SFX).
     - `InteractiveStory` (immersive branching storytelling: passages, choices, conditions).
     - `TreatmentProse` (rich-text treatments, pitch bibles, synopses: headings, paragraphs, lists, quotes).
   - Migration `migrate_v16`: Add `format_profile` column to `documents` table in SQLite with safe defaults for existing v1–v15 projects.
   - Core layout engine extensions (`cirth_core::layout`): Support profile-specific page dimensions, margins, character indents, and line-heights.
   - Core unit tests verifying profile parsing, migrations, and layout metrics.
   - **Built 2026-10-29:** `cirth_core::model::DocumentProfile` enum (`ScreenplayUs`, `ScreenplayUk`, `TeleplayMultiCam`, `StagePlay`, `ComicScript`, `InteractiveStory`, `TreatmentProse`) with case-insensitive parsing, aliases, and default page size bindings; schema migration `migrate_v16` adding `format_profile` column to `documents` table with frozen `schema-v15-*.cirth` upgrade tests; layout engine profile support in `cirth_core::layout::Profile` providing distinct geometry measurements for each profile; 3 Tauri IPC commands (`create_document_with_profile`, `get_document_profile`, `duplicate_and_convert_document`) implementing Decision A (profile set at creation, duplicate-and-convert retains original script); automated tests in core (145/145), contract, notices, and e2e (`suite.mjs` Test 76) passing on both CDP (76/76) and WebDriver (75/75, 1 skipped) drivers.

2. **Comic Book & Graphic Novel Scripting.**
   - Data model & block types: `PageHeading` (e.g. `PAGE ONE (4 Panels)`), `PanelHeading` (`PANEL 1`), `PanelDescription`, `Character` / `Balloon`, `Caption`, and `Sfx`.
   - Automatic panel counting per page and renumbering validation.
   - Tab/Enter cycles tailored for comic book writing.
   - Format-specific PDF, Plain Text, and HTML exports.
   - **Built 2026-10-29:** `crates/cirth-core/src/comic.rs` with `parse_comic_script`, `renumber_comic_panels`, `export_comic_text`, and `export_comic_html`; comic Tab/Enter keyboard cycles in `app/src/keys.ts` (`comicKeyConfig`); comic dialog in `app/src/comicdlg.ts` with 6 metric summary cards, continuity warning list, panel renumbering, and text/HTML exports; Tauri IPC commands `comic_analyze`, `comic_renumber`, `comic_export_text`, and `comic_export_html`; automated E2E Test 77 in `app/tests/e2e/suite.mjs` verifying panel sequencing, continuity warnings, renumbering reconciliation, format exports, and dialog interactions passing on CDP (77/77) and WebDriver (76/76, 1 skipped) drivers.

3. **Stage Play & TV Multi-Camera Profiles.**
   - Theatrical stage play profile: Act/Scene markers (`ACT I, SCENE 1`), centered character cues, indented dialogue, bracketed stage directions, cast lists.
   - Multi-cam sitcom profile: Double-spaced dialogue, uppercase dialogue text, centered character cues, scene letters (`SCENE A`).
   - Profile-specific PDF page rendering and text exports.
   - Duplicate & Convert action: Allows converting a screenplay into a stage play or teleplay as a new duplicate document, preserving the original.
   - **Built 2026-10-30:** `crates/cirth-core/src/stage_teleplay.rs` with `convert_to_teleplay_multicam` (`SCENE A` scene lettering, Unicode uppercase dialogue preserving runs), `convert_to_stageplay` (`ACT I, SCENE 1` headings, bracketed parentheticals), and text exports `export_teleplay_text` and `export_stageplay_text`; `duplicate_and_convert_document` in `crates/cirth-core/src/store.rs` converting blocks into target profiles while preserving original documents; IPC commands `export_stageplay_text` and `export_teleplay_text` in `app/src-tauri/src/main.rs`; profile-aware PDF pagination and text exports using `layout::Profile::for_document_profile`; automated E2E Test 78 in `app/tests/e2e/suite.mjs` verifying multi-cam and stage play conversions and text exports passing on both CDP (78/78) and WebDriver (77/77, 1 skipped) drivers.

4. **Immersive & Branching Interactive Storytelling.**
   - Data model in `cirth_core::interactive`: Passages with stable IDs, titles, body text, choices, and conditions.
   - Both inline bracket syntax (`[[Choice label -> TargetPassageID]]`) and structured UI choice cards/inspectors.
   - Graph integrity validator: Detects dangling choice references, dead-end passages, and unreachable orphan passages.
   - Exports: Twine/Twee 3 format (`.twee`), standalone self-contained playable interactive HTML runner, and JSON graph export.
   - **Built 2026-10-30:** `crates/cirth-core/src/interactive.rs` with `parse_interactive_script`, choice extraction (`[[Label -> Target]]`, `[[Target <- Label]]`, `[[Label|Target]]`, conditions inside/trailing), graph validation (`validate_graph` detecting dangling links, dead ends, unreachable passages via BFS), Twee 3 export (`export_twee`), standalone playable offline HTML export (`export_interactive_html`), and JSON graph export (`export_interactive_json`); Tauri IPC commands `interactive_analyze`, `interactive_export_twee`, `interactive_export_html`, `interactive_export_json`; interactive inspector and offline playtester dialog in `app/src/interactivedlg.ts`; automated E2E Test 79 in `app/tests/e2e/suite.mjs` passing on CDP (79/79) and WebDriver (78/78, 1 skipped) drivers.

5. **General Rich-Text / Treatment Documents & Bible Integration.**
   - Prose profile: Headings (H1–H3), body paragraphs, bullet/numbered lists, blockquotes.
   - Shared project bible: Unified character cues, locations, aliases, and tags shared across screenplay and treatment documents in the series tree.
   - Exports: Clean HTML, PDF, DOCX, and TXT for treatment and pitch bibles.
   - **Built 2026-10-30:** `crates/cirth-core/src/treatment.rs` with `parse_treatment_doc` (structural hierarchy H1–H3, paragraphs, quotes, bullet lists, character spotlights, word counts, reading time estimates), Project Bible cross-referencing (`matches_entity_name` scanning treatment prose against canonical characters, locations, and aliases), semantic HTML export (`export_treatment_html`), formatted Plain Text export (`export_treatment_text`), and WordprocessingML binary export (`export_treatment_docx`); Tauri IPC commands `treatment_analyze`, `treatment_export_html`, `treatment_export_text`, `treatment_export_docx`; Treatment & Pitch Bible Inspector dialog in `app/src/treatmentdlg.ts`; automated E2E Test 80 in `app/tests/e2e/suite.mjs` passing on CDP (80/80) and WebDriver (79/79, 1 skipped) drivers.

6. **Offline Grammar, Style & Dialogue Analysis Engine.**
   - Pure local, rule-based engine in `cirth_core::grammar`:
     - Passive voice detection.
     - Repeated duplicate words (`the the`).
     - Screenplay dialogue punctuation rules (dashes `--` vs ellipses `...`, unquoted speech in parentheticals).
     - Cliches and filler phrases.
     - Spacing and punctuation consistency.
   - User dictionary & project dictionary ignore rules.
   - Accessible UI review dialog with side-by-side issue preview, one-click fix/replace, and ignore actions.
   - 100% offline, deterministic, zero network requests, zero AI.

7. **Compatibility Matrix, Format Fixtures, Manual Checks & Exit Review.**
   - Original synthetic test fixtures for each format: UK screenplay, multi-cam sitcom, stage play, comic script, interactive branching story, series treatment.
   - Automated test verification: core tests, contract tests, license notices, CDP E2E suite, and WebDriver E2E suite.
   - Update `docs/COMPATIBILITY.md`, `docs/testing/MANUAL_CHECKS.md`, and author `docs/m6/EXIT_REVIEW.md`.

## Decisions (owner, 2026-10-29)

- **A. Document Profile Assignment & Conversion:** Document profile is set at creation. To change a document's profile, the user duplicates and converts the script into a new document with the target profile, retaining the untouched original document.
- **B. Interactive Choices Syntax:** Both inline bracket syntax (`[[Choice label -> Target]]`) and structured UI choice cards/inspectors are supported.
- **C. Offline Grammar Engine:** Strictly 100% local, rule-based grammar and style checks without AI, network access, or paid proprietary packages.
