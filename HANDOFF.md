# Handoff

Working state for whichever agent works next (see "Session Handoff Protocol" in AGENTS.md). Last updated 2026-10-27.

## Current Goal

Milestone 2, production screenplay output (plan and step order: docs/M2_PLAN.md). Steps 1–6 are built: title page, Fountain, FDX, scene numbers, production PDF, revision sets. Step 7, locked pages, is next. After it come step 8 (DOCX, RTF and HTML exports with capability reports) and step 9 (compatibility matrix).

## Completed & Verified

- Agent setup: AGENTS.md holds the instructions and describes the current stage, stack, repository map, commands and conventions. CLAUDE.md and GEMINI.md import it. HANDOFF.md exists. A local pre-push hook warns about a stale HANDOFF.md; tested with simulated push input.
- Step 6 revision sets (commit feb80da):
  - `cirth_core::revisions`; schema v5 table `revision_sets`; `Run::revision` tags text.
  - The editor tags changes in revision mode, and undo removes the tag.
  - Margin marks and a revision header on changed pages; File > Export > Changed Pages (PDF)….
- Step 5 production PDF (commit 3726521, pushed): output is byte-for-byte repeatable; headers and footers; golden page files in `fixtures/golden/`, checked in CI on three OSes.
- Checks run on Windows 11 for feb80da, all passing:
  - `cargo test -p cirth-core`;
  - `npm run test:contract`;
  - `npm run e2e:cdp` (48/48);
  - `npm run e2e:webdriver` (47/47, 1 skipped: IME cannot be simulated);
  - `node app/scripts/third-party-notices.mjs --check`.

## Assumed / Untested

- macOS and Linux runs of the new golden tests happen only in CI after a push.
- Manual checks still open (docs/testing/MANUAL_CHECKS.md):
  - N25: PDF margins against an industry PDF;
  - N26: printed changed pages on Letter and A4. The mark is about 0.27 in from the A4 edge.
  - N20–N24 on Mac;
  - N23: FDX opened in Final Draft.
- Moving scenes from the board or scene list does not mark them as revised. FDX does not carry revision sets.
- Carried from M1: Linux typing latency, reference machines, defect 3 (a rare End/Enter miss in the stress test).

## Next Immediate Step

Build M2 step 7, locked pages:
- lock a pagination baseline;
- later edits make A/B pages instead of reflowing (acceptance D3, D4, D8);
- a layout-engine upgrade or a missing font never reflows a locked baseline.
