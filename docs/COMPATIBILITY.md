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
| .cirth (native) | Verified within profile | Kolbítar reopening its own projects, upgrades from schemas v1–v4 | Automated store, migration and crash tests on Windows, macOS and Linux CI |
| .pdf | Partial with documented losses | US Letter and A4, Courier Prime 12 pt | Preview (macOS) 2026-10-27, on pack v1. Fixed since, pending a recheck on pack v2: page size and metadata text. Known losses: no fallback font for characters Courier Prime lacks. No industry comparison yet (N25) |
| .txt | Implemented, unverified | Fixed-pitch page text | Byte-identical on Windows and macOS; not opened in another app |
| .fountain | Implemented, unverified externally | Fountain syntax (fountain.io), within the limits the export report lists | Kolbítar's own round trip (automated) and byte-identical on Windows and macOS. No other app yet (N22) |
| .fdx | Implemented, unverified externally | Elements listed in the export report | As Fountain. Final Draft not yet tried (N23) |
| .docx | Partial with documented losses | Word and Google Docs profile | TextEdit (macOS) 2026-10-27, on pack v1: formatting lost, fixed since in pack v2. Pending: recheck on v2, Pages (not installed on the test Mac), Word, Google Docs (N28) |
| .rtf | Partial with documented losses | Word, LibreOffice, TextEdit | TextEdit (macOS) 2026-10-27, on pack v1. Text and indents right; title page break fixed since, in pack v2. Pending: Word, LibreOffice |
| .html | Verified within profile on screen (Safari); print unverified | Any current browser, screen and print | Safari (macOS) 2026-10-27, and the owner's informal check. Print preview not yet run |
| .xlsx / .csv | Not implemented | Reports and stripboards (later milestones) | — |

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

Kolbítar reading its own files proves the adapters agree with each other, not that other apps read them. External rows are still needed for Word, Google Docs, LibreOffice, Final Draft and a Fountain app.
