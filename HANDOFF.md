# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-28.

## Current Milestone & Goal

**M3 closed by the owner on 2026-10-28** (docs/m3/EXIT_REVIEW.md: decision A option 1, close and carry; decision B, straight on to M4). Next is M4, production analysis and stripboard (docs/ROADMAP.md). **docs/M4_PLAN.md accepted by the owner 2026-10-28** (A: original SVG charts; B: tags tracked as separate anchored records, ADR at step 3; C: report PDFs/RTF from the core; D: E5 and branch scope wait for M5; E: reports first). Step 1 not started.

## Completed & Verified

- M3 built (details per step in docs/M3_PLAN.md):
  - workspace steps W1–W5 from the owner's notes: menus, notes panel, pop-out panels (ADR 0004), themes, rebindable shortcuts;
  - steps 1–9: planning commands with undo (ADR 0003), episodes and series, the tabbed navigator, the outline editor, the beat and pacing board, the overview map, the project bible, the story timeline, the evidence board and bookmarks. Project files are now schema v10 (frozen v5–v9 test files, each with an upgrade test).
- Fixed on the way: settings and planning edits now count as unsaved work (recovered after a crash); undo waits for card writes; quick outline moves all count; window creation is async (a sync command deadlocked on Windows); the revision colour order is the Writers Guild's (White original; Blue … Cherry; Double Blue).
- Last checks (4334037): `cargo test -p cirth-core` all pass; e2e CDP 63/63, WebDriver 62/62 (1 skipped: IME); contract 4; CI green on Windows, macOS and Linux (Linux runs the whole e2e suite). Every M3 push was green in CI.
- M4 plan drafted from ROADMAP M4, PRODUCT_SPEC 6, ACCEPTANCE E and INTEROPERABILITY (reports, XLSX/CSV rules).
- M3 exit review written and the closure recorded in the review, M3_PLAN, ROADMAP, STATUS, AGENTS, START_HERE, README.
- Not verified (carried into M4):
  - the Mac run of M3 (manual check N31); N29 (menus, window commands, real imports); N30 (pop-out windows);
  - known limits listed in docs/m3/EXIT_REVIEW.md section 1 (no episode deletion, bible scope not used, act moves do not reorder the script, free-text timeline dates, unused pictures kept);
  - acceptance B6 (with M4's reports) and C5 (with M5's branches);
  - from M2: external app results (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print), the Mac recheck of compat pack v2, manual checks N20–N28, non-Latin PDF glyphs;
  - from M1: Linux desktop latency, reference machines, defect 3; Windows e2e on the hosted runner.

## In-Progress / Uncommitted State

None once the closure commit is made.

## Next Immediate Step

1. M4 step 1: core `reports` (row data per report with scope and source version) and the StoryScry dialog.
2. After any push, read CI through the public API: `curl -s https://api.github.com/repos/electrichobo/cirthscribe/actions/runs?per_page=3`, and a failed job's annotations under `/check-runs/<job id>/annotations`.
