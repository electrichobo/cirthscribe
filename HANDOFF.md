# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

M2, production screenplay output. Steps 1–8 are built; step 9 (compatibility matrix) is in progress. **The M2 exit review is drafted: docs/m2/EXIT_REVIEW.md. Verdict: not done yet.** The immediate goal is to get Linux end-to-end green in CI again, then the owner's decisions A (non-Latin PDF font) and B (how to close M2).

## Completed & Verified

- Exit review: every ROADMAP M2 item and acceptance D1–D9 checked against code, tests and CI. D7 is green in CI on all three OSes (latest completed run: a07198a).
- Found while reviewing: Linux e2e has failed in CI since d2d7bdc (M2 step 3), on the More popover's Shift+Tab test. Fix attempt in viewmenu.ts:
  - the trap never lets focus leave;
  - settings are not moved while More is open;
  - the test reports where focus went.
  CI on b94b0de still failed, but with a diagnosis: "from select#view-mode, focus now on button#view-menu-btn" (the browser's default Shift+Tab; the popover's bubbling keydown never cancelled it on WebKitGTK).
  Second fix: Tab is handled in the capture phase on the document (Tab, ISO_Left_Tab, keyCode 9), plus a focus-in safety net. It passes on Windows under both drivers (50/50, 49/49); Linux needs another CI run.
- Mac recheck of pack v2: **deferred by the owner** (recorded in docs/COMPATIBILITY.md).
- Checks run on Windows 11: `npm run test:contract` (4), `npm run e2e:cdp` (50/50), `npm run e2e:webdriver` (49/49, 1 skipped: IME). CI on 65462b7: macOS and Windows jobs green (including the new PDF, DOCX and RTF tests); Linux failed on the same More Shift+Tab test (before this fix).
- Not verified:
  - Linux CI;
  - external app results (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print);
  - the Mac v2 recheck (deferred);
  - manual checks N20–N28;
  - carried M1 items; known limits as in the review.

## In-Progress / Uncommitted State

None once the review commit is made.

## Next Immediate Step

1. Ask the owner to push. Then read the CI result through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`, and the failed job's annotations under `/check-runs/<job id>/annotations`.
2. If Linux still fails, the new assertion message names where focus went: fix from that.
3. Ask the owner for decisions A and B (docs/m2/EXIT_REVIEW.md section 5).
