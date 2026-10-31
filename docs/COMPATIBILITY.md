# Compatibility matrix

M2 step 9. Every claim here comes from an actual test, with its date. Rules and statuses come from INTEROPERABILITY.md ("Compatibility record"). An export is never "compatible" in general, only within the profile and tests named here.

## How to test

1. Make the test pack: `cargo run -p cirth-core --bin cirth-cli -- compat-pack`. It writes every sample in every format to `out/compat-pack-v<N>/` with a `MANIFEST.md` of sizes and hashes. The same commit always makes the same files, on every OS (checked: see the log), so a result names its exact file.
2. Open a file in the external app. Check what the matching manual check lists:
   - PDF: N25;
   - Fountain: N22;
   - FDX: N23;
   - DOCX, RTF, HTML: N28.
3. Add a row to the results log:
   - date, format, app and version, OS;
   - pack version, commit and file hash;
   - what was kept and what was lost;
   - reviewer, and where the evidence is (screenshot, note).
4. Update the format's status.

## Status by format

Statuses: not implemented · implemented, unverified · verified within profile · partial with documented losses · unsupported.

| Format | Status | Profile / scope | Basis |
| - | - | - | - |
| .cirth (native) | Verified within profile | Kolbítar reopening its own projects, upgrades from schemas v1–v16; Unix atomic replacement with best-effort directory fsync for APFS/network mount resilience | Automated store, migration and crash tests on Windows, macOS and Linux CI |
| .pdf | Partial with documented losses | US Letter and A4, Courier Prime 12 pt | Preview (macOS) 2026-10-27, on pack v1. Fixed since, pending a recheck on pack v2: page size and metadata text. Known losses: no fallback font for characters Courier Prime lacks. No industry comparison yet (N25) |
| .txt | Implemented, unverified | Fixed-pitch page text | Byte-identical on Windows and macOS; not opened in another app |
| .fountain | Implemented, unverified externally | Fountain syntax (fountain.io), within the limits the export report lists | Kolbítar's own round trip (automated) and byte-identical on Windows and macOS. No other app yet (N22) |
| .fdx | Implemented, unverified externally | Elements listed in the export report | As Fountain. Final Draft not yet tried (N23) |
| .docx | Partial with documented losses | Word and Google Docs profile | TextEdit (macOS) 2026-10-27, on pack v1: formatting lost, fixed since in pack v2. Pending: recheck on v2, Pages (not installed on the test Mac), Word, Google Docs (N28) |
| .rtf | Partial with documented losses | Word, LibreOffice, TextEdit | TextEdit (macOS) 2026-10-27, on pack v1. Text and indents right; title page break fixed since, in pack v2. Pending: Word, LibreOffice |
| .html | Verified within profile on screen (Safari); print unverified | Any current browser, screen and print | Safari (macOS) 2026-10-27, and the owner's informal check. Print preview not yet run |
| .xlsx / .csv / .tsv (reports) | Verified within profile (automated) | StoryScry reports (individual or 7-sheet workbook): typed numeric columns, human scene numbers + stable IDs, formula-safe text cells | Automated XML well-formedness, typed-cell, formula-escaping and deterministic-bytes tests (`report_export::tests`), `compat_m4::tests`, and e2e suite on Windows. M4 pack v1 generated (`out/compat-pack-m4-v1/`). External spreadsheet app checks pending (N33) |
| .pdf / .html / .xlsx / .csv (stripboard) | Verified within profile (automated) | Stripboard & shooting schedule: independent schedule order, color legend pairing high-contrast symbols (`○`, `●`, `☼`, `☽`, `◈`), day breaks, unclipped descriptions, formula-safety | Automated tests in `stripboard::tests`, `compat_m4::tests`, and e2e suite on Windows. M4 pack v1 generated (`out/compat-pack-m4-v1/`). External app checks pending (N35) |
| .pdf (character sides) | Verified within profile (automated) | Character sides: scenes-only and cross-out modes, baseline locked scene numbers and page labels, dual dialogue preservation, Courier Prime 12 pt | Automated tests in `sides::tests`, `store::tests`, `compat_m4::tests`, and e2e suite on Windows. M4 pack v1 generated (`out/compat-pack-m4-v1/`). External viewer checks pending (N36) |
| .cirth-review | Verified within profile (automated) | Portable review package v1: self-contained script text, anchored comment threads with replies, and alternate takes without host paths or credentials. Sanitized against path traversal, script injection, and formula prefixes | Automated unit tests in `review::tests`, store tests, contract, notices, and e2e Test 75 on CDP and WebDriver drivers on Windows |
| .txt / .html (comic script) | Verified within profile (automated) | Comic book scripting: explicit page/panel hierarchy, speech balloons, captions, sound effects, panel counting reconciliation | Automated `comic::tests`, fixtures tests, and e2e Test 77 on CDP and WebDriver |
| .txt / .pdf (stage play & multi-cam) | Verified within profile (automated) | Multi-cam teleplays (`SCENE A`, uppercase dialogue) and theatrical stage plays (`ACT I, SCENE 1`, bracketed stage directions) with profile layout pagination | Automated `stage_teleplay::tests`, layout tests, and e2e Test 78 on CDP and WebDriver |
| .twee / .html / .json (interactive story) | Verified within profile (automated) | Interactive branching story: Twee 3 export, offline standalone playable HTML runner with history and restart, JSON graph export | Automated `interactive::tests`, BFS graph validation, and e2e Test 79 on CDP and WebDriver |
| .docx / .html / .txt (treatment prose) | Verified within profile (automated) | Series treatment & pitch bibles: H1–H3 hierarchy, reading time metrics, Project Bible entity cross-referencing, semantic HTML, and WordprocessingML DOCX | Automated `treatment::tests`, fixtures tests, and e2e Test 80 on CDP and WebDriver |
| Grammar analysis report | Verified within profile (automated) | 100% offline rule-based grammar and style analyzer: duplicate words, passive voice, quotes, parentheticals, cliches, spacing, and one-click replacement fix | Automated `grammar::tests`, UI review dialog, and e2e Test 81 on CDP and WebDriver |
| AI Assistant & Non-Destructive Diffs | Verified within profile (automated) | Opt-in, off-by-default assistant: local runner (Ollama/LM Studio) or cloud endpoints, transparent scope disclosure and token estimator, side-by-side non-destructive block diffs, and accepted batch diff application | Automated `ai::tests`, IPC commands, UI assistant dialog, and e2e Test 82 on CDP and WebDriver |
| Export capability & Google workflow adapter | Verified within profile (automated) | Export capability analyzer for Google Docs (.docx) and Google Sheets (.xlsx/.csv): fidelity grading, loss warnings, and dynamic export dialog guidance | Automated `export_capability::tests`, UI export dialog integration, and e2e Test 83 on CDP and WebDriver |
| Native Print Stylesheet (@media print) | Verified within profile (automated) | Physical Letter portrait printing with Courier Prime 12pt, margin-aligned scene numbers, zero UI clutter, screen markup suppression, and page-break rules | Automated CSSOM rules verification (`suite.mjs` Test 87) on CDP and WebDriver; manual check N50 |

