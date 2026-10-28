# Handoff

Working state for whichever agent works next (see "Session Handoff Protocol" in AGENTS.md). Last updated 2026-10-27.

## Current Goal

Milestone 2, production screenplay output (plan and step order: docs/M2_PLAN.md). Steps 1–7 are built: title page, Fountain, FDX, scene numbers, production PDF, revision sets, locked pages. Two steps remain: step 8 (DOCX, RTF and HTML exports with capability reports) and step 9 (compatibility matrix). After them comes the M2 exit review.

## Completed & Verified

- Step 7, locked pages (`cirth_core::locked`; the baseline is JSON in the document's settings, so no schema change):
  - Format > Locked Pages > Lock Pages / Unlock Pages….
  - Overflow goes onto 12A, 12B…; emptied pages fold into "11-12"; (MORE)/(CONT'D) across locked boundaries.
  - Labels appear in the editor markers, PDF, TXT and revision headers. The page size is fixed while locked.
- Step 6, revision sets (feb80da, pushed): revision mode tags text; changed-pages export.
- Agent setup (76e07ca, f4124df, pushed): AGENTS.md, HANDOFF.md, CLAUDE.md and GEMINI.md import AGENTS.md, and a local pre-push hook.
- Step 7 checks run on Windows 11, all passing:
  - `cargo test -p cirth-core`, including the locked tests, the golden tests (both samples locked and unchanged match the unlocked pages byte for byte; an edited page runs onto A pages) and a store test;
  - the "Locked pages" e2e test on CDP and WebDriver;
  - full suites: third-party notices check, `npm run test:contract` (4), `npm run e2e:cdp` (49/49), `npm run e2e:webdriver` (48/48, 1 skipped: IME).

## Assumed / Untested

- An edit before a split point inside a block that crosses a locked boundary moves that split point by the edited amount (offsets count characters).
- Moving scenes from the board or scene list does not mark them as revised. FDX does not carry revision sets or locked pages.
- macOS and Linux run the golden tests only in CI after a push.
- Manual checks still open (docs/testing/MANUAL_CHECKS.md):
  - N25: PDF margins against an industry PDF;
  - N26: printed changed pages;
  - N27: locked-page labels compared with a production tool;
  - N20–N24 on Mac;
  - N23: FDX opened in Final Draft.
- Carried from M1: Linux typing latency, reference machines, defect 3.

## Next Immediate Step

Commit step 7 and ask the owner whether to push. Then build M2 step 8, further exports with capability reports:
- DOCX (Google Docs profile; uses the approved `zip` crate);
- RTF;
- HTML.
Each gets an export report of what the format cannot carry.
