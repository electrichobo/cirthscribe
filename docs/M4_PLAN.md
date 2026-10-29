# Milestone 4 plan: production analysis and stripboard

Status: **accepted by the owner, 2026-10-28**, with decisions A–E below (B: tags tracked as separate anchored records). Builds on M1–M3 (M3 closed by the owner 2026-10-28). ROADMAP's M4 exit: each report works independently; manual schedule data survives script changes; charts and reports agree on the selected scope. Acceptance section E (reports and stripboards) is the test, with B6 carried from M3.

## Starting point (what exists)

- **Per-scene data from the core:** page, length in eighths and speakers for every scene, computed from the page map after each pagination (`cirth_core::navigator`), and for every script in the project when asked.
- **Characters:** speeches, words of dialogue, scenes and first appearance, with a bible entry's aliases counted under its name. Voice-over and off-screen cues count as speech; there is no "present but silent" yet.
- **Project bible:** characters, locations and world entries with aliases (no props or other categories yet).
- **Structure:** episodes and folders, locked scene numbers (omitted scenes kept), acts in the outline, the story timeline, revision sets with a changed-pages PDF.
- **Exports:** the production PDF (title page, numbers, headers, revision marks, locked pages) and DOCX, RTF, HTML, TXT, Fountain, FDX, each with a report of what it cannot keep. The approved `zip` crate already writes DOCX.
- **Not yet:** tags, any report, charts, a stripboard or schedule, sides, XLSX or CSV.

## Proposed order

Each step is a working, tested slice on both e2e drivers. Every report states its scope (which scripts, whether omitted scenes count) and the script version it was made from, and shows when it is out of date (B6). Charts and their tables come from the same rows (E8).

