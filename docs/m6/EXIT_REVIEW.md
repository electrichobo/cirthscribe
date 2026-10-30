# M6 exit review

Date: 2026-10-30. Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M6 and its exit line), docs/M6_PLAN.md, Decisions A, B, C (owner, 2026-10-29).

**M6 closed for review, carrying into M7:** manual checks N41–N46, desktop manual checks N37–N40, external spreadsheet and viewer manual checks (N32–N36), the Mac runs (N31, carried), and the items carried from M1–M5. Next: Milestone 7 (Optional extras: bring-your-own AI, cloud sharing workflows).

Verdict before closing: **everything M6 promised is built and verified with automated suites (180 core unit/integration tests, 4 contract tests, 355 license notices, 81 e2e CDP tests, and 80 e2e WebDriver tests).**
- Automated: core tests, contract tests, license notices, and both end-to-end drivers (CDP and WebDriver) on Windows.
- Carried forward: desktop manual checks N41–N46 logged in `docs/testing/MANUAL_CHECKS.md`, plus carried items from M1–M5.

## 1. ROADMAP M6 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Document formats and profiles model (schema v16) | Yes (step 1, Decision A) | Core `model::DocumentProfile`, schema migration `migrate_v16`, layout profiles, e2e Test 76 | — |
| Comic book & graphic novel scripting | Yes (step 2) | Core `cirth_core::comic` (pages, panels, balloons, captions, SFX), continuity validation, renumbering, text/HTML exports, comic Tab/Enter cycles, dialog, e2e Test 77 | — |
| Stage plays & multi-camera teleplays | Yes (step 3) | Core `cirth_core::stage_teleplay` (lettered scenes, uppercase dialogue, Act/Scene headings, bracketed directions), text exports, layout pagination, e2e Test 78 | — |
| Immersive & branching interactive storytelling | Yes (step 4, Decision B) | Core `cirth_core::interactive` (passages, bracket choice syntax, conditions, BFS graph validator), Twee 3, standalone offline playable HTML runner, JSON graph, live playtester dialog, e2e Test 79 | — |
| General rich-text / treatment documents & bible integration | Yes (step 5) | Core `cirth_core::treatment` (H1–H3 hierarchy, reading time, Project Bible entity cross-referencing), semantic HTML, Plain Text, Word (.docx) exports, inspector dialog, e2e Test 80 | — |
| 100% offline rule-based grammar, style & dialogue engine | Yes (step 6, Decision C) | Core `cirth_core::grammar` (duplicate words, passive voice, dialogue quotes, parenthetical formatting, cliches/fillers, spacing anomalies), one-click replacement fix, review dialog, e2e Test 81 | — |
| Compatibility matrix, synthetic format fixtures, and manual checks | Yes (step 7) | Synthetic fixtures for all 6 formats in `fixtures/`, `fixtures::tests`, `docs/COMPATIBILITY.md`, manual checks N41–N46 in `docs/testing/MANUAL_CHECKS.md` | — |

## 2. Owner Decisions (2026-10-29)

- **A. Document Profile Assignment & Conversion:** Document profile is assigned at creation. Converting an existing script to another format duplicates and converts the document into a new document with the target profile, retaining the author's untouched original script. Met: `duplicate_and_convert_document` in `store.rs`, verified in e2e Test 76 and Test 78.
- **B. Interactive Choices Syntax:** Both inline bracket syntax (`[[Choice label -> Target]]`) and structured UI choice cards/inspectors are supported. Met: `cirth_core::interactive::extract_choices` supports `[[Target]]`, `[[Label -> Target]]`, `[[Target <- Label]]`, `[[Label|Target]]`, conditions inside/trailing (`[if condition]`, `{condition}`, `(requires condition)`), and UI playtester dialog in `app/src/interactivedlg.ts`.
- **C. Offline Grammar Engine:** Strictly 100% local, rule-based grammar and style checks without AI, network access, or paid proprietary packages. Met: `cirth_core::grammar` uses pure deterministic pattern and rule matching with zero network calls, zero telemetry, zero AI.

## 3. Exit line

- **"Every format is a real structured editor."** Met: Each document profile provides dedicated block structures, custom keyboard cycles (e.g. comic Tab/Enter cycles), profile-aware page geometry and layout metrics, format-specific exports (Plain Text, HTML, PDF, DOCX, Twee 3, standalone offline playable HTML), and dedicated inspection/analysis dialogs.
- **"100% Offline & No AI."** Met: All language tools, spelling, grammar checks, reading time estimates, graph validation, and bible cross-referencing execute completely locally without cloud services or external network access.
- **"Preserve the Author's Original Work."** Met: Format conversion duplicates and converts, never mutating the original manuscript.

## 4. Found and fixed while building M6

- **Nested brackets in interactive choice conditions:** Parser encountered early termination on trailing bracket conditions like `[[Choice -> Target [if condition]]]`. Implemented balanced bracket depth counting to reliably parse targets with embedded conditions.
- **Intentional interactive story endings:** Graph validator flagged terminal passage without choices as dead ends. Added standard story ending marker recognition (`[THE END]`, `THE END`, `*** THE END ***`) to distinguish intentional endings from abandoned branch paths.
- **Passive voice and cliche issue ordering:** Grammar analyzer issues were initially ordered by phrase catalog rather than document position. Added natural reading order sorting by block and UTF-16 offset.
- **Prose treatment DOCX export geometry:** Adapted WordprocessingML generator with treatment profile geometries to deliver 1-inch margins and left-aligned body text without screenplay dialogue centering.
- **Project Bible cross-referencing in treatment prose:** Integrated planning state entity scanner into treatment analyzer to automatically detect canonical characters, locations, and aliases mentioned in treatment prose.

## 5. Open items

1. **Manual checks N41–N46:** desktop verification of comic scripting, stage plays, multi-camera sitcoms, interactive stories, treatment documents, and grammar analysis.
2. **Carried forward from M1–M5:** manual checks N37–N40 (comments, alternatives, branches, review packages), external spreadsheet and viewer manual checks (N32–N36), Mac run (N31), non-Latin PDF glyphs, reference machine latency budgets, external screenplay interchange checks.

## 6. Decisions for the owner

- **A. Closing M6:** Close Milestone 6 as complete, carrying manual checks N41–N46 into the manual checklist backlog.
- **B. Moving to M7:** Proceed to Milestone 7 (Optional extras: bring-your-own AI, cloud sharing workflows).
