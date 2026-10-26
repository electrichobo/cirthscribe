# CirthScribe planning pack

Version 0.1 | 2026-10-25 | Owner: Jared Hoy

A practical starting brief for an AI-assisted, free/open-source screenplay and story-production application.

This pack is specification only. It contains no implemented editor, tested compatibility guarantee, or chosen project license.

## Put this into a repository

Extract the archive into the root of a new CirthScribe repository. Keep CLAUDE.md at the root and the supporting files under docs/. Open the folder in your coding agent and give it START_HERE.md as the first task.

CLAUDE.md contains operating rules. Supporting files hold the details so the agent does not need a giant instruction file on every turn.

| File | Purpose |
| --- | --- |
| CLAUDE.md | Coding-agent instructions and non-negotiable rules |
| START_HERE.md | First prompt to paste into Claude Code or another coding agent |
| docs/PRODUCT_SPEC.md | Requested behavior, feature boundaries, and user interactions |
| docs/ARCHITECTURE.md | Proposed data model, stack decision, persistence, and layout strategy |
| docs/ROADMAP.md | Implementation sequence and milestone exit gates |
| docs/ACCEPTANCE.md | Observable acceptance scenarios |
| docs/INTEROPERABILITY.md | Export matrix, fidelity rules, and Google compatibility |
| docs/DECISIONS.md | Proposed defaults and decisions still open |
| docs/SOURCES.md | Primary technical references checked for this pack |

## Reading the priorities

- M0 is feasibility and architecture selection.
- M1 builds a usable, safely saved screenplay editor.
- M2 establishes dependable script interchange and production pagination.
- Later milestones add story planning, production analysis, branches, richer formats, and optional integrations.

Later does not mean rejected. Every requested feature is retained; difficult features have explicit prerequisites.

## Important defaults

Tauri/Rust is a provisional recommendation, not a permanent commitment. The chosen framework must pass the editing and pagination spike first.

The proposed native project extension is .cirth. The exact extension, storage container, release license, minimum OS versions, and visual identity are still decisions.

"Google compatible" means verified DOCX and spreadsheet exchange profiles with documented limits. It does not mean exact screenplay pagination inside Google Docs or automatic live collaboration.

"Screen time" means separately labeled character dialogue, scene presence, estimated duration, and manually supplied measured duration.

A beat card references a scene. It does not contain an editable duplicate of the scene's script prose.