1. **Report engine and StoryScry, from data that exists now.**
   - Core `reports`: row data for each report, for a chosen scope (this script, chosen episodes, the project; omitted scenes in or out), stamped with the source version.
   - First reports: **Scenes** (one-liners: number, INT/EXT, location, time of day, page, eighths, speakers, the card's logline), **Characters** (speeches, words, share of dialogue, scenes speaking, first appearance), **Locations** (scenes, pages, first and last use), **Action vs dialogue** (words and lines, per scene and overall), **Interior vs exterior**, **Day vs night**, **Revisions** (changed pages and passages per set).
   - StoryScry (View > Tools): a dashboard of charts, one per report; each opens its full report, filterable and sortable, with a table view for every chart. Estimates are labelled; colour is never the only signal.
   - **Built 2026-10-28:**
     - `cirth_core::reports`: computes `ReportBundle` across any scope (`document`, selected `episodes`, or whole `project`; `include_omitted` off by default), stamped with `source_version` and `planning_version`. No schema change (still v10).
     - Seven initial reports: **Scenes** (number, omitted flag, INT/EXT, location, time of day, page, eighths [estimate], speakers with bible alias resolution, dual-dialogue pairs, linked beat card's logline), **Characters** (speeches, dual speeches, dialogue words, share of dialogue %, scenes speaking, first appearance), **Locations** (bible alias resolution, INT/EXT breakdown, scenes, eighths [estimate], first and last use), **Action vs dialogue** (words, lines and shares per scene and overall), **Interior vs exterior** (`INT.`, `EXT.`, `INT./EXT.`, `Other`), **Day vs night** (time-of-day buckets), and **Revisions** (changed pages, page labels and revised passages per set). When `include_omitted` is on, omitted scenes are laid out to measure their actual eighths, words, lines and speakers while keeping their `omitted` flag.
     - View > Tools > StoryScry… (`app/src/storyscry.ts`): dashboard of original SVG charts (Nightingale/polar area, bullet, dot plot, bar; no charting library), a "Show charts as tables" toggle built from the exact same report rows (E8), and full sortable/filterable report tables with click-to-jump scene buttons. Every Nightingale slice carries a distinct stroke dash pattern and every legend item pairs a symbol (`●`, `■`, `◆`, `▲`, `▼`, `★`) with text so colour is never the only signal; page and eighth lengths are labelled as estimates.
     - Live staleness detection (B6): if the script or planning data changes while StoryScry is open, a status banner flags the report out of date with the `vN` version it was made from and a Refresh button.
     - Tests: core unit tests (`reports::tests`, 5 tests) and store integration test (`reports_from_store_stamp_version_and_respect_scope_and_omitted_scenes`); e2e "StoryScry (B6, E6–E8)" and "Menus" on both CDP and WebDriver; dashboard layout verified via `out/screens-cdp/storyscry-dashboard.png`.
2. **Report exports.** Each report on its own: CSV and TSV (quoted, UTF-8, formula-safe), XLSX (one sheet per report, numbers as numbers, written with the approved `zip` crate), HTML, PDF and RTF. Google Sheets and Docs results go in docs/COMPATIBILITY.md from real tests.
   - **Built 2026-10-28:**
     - `cirth_core::report_export`: exports any single report (`scenes`, `characters`, `locations`, `action_dialogue`, `int_ext`, `day_night`, `revisions`) or all seven reports together (`all`) in CSV, TSV, XLSX, HTML, PDF and RTF.
     - Scope and provenance: every exported report states its `scope_label`, `source_version`, `planning_version`, and estimate notes (page and eighth lengths are estimates from the layout).
     - Tabular exports (CSV, TSV, XLSX): UTF-8, RFC 4180 quoting, formula-safe text cells (leading `=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`, while keeping negative numbers numeric), and dedicated columns for both human-readable scene numbers and stable source IDs (`document_id`, `scene_id`, `set_id`). XLSX writes OpenXML packages via the approved `zip` crate with fixed Unix 0644 permissions and timestamp for byte-identical output across OSes, and stores numeric/boolean columns as typed cells (`t="n"`, `t="b"`).
     - Document exports (HTML, PDF, RTF): HTML with print rules (`thead { display: table-header-group }`), RTF with bordered tables, and PDF paginated in Courier Prime 12 pt by the core with wrapped columns and repeated table headers on page breaks so no cell text is clipped (E9).
     - UI (`app/src/storyscry.ts`, `app/src/exportdlg.ts`): report and format selectors plus `Export…` button in StoryScry (switching tabs selects that report automatically), and `Reports (StoryScry)…` in `File > Export…`.
     - Tests: core unit tests (`report_export::tests`, 3 tests) and e2e test `"Report exports (E1, E8, E9)"` on both CDP and WebDriver. External spreadsheet/doc app checks are recorded as pending in `docs/COMPATIBILITY.md` and `docs/testing/MANUAL_CHECKS.md` (N33, step 7).
3. **Breakdown tags.** Categories: cast, extras, props, costume, vehicles, sound, VFX/SFX, stunts, makeup, set dressing, and the writer's own. A tag is a record of the exact text it covers (block id and offsets, decision B), carried through every edit, and points at a bible entry, so "the red ledger" and "the ledger" can be one prop. Suggested tags (bible names and aliases found in action text) are shown for the writer to accept or reject, never applied by themselves. Bible kinds grow to include props and the other categories.
4. **Tag reports and character participation.** One report per category: occurrences and distinct scenes kept apart (E2), each row linked to its scenes (E1). Characters: speaking scenes, present-but-silent scenes (from cast tags), dialogue words and share, and an estimated participation time by a documented method, labelled as an estimate and never "screen time" (E6, E7).
5. **Stripboard and schedule.** A vertical strip per scene: number, INT/EXT, location, time of day, a short description, characters, eighths, tags as configured. Its own schedule order (dragging strips never moves the script), day breaks, banners, an unscheduled pile, notes, sorting and a colour legend (with names). Script edits refresh strip fields and keep the schedule and notes (E3); an omitted or deleted scene's strip is flagged, not erased (E4). Exports: PDF and HTML (no clipped text, readable legend and headers, E9), XLSX and CSV.
6. **Character sides.** For one or more characters, a PDF of the scenes they are in: their scenes only, or full pages with the other scenes struck through. Locked scene numbers and page labels are kept; a dual-dialogue pair stays whole. Built on the production PDF.
7. **Compatibility checks.** Report and stripboard files in Google Sheets, Excel and LibreOffice; report PDFs and HTML in a browser; results labelled from real tests.

The exit review comes after 7. Steps 2 and 3 can swap if tags matter more to you than exports.

## Carried into M4 (not blockers for starting)

- From M3: the Mac run (N31), manual checks N29 and N30, the known limits in docs/m3/EXIT_REVIEW.md, B6 (built into step 1 here), C5 (M5).
- From M2: external app results, the Mac recheck of compat pack v2, manual checks N20–N28, non-Latin PDF glyphs.
- From M1: Linux desktop latency, reference machines, defect 3; Windows e2e on the hosted runner.

## Decisions (owner, 2026-10-28)

- **A. Charts:** original SVG charts written for Kolbítar (option 1). No dependency.
- **B. Tags are tracked as separate records** (option 2): each tag stores the block id and character offsets of its text, with the quoted text for recovery, and is mapped through every edit (ARCHITECTURE section 5: offsets in Unicode scalar values at the core boundary, insertion affinity, behaviour on split, join, cut and paste, scene moves and omitted scenes). The same anchors will serve comments in M5. Step 3 starts with an ADR for the anchor design, and a tag whose text is deleted becomes an orphan to review, never silently dropped.
- **C. Report PDFs and RTF** are written by the core (no new dependency).
- **D.** E5 (inactive alternatives) and the branch part of E8 wait for M5; M4's scope is scripts and episodes.
- **E. Order:** reports first, then tags, as proposed.
- **Dependencies:** none expected.

The questions as asked:

- **A. Charts.**
  - (1) Original SVG charts written for Kolbítar: Nightingale (polar area), bullet, dot plot, bar and line. No dependency; they follow the themes and high contrast, and every chart has its table. **Proposed.**
  - (2) A charting library (for example a JavaScript one): faster for many chart types, but a new dependency to approve and licence-check, and harder to make follow the themes.
- **B. How a tag holds its text.**
  - (1) As a mark on the text itself, like revision marks: it moves with the words through edits, cut and paste and scene moves, and needs no separate anchor bookkeeping. Exports that cannot show tags leave them out and say so. **Proposed.**
  - (2) As a separate record of block and character offsets, mapped through every edit (ARCHITECTURE section 5). Needed later for comments (M5); more code and more ways to drift now.
- **C. Report PDFs and RTF:** written by the core as the production PDF is (no new dependency). Proposed yes.
- **D. Items that need later milestones:** E5 (inactive alternatives) and the "branch" part of E8 wait for M5's alternatives and branches; M4 states the scope as scripts and episodes. Proposed: agree to defer them.
- **E. Order:** reports first (they work on data that exists today), then tags, as proposed; or tags first.
- **Dependencies:** none expected (XLSX with the approved `zip`; charts as SVG). Anything that turns out to need a crate or package comes back to you first.