## Deferred

M2 closed on 2026-10-27 with this record as a baseline; the missing external results below are carried into M3.

- **Mac recheck of pack v2: deferred (owner, 2026-10-27).** The test Mac is busy with other work. When it is free, revisit:
  - cross-OS hashes, especially the DOCX;
  - the PDF Producer and page size in Preview;
  - DOCX formatting in TextEdit;
  - the RTF title page in TextEdit.

  Until then, every "fixed in v2" below is tested only by Kolbítar's own automated tests, not on the Mac.

## Results log

Mac rows: tested on the owner's Mac (macOS 26.2 (25C56), Apple M4 Pro) by a Claude Code session working for the owner. Evidence: screenshots kept on that Mac. Courier Prime is not installed system-wide there.

| Date | Format | App and version | OS | Pack / file | Kept | Lost or different | Reviewer | Evidence |
| - | - | - | - | - | - | - | - | - |
| 2026-10-27 | HTML | Browser (name and version not recorded) | Not recorded | Step 8 export (commit ce5c517), file not recorded | Looked right and matched the script; "not being critical" | None noted | Owner | Owner's message in the development session |
| 2026-10-27 | Fountain, FDX | Kolbítar itself (export, then import) | Windows 11 | Pack v1, all 3 samples | Every block's kind and text, in order | Only what the export reports name | Automated test | `compat::tests::the_pack_is_complete_and_repeatable` |
| 2026-10-27 | All 7 formats | `cirth-cli compat-pack` | Windows 11 and macOS 26.2 | Pack v1, commit a07198a | 18 of 21 files byte-identical across the two OSes: all PDF, TXT, Fountain, FDX, RTF and HTML | The 3 DOCX differed: zip entries record the host OS and file mode. **Fixed** in pack v2 (fixed Unix mode 0644 on every entry; tested); cross-OS recheck pending | Mac session; automated test | MANIFEST.md on both machines; `docx::tests::same_script_gives_the_same_bytes` |
| 2026-10-27 | PDF | Preview 11.0 (1113.3.1) | macOS 26.2 | Pack v1: page-boundaries (10 pages), long-120 (128) | Title page first and unnumbered; header and "2." from script page 2; scene numbers in both margins; (MORE)/(CONT'D); clean Select All and Copy, including dual dialogue | Producer and Creator showed "KolbÃ­tar" (raw UTF-8 Info strings): **fixed** in v2, now UTF-16BE. Page size showed 8.51 × 11.01 in (MediaBox 612.00006): **fixed** in v2 (612 × 792). Embedded fonts are named F0–F3, so viewers cannot name Courier Prime (printpdf limit; open) | Mac session | Inspector screenshot |
| 2026-10-27 | PDF | Preview 11.0 | macOS 26.2 | Pack v1: unicode-marks | Accented Latin, curly quotes, ellipsis, em dash; bold, italic and underline | Emoji, Japanese, Hebrew and Arabic blank; a combining accent dropped ("e" for "é"). Courier Prime has no glyphs for them, and no fallback font is chosen yet (DECISIONS: fonts) | Mac session | Screenshot of page 2 |
| 2026-10-27 | RTF | TextEdit 1.20 (415) | macOS 26.2 | Pack v1: all 3 | Opens without warning; Courier substituted; cue and dialogue indented; CUT TO: right-aligned; scene number on the left; every Unicode character right, including right-to-left | Title page not on its own page (\sect ignored): **fixed** in v2 with a page break on the first script paragraph, recheck pending. Large space before the title ignored. No right-hand scene numbers. Dual dialogue stacked. No headers or page numbers (TextEdit shows none) | Mac session | Screenshots |
| 2026-10-27 | DOCX | TextEdit 1.20 (415) | macOS 26.2 | Pack v1: all 3 | Opens without warning; all characters right; title-page alignment and scene-number hanging indent | Times instead of Courier; no indents, spacing or right alignment, because TextEdit ignores styles.xml. **Fixed** in v2 (formatting also written on each paragraph and run), recheck pending. Title bar said "Locked" (cause not known) | Mac session | Screenshot |
| 2026-10-27 | HTML | Safari 26.2 (21623.1.14.11.9) | macOS 26.2 | Pack v1: all 3 | Scene numbers in both margins; indents; bold, italic, underline; every Unicode character, including emoji and right-to-left | Courier substituted (no font is embedded). Dual dialogue stacked (as reported). Print preview not run | Mac session | Screenshots |
| 2026-10-29 | XLSX, CSV, TSV, HTML, PDF, RTF (StoryScry) | Kolbítar automated test suite (`compat_m4::tests`) | Windows 11 | M4 pack v1, 13 report files | Typed numbers, XML well-formedness, stable scene IDs & human numbers, formula-safe `=/+/-/@` prefixes, deterministic byte generation | External spreadsheet applications not yet tested (N33) | Automated test | `compat_m4::tests::the_m4_pack_is_complete_repeatable_and_valid`, `out/compat-pack-m4-v1/MANIFEST.md` |
| 2026-10-29 | PDF, HTML, XLSX, CSV (Stripboard) | Kolbítar automated test suite (`compat_m4::tests`) | Windows 11 | M4 pack v1, 4 stripboard files | Independent schedule order, color legend pairing high-contrast symbols (`○`, `●`, `☼`, `☽`, `◈`), day breaks with page counts, deterministic byte output | External spreadsheet / PDF applications not yet tested (N35) | Automated test | `compat_m4::tests::the_m4_pack_is_complete_repeatable_and_valid`, `out/compat-pack-m4-v1/MANIFEST.md` |
| 2026-10-29 | PDF (Sides) | Kolbítar automated test suite (`compat_m4::tests`) | Windows 11 | M4 pack v1, 3 sides PDFs (scenes-only, cross-out, dual dialogue) | Accurate scene selection, cross-out line rendering, original script page numbers & locked scene numbers preserved, dual dialogue preserved side-by-side, deterministic trailer ID and bytes | External PDF viewers not yet tested (N36) | Automated test | `compat_m4::tests::the_m4_pack_is_complete_repeatable_and_valid`, `out/compat-pack-m4-v1/MANIFEST.md` |

Kolbítar reading its own files proves the adapters agree with each other, not that other apps read them. External rows are still needed for Word, Google Docs, LibreOffice, Final Draft and a Fountain app.
