# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

M2, production screenplay output (docs/M2_PLAN.md). Steps 1–8 are built. Step 8, DOCX/RTF/HTML exports, is committed and not yet pushed. The goal now is **step 9: the compatibility matrix**, meaning fixtures exchanged with real external apps, each result labelled with the actual test and its date. Then the M2 exit review.

## Completed & Verified

- Step 8: `printdoc.rs` (shared production view), `docx.rs`, `rtf.rs` and `html.rs`, plus File > Export > Word / Rich Text / Web Page, each with a report.
  - The `zip` 9.1.3 dependency was added (owner-approved), the license inventory updated and the notices regenerated.
- Steps 1–7 pushed (adef267), and the agent protocol (65e86c7).
- Checks run on Windows 11 for step 8:
  - `cargo test -p cirth-core` (core tests for all three writers);
  - `npm run build`;
  - the "Word, RTF and HTML export" e2e test on CDP and WebDriver;
  - full suites: notices check (355 components), `npm run test:contract` (4), `npm run e2e:cdp` (50/50), `npm run e2e:webdriver` (49/49, 1 skipped: IME).
- Not verified:
  - DOCX/RTF/HTML have not been opened in Word, Google Docs, LibreOffice, TextEdit or a browser (manual check N28; step 9). The HTML page's look is unchecked: the browser pane cannot run tools on local files.
  - macOS and Linux run only in CI. Manual checks N20–N28 are open.
  - Known limits: an edit inside a block that crosses a locked boundary can shift that split point; board moves are not marked revised; FDX carries no revisions or locked pages.
  - Carried from M1: Linux latency, reference machines, defect 3.

## In-Progress / Uncommitted State

None once the step 8 commit is made.

## Next Immediate Step

Ask the owner whether to push. Then plan step 9:
1. Pick the fixtures: page-boundaries, unicode-marks and long-120, each with a title page and locked numbers.
2. Decide which external apps the owner can test, and on which machines: Word, Google Docs, LibreOffice, Final Draft, Fountain apps, browsers.
3. Create `docs/COMPATIBILITY.md`, a matrix of format × app × result × date, filled only from real tests (N22, N23 and N28 feed it).
