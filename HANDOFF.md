# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-27.

## Current Milestone & Goal

M2, production screenplay output (docs/M2_PLAN.md). Steps 1–7 are built and pushed: title page, Fountain, FDX, scene numbers, production PDF, revision sets, locked pages. The goal now is **step 8: DOCX, RTF and HTML exports, each with a capability report** (what the format cannot carry). Then step 9 (compatibility matrix) and the M2 exit review.

## Completed & Verified

- Step 7 locked pages (adef267, pushed):
  - `cirth_core::locked`; the baseline is JSON in the document settings.
  - Overflow goes onto 12A, 12B; emptied pages fold into "11-12".
- Step 6 revision sets (feb80da, pushed).
- Agent protocol: AGENTS.md has the takeover protocol. CLAUDE.md, GEMINI.md and QWEN.md point to it. START_HERE.md and STATUS.md describe the current stage.
- Checks run on Windows 11 for adef267, all passing:
  - `cargo test -p cirth-core`;
  - `npm run build`;
  - `npm run test:contract` (4);
  - `npm run e2e:cdp` (49/49);
  - `npm run e2e:webdriver` (48/48, 1 skipped: IME);
  - the third-party notices check.
- Not verified:
  - macOS and Linux run only in CI after a push.
  - Manual checks N20–N27 are open (docs/testing/MANUAL_CHECKS.md).
  - Known limit: editing inside a block that crosses a locked boundary can shift that split point.
  - Moving scenes from the board does not mark them revised.
  - FDX carries neither revision sets nor locked pages.
  - Carried from M1: Linux latency, reference machines, defect 3.

## In-Progress / Uncommitted State

None after the agent-protocol commit. The working tree is clean.

## Next Immediate Step

Step 8, starting with DOCX:
1. Add `crates/cirth-core/src/docx.rs`, a Word document written with the approved `zip` crate. It is not yet a dependency: add it to `crates/cirth-core/Cargo.toml` (approved for this step) and record it in docs/m0/LICENSES.md.
2. Map each block kind to a paragraph style with screenplay indents. Return an `Exported { notes }` capability report, like `fountain.rs` and `fdx.rs`.
3. Then RTF (`rtf.rs`, no dependency needed) and HTML (`html.rs`), with File > Export menu items and an e2e test.
