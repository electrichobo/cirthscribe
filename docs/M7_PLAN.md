# Milestone 7 Plan: Optional Integrations

Proposed 2026-10-30.

Milestone 7 introduces optional integrations for Kolbítar while strictly preserving its offline-first foundation. As defined in `ROADMAP.md` and `PRODUCT_SPEC.md` §8, all integrations are disabled by default, require explicit user opt-in, and never make unsolicited network connections or transfer manuscript data without transparent scope disclosure and diff acceptance.

## Core Rules for Milestone 7

- **Disabled by default & zero unsolicited network traffic:** The application remains 100% functional offline without accounts or internet. Disabling integrations leaves a complete, self-contained desktop suite (`ROADMAP.md` M7 exit line).
- **Bring-Your-Own-Model / Endpoint:** Users provide their own API keys or configure local endpoints (e.g. Ollama, llama.cpp, LM Studio, vLLM, or custom OpenAI-compatible local runners). No built-in paid AI subscriptions or proprietary cloud dependencies.
- **Explicit Scope Disclosure & Provenance:** Every AI request displays the target provider, model, estimated tokens, and exact payload scope (selection, current scene, entire document, or bible). Derived facts and suggestions carry explicit provenance metadata (`source: "ai"`, timestamp, model).
- **Non-Destructive Diff Preview:** AI suggestions are presented in an editable diff preview. The user reviews and accepts/rejects changes per block. The AI engine can never directly commit database mutations or overwrite manuscript text without user approval.
- **Cancellation, Timeouts & Stale-Version Safety:** All network/inference tasks support clean user cancellation, configurable timeouts, and reject stale batches if the underlying manuscript version changed during generation.

## Steps

1. **AI Provider Architecture, Configuration & Secret Management.**
   - Data model in `cirth_core::ai`:
     - Provider types: `LocalOpenAiCompatible` (Ollama, LM Studio, etc.), `OpenAi`, `Anthropic`, `CustomEndpoint`.
     - Settings stored per user/project: endpoint URL, model name, temperature, max tokens, timeout.
     - API keys stored in local secure settings (never exported or checked into `.cirth` packages).
   - Core HTTP client abstraction with streaming response parsing, timeout handling, and cancellation flags.
   - Core unit tests for payload building, URL resolution, and provider configuration.

2. **Scope Disclosure, Prompt Templating & Non-Destructive Diff Model.**
   - `AiScope` definition: `Selection`, `Block`, `Scene`, `DocumentSummary`, `ProjectBible`.
   - Structured prompt builders for standard writing tasks with system instructions enforcing screenplay formatting rules.
   - Diff generation: Word-level and block-level diff comparison engine (`cirth_core::ai::diff`) showing added, removed, and modified blocks.
   - Tauri IPC commands for testing connection, estimating payload tokens, and inspecting scopes.

3. **Analytical & Organizational Assistants.**
   - Scene summary and logline generator: Generates beat summaries and loglines directly from scene action/dialogue with one-click acceptance into scene cards.
   - Bible candidate extractor: Proposes character profiles, traits, and location descriptions with source scene references.
   - Continuity assistant: Scans scenes for temporal, prop, or costume discrepancies across script sequences.

4. **Interactive Generative Writing Tools & UI Dialog.**
   - Generative operations:
     - `Paraphrase`: Rephrase dialogue or action lines while keeping dramatic intent.
     - `Expand`: Add sensory details, pacing beats, or subtext.
     - `Shorten`: Condense verbose action or tighten dialogue exchanges.
     - `Custom Instructions`: User-specified prompt applied to the authorized scope.
   - UI Assistant Dialog (`app/src/aidlg.ts`):
     - Scope disclosure banner and token estimator.
     - Live progress indicator with cancellation button.
     - Side-by-side diff preview (`Original` vs `AI Suggestion`) with "Accept Change", "Reject", and "Edit Before Applying".
   - Automated E2E verification test in `app/tests/e2e/suite.mjs`.

