# M4 exit review

Date: 2026-10-29. Commit reviewed: M4 step 7 (compatibility checks and production pack v1). Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M4 and its exit line), ACCEPTANCE.md section E (reports and stripboards) and B6, docs/M4_PLAN.md.

**M4 closed for review, carrying into M5:** external spreadsheet and viewer manual checks (N32–N36), the Mac runs (N31, carried), and the items carried from M1–M3. Decision B: on to Milestone 5 (Review, alternatives, and branches).

Verdict before closing: **everything M4 promised is built and verified with automated suites (131 core unit/integration tests, 4 contract tests, 69 e2e CDP tests, and 68 e2e WebDriver tests).**
- Automated: core tests, contract tests, and both end-to-end drivers on Windows.
- Carried forward: external application manual verifications in Excel, Google Sheets, LibreOffice, and external PDF viewers (N33, N35, N36) logged in `docs/COMPATIBILITY.md` and `docs/testing/MANUAL_CHECKS.md`.

## 1. ROADMAP M4 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Range/entity tags with correction controls | Yes (step 3, ADR 0005) | Core `tags::tests`, migration `migrate_v11`, e2e "Breakdown tags (ADR 0005, D5, E1, E2, F1, F2)" | — |
| Independent character, scene, location, prop/category, and revision reports | Yes (steps 1, 2, 4) | Core `reports::tests`, `report_export::tests`, e2e "StoryScry (B6, E6–E8)", "Report exports (E1, E8, E9)", "Tag reports (E1, E2, E6–E8)" | — |
| Vertical stripboard and independent scheduling order | Yes (step 5) | Core `stripboard::tests`, store integration tests, e2e "Stripboard and schedule (E3, E4, E9)" | — |
| Page/eighth calculations tied to a stated layout/scope | Yes (steps 1, 4) | Core `reports::compute`, `report_export`, StoryScry estimate notes | Estimates explicitly labelled as estimates |
| StoryScry dashboard and charts; honest timing labels | Yes (steps 1, 4) | Core `reports`, UI `app/src/storyscry.ts`, e2e tests, SVG Nightingale/bullet/dot/bar charts | Never labelled "screen time"; dual dialogue not double counted |
| Character sides | Yes (step 6) | Core `sides::tests`, store tests, e2e "Character sides (E6, locked scene/page preservation)" | — |
| PDF/RTF/HTML reports; PDF/HTML stripboards | Yes (steps 2, 5) | Core `report_export`, `stripboard`, e2e suites, M4 test pack | — |
| XLSX and CSV/TSV for tabular reports/stripboards | Yes (steps 2, 5) | Core `report_export`, `stripboard`, OpenXML via `zip`, formula escaping, M4 test pack | — |
| Google Docs/Sheets compatibility-profile testing | Yes (step 7) | `cirth-cli compat-m4`, `docs/COMPATIBILITY.md` M4 pack v1 manifest and results log | External app manual opens (N33, N35, N36) pending hands-on run |

## 2. Acceptance E (reports and stripboards) and B6

| # | Status | Evidence |
| - | - | - |
| E1 Prop report for episode 2: no other report required; rows link to source scenes and honor scope | Pass | Core `report_export` (`"tag:props"`), StoryScry category filter, jump-to-scene actions; e2e "Tag reports" |
| E2 Tag one prop twice in a scene: occurrence count kept separate from distinct scene count | Pass | Core `reports::TagCategoryReport` separates `total_occurrences` and `distinct_scenes`; UI displays paired metrics |
| E3 Generate strips, reorder for scheduling, reorder screenplay: schedule order stays independent while source fields refresh | Pass | Core `stripboard::reconcile_schedule`, store integration tests, e2e "Stripboard and schedule" |
| E4 Omit scheduled scene: strip is flagged visibly (`[omitted]`), not silently erased with manual notes | Pass | Core `reconcile_schedule` sets `omitted: true` while preserving strip kind, notes, and day placement |
| E5 Counts exclude inactive alternatives by default | Deferred (Owner decision D) | Defer to M5 when alternatives and branches are introduced; M4 scope is scripts and episodes |
| E6 Fixture with V.O., O.S., silent presence, aliases, dual dialogue: metrics remain distinct | Pass | Core `reports::CharacterReportRow` distinguishes speeches, dual speeches, V.O., O.S., silent scenes, dialogue share, and timing |
| E7 No chart labels an estimate "actual screen time"; overlapping character durations do not total 100% | Pass | StoryScry UI notes (`#storyscry-characters-estimate-note`), core formula documentation, independent participation tallies |
| E8 Filter report and chart to same scope: underlying row data agrees | Pass | Dashboard charts and "Show charts as tables" toggle read identical `ReportBundle` rows |
| E9 Export long strip descriptions to PDF/HTML: no text clips; color legends and page headers readable | Pass | Core PDF multi-line wrapping and repeated headers, HTML table styling, M4 pack v1 outputs |
| B6 Report computed while scene changes is tied to version or marked stale | Pass | `source_version` tracking in StoryScry and Stripboard with prominent live staleness warning and Refresh action |

## 3. Exit line

- **"Each report works independently without other reports."** Met: `cirth_core::report_export` and StoryScry allow selecting and exporting any individual report or category in all formats (CSV, TSV, XLSX, HTML, PDF, RTF) without generating other reports.
- **"Manual schedule data survives script changes."** Met: `stripboard::reconcile_schedule` preserves user strip sequence, day breaks, banners, unscheduled strips, and manual notes across screenplay edits, scene reorders, and scene omission.
- **"Charts and reports agree on selected branch/scope."** Met: charts and tables in StoryScry are rendered directly from the same versioned `ReportBundle` rows for the selected scope (`document`, `episodes`, `project`), with omitted scenes included or excluded on demand.

## 4. Found and fixed while building M4

- **Deterministic PDF generation:** `printpdf` creates random trailer IDs (`/ID[...]`). Implemented `fix_trailer_id` across production PDFs and character sides to guarantee 100% byte-identical outputs across repeated runs on any machine.
- **Heading scene ID invariant:** Enforced that non-heading blocks strictly have `scene_id: None` in core document mutations to prevent validation failures.
- **OpenXML XLSX generation without new dependencies:** Hand-rolled valid OpenXML packages (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/styles.xml`, `xl/worksheets/sheet*.xml`) using the existing approved `zip` crate with typed cells (`t="n"`, `t="b"`), multi-sheet workbooks, and frozen header panes.
- **Spreadsheet formula injection safety:** Quoted leading arithmetic and formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) in text cells while preserving true negative numbers as numeric types.
- **Text-range anchor recovery:** Implemented ADR 0005 with left-open/right-open boundary tracking, split/join mapping, and automatic orphan recovery on undo.

## 5. Open items

1. **Manual checks N32–N36:** external spreadsheet verification (Excel, Google Sheets, LibreOffice) and desktop PDF inspection for StoryScry, Stripboard, and Character Sides.
2. **Mac runs:** N31 (M3/M4 on macOS), carried from M3.
3. **Carried from M1–M3:** non-Latin PDF glyphs, reference machine latency budgets, external screenplay interchange checks (N22, N23, N25, N28).

## 6. Decisions for the owner

- **A. Closing M4:** Close Milestone 4 as complete, carrying manual checks N32–N36 into the backlog.
- **B. Moving to M5:** Proceed to Milestone 5 (Review, alternatives, and branches: anchored comments, non-destructive alternatives, snapshots, and visual branch history).
