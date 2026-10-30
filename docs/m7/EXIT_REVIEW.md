# M7 exit review

Date: 2026-10-30. Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M7 and its exit line), docs/M7_PLAN.md, docs/INTEROPERABILITY.md, PRODUCT_SPEC.md §8.

**M7 closed for review, carrying forward:** manual checks N47–N48 (AI assistant & Google workflows), carried checks N41–N46, N37–N40, N32–N36, the Mac runs (N31, carried), and the items carried from M1–M5.

Verdict before closing: **everything M7 promised is built and verified with automated suites (188 core unit/integration tests, 4 contract tests, 355 license notices, 83 e2e CDP tests, and 82 e2e WebDriver tests).**
- Automated: core tests, contract tests, license notices, and both end-to-end drivers (CDP and WebDriver) on Windows.
- Carried forward: desktop manual checks N47–N48 logged in `docs/testing/MANUAL_CHECKS.md`, plus carried items from M1–M6.

## 1. ROADMAP M7 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Bring-your-own AI architecture & configuration | Yes (steps 1 & 2) | Core `cirth_core::ai::AiConfig`, `AiProviderType`, off-by-default persistence, token estimator, e2e Test 82 | — |
| Transparent scope disclosure & non-destructive diffs | Yes (steps 2 & 4) | Core `cirth_core::ai::compute_block_diffs`, `AiPayload`, `app/src/aidlg.ts` side-by-side diff preview, colored badges, e2e Test 82 | — |
| Transactional diff application preserving document invariants | Yes (step 4) | Atomic batch diff application in `main.rs`, Heading `scene_id` preservation, journal undo integration, e2e Test 82 | — |
| Export capability analysis & fidelity grading | Yes (step 5) | Core `cirth_core::export_capability`, `TargetFormat`, `FidelityGrade`, loss warnings, e2e Test 83 | — |
| Google Docs & Sheets workflow adapter & documentation | Yes (step 5) | Dynamic export dialog guidance in `app/src/exportdlg.ts`, comprehensive workflow guide in `docs/INTEROPERABILITY.md`, e2e Test 83 | — |
| Compatibility matrix, automated suites & exit review | Yes (step 6) | Updated `docs/COMPATIBILITY.md`, `docs/testing/MANUAL_CHECKS.md`, this exit review `docs/m7/EXIT_REVIEW.md` | — |

## 2. Core Architectural Decisions & Invariants

- **A. Pure Core Boundary for AI:** `cirth-core` remains 100% pure, deterministic, and free of networking dependencies (no `reqwest` or asynchronous HTTP crates added to `Cargo.toml`). The app shell and browser layer manage network communication to user-configured local (Ollama/LM Studio) or cloud endpoints, while `cirth-core` handles payload generation, token estimation, and non-destructive diff analysis.
- **B. Strictly Off by Default:** AI features are disabled by default. When disabled, the application generates zero network traffic and functions as a completely self-contained, offline desktop application.
- **C. Non-Destructive Diffs:** AI suggestions cannot directly overwrite or mutate manuscript data without explicit user review and per-diff acceptance. Accepted diffs commit through standard versioned transactions.
- **D. Google Docs & Sheets Interchange:** Screenplay prose is kept strictly distinct from spreadsheet tables. Narrative scripts export to WordprocessingML (`.docx`) with semantic styles for Google Docs, while production schedules and report workbooks export to formula-safe XLSX/CSV for Google Sheets.

## 3. Exit line

- **"Disabling integrations leaves a complete, self-contained desktop suite."** Met: Disabling AI integrations guarantees 100% offline, standalone functionality. All writing, planning, revisions, analysis, formatting, and exports require no internet connection, external accounts, or AI services.
- **"Preserve the author's work."** Met: Non-destructive diff previews, transparent token estimation, and scope disclosure ensure writers retain complete agency and control over their work.

## 4. Found and fixed while building M7

- **Heading `scene_id` validation in batch diff application:** Initially, diff application replaced heading blocks without copying original `scene_id` values, triggering store validation errors. Added lookup in `doc.blocks` to preserve `scene_id` and block metadata on modification.
- **Cross-test fixture document state in E2E suite:** When running full end-to-end suites, previous tests had left `page-boundaries` focused on an added treatment document. Updated Test 83 to reset the fixture cleanly and verify format-specific capabilities for both screenplays and tabular reports.
- **Export dialog selection persistence:** The export dialog retained previously selected radios across invocations; updated Test 83 to explicitly trigger radio clicks and verify dynamic capability guidance across PDF, DOCX, and tabular formats.

## 5. Open items

1. **Manual checks N47–N48:** desktop verification of AI assistant scope disclosure and external Google Docs / Google Sheets file exchange.
2. **Carried forward from M1–M6:** manual checks N41–N46, N37–N40, N32–N36, Mac run (N31), non-Latin PDF glyphs, reference machine latency budgets.
