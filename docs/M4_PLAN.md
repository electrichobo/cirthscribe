# Milestone 4 plan: production analysis and stripboard

Status: **proposed, 2026-10-28.** Builds on M1–M3 (M3 closed by the owner 2026-10-28). ROADMAP's M4 exit: each report works independently; manual schedule data survives script changes; charts and reports agree on the selected scope. Acceptance section E (reports and stripboards) is the test, with B6 carried from M3.

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
2. **Report exports.** Each report on its own: CSV and TSV (quoted, UTF-8, formula-safe), XLSX (one sheet per report, numbers as numbers, written with the approved `zip` crate), HTML, PDF and RTF. Google Sheets and Docs results go in docs/COMPATIBILITY.md from real tests.
3. **Breakdown tags.** Categories: cast, extras, props, costume, vehicles, sound, VFX/SFX, stunts, makeup, set dressing, and the writer's own. A tag marks exact text (decision B) and points at a bible entry, so "the red ledger" and "the ledger" can be one prop. Suggested tags (bible names and aliases found in action text) are shown for the writer to accept or reject, never applied by themselves. Bible kinds grow to include props and the other categories.
4. **Tag reports and character participation.** One report per category: occurrences and distinct scenes kept apart (E2), each row linked to its scenes (E1). Characters: speaking scenes, present-but-silent scenes (from cast tags), dialogue words and share, and an estimated participation time by a documented method, labelled as an estimate and never "screen time" (E6, E7).
5. **Stripboard and schedule.** A vertical strip per scene: number, INT/EXT, location, time of day, a short description, characters, eighths, tags as configured. Its own schedule order (dragging strips never moves the script), day breaks, banners, an unscheduled pile, notes, sorting and a colour legend (with names). Script edits refresh strip fields and keep the schedule and notes (E3); an omitted or deleted scene's strip is flagged, not erased (E4). Exports: PDF and HTML (no clipped text, readable legend and headers, E9), XLSX and CSV.
6. **Character sides.** For one or more characters, a PDF of the scenes they are in: their scenes only, or full pages with the other scenes struck through. Locked scene numbers and page labels are kept; a dual-dialogue pair stays whole. Built on the production PDF.
7. **Compatibility checks.** Report and stripboard files in Google Sheets, Excel and LibreOffice; report PDFs and HTML in a browser; results labelled from real tests.

The exit review comes after 7. Steps 2 and 3 can swap if tags matter more to you than exports.

## Carried into M4 (not blockers for starting)

- From M3: the Mac run (N31), manual checks N29 and N30, the known limits in docs/m3/EXIT_REVIEW.md, B6 (built into step 1 here), C5 (M5).
- From M2: external app results, the Mac recheck of compat pack v2, manual checks N20–N28, non-Latin PDF glyphs.
- From M1: Linux desktop latency, reference machines, defect 3; Windows e2e on the hosted runner.

## Decisions needed

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
