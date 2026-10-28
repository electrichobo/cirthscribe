# M2 exit review

Date: 2026-10-27. Commit reviewed: 65462b7, plus the Linux CI fix attempt in the commit that adds this review. Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M2 and its exit line), ACCEPTANCE.md section D, docs/M2_PLAN.md and docs/COMPATIBILITY.md.

**Verdict: M2 is not done.**
- Everything M2 promised is built, with tests on Windows.
- The exit gate needs external results that do not exist yet, and one platform check is failing:
  - Linux end-to-end has been red in CI since M2 step 3;
  - Word, Google Docs, LibreOffice and Final Draft results are missing;
  - the Mac recheck is deferred by the owner.
- One acceptance item needs an owner decision: non-Latin text in PDFs.

## 1. ROADMAP M2 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Authoritative pagination and PDF, licensed bundled font | Yes (steps 5, M1) | Courier Prime (OFL) embedded. Golden pages pass in CI on Windows, macOS and Linux. Preview on macOS: pages, header, numbers and copy all right | No fallback font for scripts Courier Prime lacks (decision A). Font names F0–F3 in the PDF (printpdf limit). Industry comparison N25 not done |
| Title pages, dual dialogue, continuations, headers and footers, page breaks | Yes (steps 1, 5, M1) | Core and golden tests, e2e on both drivers, Preview | Dual dialogue is stacked in DOCX, RTF and HTML (reported) |
| Scene numbers, omitted scenes, revision sets, locked pages | Yes (steps 4, 6, 7) | Core, golden and e2e tests on both drivers | Manual checks N24, N26 and N27 not run |
| PDF, FDX, DOCX, RTF, TXT and HTML exports with capability reports | Yes (steps 3, 5, 8) | Every export shows a report; core and e2e tests | External checks partial (section 3) |
| FDX import as an interchange priority, with unsupported features stated | Yes (step 3) | Import report lists unknown paragraph types (kept as action), script notes not imported, unused settings, numbers kept | Never tried with a file from Final Draft itself (N23) |
| Verified fixture exchange and a baseline compatibility matrix | Started (step 9) | Test pack, cross-OS byte comparison, first Mac round (docs/COMPATIBILITY.md) | Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print; the v2 recheck deferred |

## 2. Acceptance D (pagination and production revisions)

| # | Status | Evidence |
| - | - | - |
| D1 Known script: page count, boundaries, continuations, title page, dual dialogue, selectable PDF text | Pass, except non-Latin glyphs in the PDF | Golden tests. Preview on macOS: selectable and copyable text. Emoji, Japanese, Hebrew and Arabic blank (no fallback font) |
| D2 Zoom and resize leave the page map unchanged | Pass | e2e "zoom does not change it" (M1), both drivers |
| D3 Text added to a locked page uses suffix pages; later pages keep labels | Pass | Golden test (both samples byte-identical when unchanged; an edited page runs onto A pages); e2e on both drivers |
| D4 Most of a locked page deleted: label continuity | Pass | Core test (shorter page; an emptied page folds into "4-5") |
| D5 Omitted scene keeps identity and number and restores; comments and tags still link | Pass for numbers; comments and tags not testable yet | Comments come in M5 (owner decision C) |
| D6 Revise dialogue, switch sets, export changed pages; dates, colours, marks, page coverage | Pass | e2e on both drivers; golden changed-page file |
| D7 Same boundaries on all three OSes | Pass | Golden tests green in CI on Windows, macOS and Linux (latest completed run, a07198a). The Mac pack was byte-identical for PDF, TXT, Fountain, FDX, RTF and HTML |
| D8 Engine upgrade or lost font never reflows a locked baseline | Pass | Core test: a different engine version gives a warning and keeps the boundaries. Pages use only the bundled font |
| D9 Long headings, dialogue over several pages, parentheticals at page end, explicit breaks, non-Latin text, invalid profile settings | Pass in layout; non-Latin fails in the PDF | page-boundaries and unicode-marks fixtures; unknown page profiles refused by the store. PDF glyph gap as in D1 |

## 3. Exit line

- **"Locked-page editing and PDF rendering pass boundary fixtures."** Met.
- **"Imports do not silently discard content."** Met for Fountain and FDX: anything not imported is named in the report. Fountain notes and boneyard are kept as text.
- **"External editor/Google results are labelled by actual tests, not assumed from file extensions."** Met for the results that exist. Every row in docs/COMPATIBILITY.md names the app, version, OS, date and file. But there is no result yet for Word, Google Docs, LibreOffice, Final Draft, a Fountain app, Pages or browser print. ROADMAP's "verified fixture exchange" is therefore not met.

## 4. Blockers and open items

1. **Linux end-to-end in CI: failing since d2d7bdc (M2 step 3).** Core tests, macOS and Windows pass.
   - The failing test: Tab and Shift+Tab inside the island's More popover.
   - Likely cause: step 1 added a Title Page button to More, so Shift+Tab is now pressed from a `<select>`, which WebKitGTK handles differently. This is an inference: it cannot be run on this machine.
   - Fix attempt in the commit that adds this review: the trap never lets focus leave, settings are no longer moved while More is open, and the test reports where focus went.
   - Confirmed only when CI runs it.
   - Earlier, in 24466e0, the Linux run failed once on "Narrow script column"; later runs got past it.
   - The failures went unnoticed because several runs in between were cancelled by newer pushes and no one read the results.
2. **External compatibility results** (above). Needs the owner's apps.
3. **Mac recheck of pack v2: deferred by the owner** (the Mac is busy). It covers:
   - DOCX bytes across OSes;
   - the PDF Producer and page size;
   - DOCX formatting in TextEdit;
   - the RTF title page.
4. **Manual checks** N20–N28 are open; N25 is the industry PDF comparison.
5. **Carried from M1:** Linux typing latency, named reference machines, defect 3 (rare End/Enter stress miss).
6. **Known limits** (documented): a locked boundary inside an edited block can shift its split point; board moves are not marked revised; FDX carries no revision sets or locked pages; dual dialogue is stacked in document formats.

## 5. Decisions for the owner

- **A. Non-Latin text in PDFs.** Courier Prime has no CJK, Hebrew, Arabic or emoji glyphs, so those print blank.
  - (1) Bundle a fallback font. It must be OFL or similar; CJK fonts are large (tens of MB), and wide characters already take two columns in the layout.
  - (2) Keep it as a reported limitation for M2 (the export already lists missing glyphs) and pick the font in a later milestone.
- **B. Closing M2.**
  - (1) Wait for the external results and the Mac recheck.
  - (2) Close M2 as M1 was closed, carrying the external tests, the Mac recheck and the manual checks forward, once Linux CI is green again.
- **C. Pages on the Mac:** installs are not allowed there, so Pages stays untested unless you install it yourself.