### Built (Steps 1–4, 2026-10-30)

- Domain model & diff comparison engine in `crates/cirth-core/src/ai.rs`:
  - `AiProviderType`: `LocalOpenAiCompatible` (Ollama, LM Studio), `OpenAi`, `Anthropic`, `CustomEndpoint`.
  - `AiConfig`: enabled toggle (default `false`), endpoint URL, model name, API key, temperature, max tokens, timeout.
  - `AiScopeKind`: `Selection`, `Block`, `Scene`, `DocumentSummary`, `ProjectBible`.
  - `AiTask`: `SummarizeScene`, `GenerateLogline`, `ExtractBibleCandidates`, `Paraphrase`, `Expand`, `Shorten`, `CustomInstructions`.
  - `AiPayload`: transparent request payload with system/user prompts, estimated token count, and scope disclosure text.
  - `AiDiffBlock` & `DiffStatus`: non-destructive block diffs (`Unchanged`, `Added`, `Modified`, `Removed`).
  - Unit tests in `cirth_core::ai::tests` verifying token estimation, scope disclosure prompt building, and diff comparisons.
- Tauri IPC commands in `app/src-tauri/src/main.rs`:
  - `ai_get_config`, `ai_set_config`: persisted in working store settings under `ai:config`.
  - `ai_prepare_payload`: inspects active document/scene/selection and bible context, generates transparent payload and token estimate.
  - `ai_compute_diffs`: computes side-by-side block diffs without modifying store.
  - `ai_apply_diffs`: applies user-accepted diffs with versioned batch transaction and heading `scene_id` preservation.
- Front-end assistant dialog in `app/src/aidlg.ts` and `app/src/main.ts`:
  - Provider configuration (URL, model, API key, enable toggle).
  - Task selector (summaries, loglines, extraction, rewriting).
  - Scope disclosure banner and token estimator.
  - Diff preview container with colored status badges.
  - "Accept Changes", "Reject / Clear", and "Close" controls.
  - Exposed on `window.__cirth.ai` and accessible via `ai_tools` menu command.
- Automated E2E Test 82 in `app/tests/e2e/suite.mjs`:
  - Verifies off-by-default initial state, transparent scope disclosure, non-destructive diff computation, dialog workflow, accepted diff application, and cleanup back to disabled state.
  - Verified on CDP (82/82 passed) and WebDriver (81/81 passed, 1 expected IME skip).

5. **Cloud Sharing & Google Workflow Compatibility Adapter.**
   - Export capability analysis for Google Docs (.docx) and Google Sheets (.xlsx / .csv).
   - Sharing workflow documentation and lossless roundtrip guidance (`docs/INTEROPERABILITY.md`).

6. **Compatibility Matrix, Automated Verification & Milestone 7 Exit Review.**
   - Automated test suite execution (`cargo test -p cirth-core`, contract tests, license notices, CDP and WebDriver E2E suites).
   - Update `docs/COMPATIBILITY.md`, `docs/testing/MANUAL_CHECKS.md`, author `docs/m7/EXIT_REVIEW.md`.

## Decisions Needed from the Owner

- **A. AI Network Client in Core vs App-Shell:**
  - *Option 1 (App-Shell / Tauri HTTP Plugin / Fetch):* Front end handles HTTP requests using standard fetch / Tauri HTTP API, while Rust `cirth-core` provides pure payload construction, diffing, and domain mutations. This keeps `cirth-core` free of networking dependencies (like `reqwest`).
  - *Option 2 (Rust Core with reqwest):* Add `reqwest` to `cirth-core` for server-side HTTP calls. (Requires owner approval for new Cargo dependencies per AGENTS.md).
  - *Recommendation:* Option 1 keeps `cirth-core` strictly pure and network-free per Engineering Rules, utilizing standard Tauri IPC commands and desktop fetch.
