# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

M2, production screenplay output (docs/M2_PLAN.md). Steps 1–8 are built and pushed. **Step 9, the compatibility matrix, is in progress:** collect external results for every export format in docs/COMPATIBILITY.md, each labelled with an actual test and its date. The M2 exit review comes after it.

## Completed & Verified

- Step 9 groundwork (a07198a, pushed): `cirth-cli compat-pack` and docs/COMPATIBILITY.md.
- First external round, owner's Mac, pack v1: Preview, TextEdit and Safari. Results are logged; Pages was not installed.
- Fixes from that round, now pack v2:
  - DOCX: the same bytes on every OS (zip entries Unix 0644), plus direct paragraph and run formatting;
  - PDF: Info strings as UTF-16BE, with cross-reference offsets shifted and validated by a test; MediaBox exactly 612 × 792;
  - RTF: a page break after the title page that TextEdit honours.
- Checks on Windows 11: `cargo test -p cirth-core` (all pass, including new tests for the zip headers, PDF Info and offsets, and the RTF page break); `cirth-cli compat-pack` (v2, 21 files).
  - Full suites: notices check, `npm run test:contract` (4), `npm run e2e:cdp` (50/50), `npm run e2e:webdriver` (49/49, 1 skipped: IME).
- Not verified:
  - The v2 fixes on the Mac. Is the DOCX now byte-identical across OSes?
  - Word, Google Docs, LibreOffice, Final Draft, a Fountain app, and Safari print preview.
  - PDF fonts are named F0–F3 (printpdf).
  - No fallback font for non-Latin text in the PDF.
  - Manual checks N20–N28.
  - Known limits as before; carried M1 items.

## In-Progress / Uncommitted State

None once the step 9 fixes are committed.

## Next Immediate Step

1. Ask the owner whether to push.
2. Send the Mac session a recheck on pack v2 (the commit after a07198a): compare all 21 hashes with Windows; recheck the PDF Producer and page size in Preview, the DOCX formatting in TextEdit, and the RTF title page in TextEdit.
3. Log the results. Then the owner's own app tests (Word, Google Docs, LibreOffice, Final Draft, a Fountain app).
