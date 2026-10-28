# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

M2, production screenplay output (docs/M2_PLAN.md). Steps 1–8 are built and pushed (through ce5c517). **Step 9, the compatibility matrix, is in progress:** collect external results for every export format, each labelled with an actual test and its date, in docs/COMPATIBILITY.md. The M2 exit review comes after it.

## Completed & Verified

- Step 9 groundwork:
  - `cirth_core::compat` and `cirth-cli compat-pack` write the three samples in all seven formats to `out/compat-pack-v1/`, with MANIFEST.md hashes.
  - docs/COMPATIBILITY.md holds per-format status, a results log and how to test.
- Logged so far:
  - the owner's informal HTML look (2026-10-27; browser not recorded);
  - Kolbítar's automated Fountain and FDX round trips of the whole pack (internal, not external).
- Checks on Windows 11: `cargo test -p cirth-core` (all pass, including the repeatable-pack and round-trip test); `cirth-cli compat-pack` ran (21 files).
  - The app (UI and Tauri) did not change in this step, so the e2e suites were not rerun. They last passed on ce5c517: CDP 50/50, WebDriver 49/49.
- Not verified:
  - No external app results yet for PDF, TXT, Fountain, FDX, DOCX or RTF, and HTML only informally.
  - Manual checks N20–N28 are open. macOS and Linux run only in CI.
  - Known limits as before: locked-boundary split offsets; board moves not marked revised; FDX has no revisions or locked pages.
  - Carried from M1: Linux latency, reference machines, defect 3.

## In-Progress / Uncommitted State

None once the step 9 groundwork commit is made.

## Next Immediate Step

The owner chooses which external tests to run, and where:
- Final Draft, Word, Google Docs, LibreOffice and Fountain apps on the owner's machines;
- TextEdit, Pages, Preview and Safari on the Mac test machine via its Remote Control session, only with the owner's go-ahead.

Each result becomes a row in docs/COMPATIBILITY.md, with the format's status updated. Fix any defects found, then start the M2 exit review (template: docs/m1/EXIT_REVIEW.md).
