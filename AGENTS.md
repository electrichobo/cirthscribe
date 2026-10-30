# Kolbítar: instructions for coding agents

Kolbítar is a free, open-source, offline-first desktop writing and production application for Windows, macOS, and Linux. It combines screenplay editing, story planning, a shared project bible, and script-derived production tools. The project file extension stays `.cirth`; internal crate names (cirth-core) and the app identifier keep the older working name.

## Current stage (2026-10-30)

A working application, not yet released, plus its product brief. M0–M7 are closed (`docs/m7/EXIT_REVIEW.md`).
- M7 built optional extras: bring-your-own AI writing assistant (off by default), transparent scope disclosure, non-destructive diff engine, Google Docs/Sheets export workflows (`docs/M7_PLAN.md`).
- Carried (docs/m7/EXIT_REVIEW.md): manual checks N41–N48, N37–N40, N32–N36, the Mac run, external app tests.

Later milestones (ROADMAP.md) are only planned. Never present a planned feature as working. Open items are listed in STATUS.md and docs/testing/MANUAL_CHECKS.md.

## Read before making changes

1. Do the startup sequence of the Session Continuity & Constrained Takeover Protocol below. It covers START_HERE.md, HANDOFF.md, STATUS.md, the milestone plan and git state.
2. Read docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md and docs/ROADMAP.md.
3. Read docs/DECISIONS.md, and the ADRs in docs/adr/ when touching what they decide.
4. For the task at hand, read docs/ACCEPTANCE.md and docs/INTEROPERABILITY.md.
5. Read the existing code and its tests before choosing an implementation.
6. Work on the next unfinished step of the current milestone unless the owner gives a different priority.

The owner's latest explicit instructions override this pack. Keep documentation aligned with the final implementation. Record accepted technical decisions in architecture decision records. Label proposals, measured results, and unresolved decisions separately.

## Non-negotiable product behavior

- Core writing, planning, saving, revisions, analysis, and exports must work offline without an account or AI.
- Do not add subscriptions, feature paywalls, mandatory cloud storage, or mandatory paid development components.
- No manuscript uploads, telemetry, remote grammar checking, link previews, or AI requests without explicit user opt-in.
- Preserve the writer's work. Use recoverable transactions, atomic saves, backups, migrations, undo, and conflict detection.
- The script, board, navigator, timeline, bible, reports, and stripboard are related views of canonical data. Do not maintain competing copies of script text.
- Scenes, blocks, entities, comments, and outline nodes need stable IDs. Display numbers, page numbers, array positions, and text strings are not identities.
- Bi-directional structure changes require a permission toggle, explain their scope, and must be undoable. Editing a beat's summary never silently rewrites screenplay prose.
- Production page locking and scene-number locking are separate features. Preserve baseline pagination when revisions introduce A/B pages.
- All reports must be independently selectable and exportable.
- Label timing estimates as estimates. Character dialogue, presence in scenes, and actual time on screen are distinct metrics.
- AI is optional, user-configured, and secondary to writing. Never apply AI changes without a preview and acceptance.
- Do not promise lossless export to formats that cannot express Kolbítar features.

## Stack (decided)

Rust, Tauri 2 (desktop shell only), TypeScript, ProseMirror and SQLite. Accepted in ADR 0001 (docs/adr/0001-desktop-stack.md). The WebView never measures pages. Do not build a second app, switch frameworks or add a runtime without a documented reason and the owner's agreement.

- License: GPL-3.0-only with an attribution term (`NOTICE`), chosen by the owner.
- Fonts: pages and exports always use the bundled Courier Prime 12 pt (OFL); the editor's screen font is a display preference only.
- Dependencies: never add a crate (`Cargo.toml`) or an npm package (`app/package.json`) without the owner's explicit approval. Each license must be compatible with GPL-3.0-only. Record the addition in docs/m0/LICENSES.md (`node app/scripts/license-inventory.mjs`) and keep `node app/scripts/third-party-notices.mjs --check` passing. No paid or proprietary components.

## Repository map and commands

- `crates/cirth-core`: model, store, migrations, layout, numbering, revisions, locked pages, imports and exports. Tests in `crates/cirth-core/tests`.
- `app/src-tauri`: Tauri commands and native menus; builds the `cirthscribe` binary.
- `app/src`: the TypeScript UI (ProseMirror schema and plugins).
- `app/tests`: `contract.mjs` checks that the TypeScript and Rust data models agree; `e2e/suite.mjs` drives the real app through two drivers, Chrome DevTools (CDP) and WebDriver.
- `fixtures/`: sample scripts, plus `fixtures/golden/` reference page layouts.
- `docs/`: product brief, plans, decisions and ADRs, and manual checks (`docs/testing/MANUAL_CHECKS.md`).

On Windows, dot-source `scripts/dev-env.ps1` first; it puts the portable toolchain on PATH. Then:
- `cargo test -p cirth-core`: core tests.
  - `UPDATE_GOLDEN=1 cargo test -p cirth-core --test golden` regenerates the reference pages. Review the diff before committing.
- `cd app && npm run build`, then `cargo build -p cirthscribe --release`. The binary embeds the built UI, so always rebuild both, in this order, before e2e.
- `cd app && npm run test:contract`.
- `cd app && npm run e2e:cdp` and `npm run e2e:webdriver`. Set `E2E_ONLY=<test name prefix>` to run some tests only.
  - Under WebDriver, page scripts run one at a time. Never leave the page awaiting a dialog: start the action with `(__cirth.menu('x'), true)`.
- `node app/scripts/third-party-notices.mjs --check`.

Conventions:
- **Schema migrations** are append-only. Never edit a shipped migration. Each schema change freezes real project files of the previous version in `crates/cirth-core/tests/data`, with a test that upgrades them.
- **Keep the old working name internally:** the `.cirth` extension, crate names, the binary `cirthscribe` and the app identifier stay as they are. Only public-facing text says Kolbítar.
- **Writing:** match the surrounding code's comment density and idiom. Use plain, direct English in docs and UI.
- **File edits on Windows:** edit with tools that keep UTF-8 without a BOM. Windows PowerShell 5.1's `Get-Content`/`Set-Content` corrupts non-ASCII text.
- **Git:** commit or push only when the owner asks. Never put personal details (hostnames, IPs, usernames, personal paths) or credentials in committed files.

## Engineering rules

- Keep domain logic independent of UI toolkit, editor-library internals, storage, AI providers, and cloud services.
- Core/app boundary: `crates/cirth-core` owns the document model, the SQLite working store, the `.cirth` package, page layout and all imports and exports, and contains no UI code. `app/` (Tauri 2, TypeScript, ProseMirror) is only a view that sends versioned edits to the core.
- One authoritative persisted domain model. Editor state is a transaction-driven projection, not a second saved manuscript.
- All views submit domain commands with base-version checks. Invalid/stale commands fail safely or rebase explicitly.
- No replacement of the whole document on every keystroke, duplicate undo stacks, or permanent storage of DOM offsets.
- Support Unicode, composition/IME, paste, clipboard, undo/redo, and keyboard navigation before UI polish.
- Keep authored facts separate from extracted candidates and AI suggestions; every derived fact carries provenance.
- Save, import, export, analysis, and media processing must not freeze the editor.
- Use explicit format adapters and an export capability/loss report. Do not rename HTML as DOCX or text as FDX.
- Keep secrets in the OS credential store. Never place credentials in projects, exports, logs, or source control.
- Preserve unfamiliar imported content where possible; report unsupported structures instead of dropping them silently.
- Build original functionality using public references. Do not copy competitors' proprietary code, assets, branding, or trade dress.
- Prefer a small working vertical slice over broad placeholders. Do not mark mocked buttons or hardcoded reports complete.
- Do not introduce speculative services, microservices, collaboration infrastructure, plugins, or a full Git implementation.

## Delivery discipline

Before coding, state the current milestone, the concrete result, and the important assumption. Proceed through authorized routine work without repeated permission requests. Ask only for a decision that materially blocks progress.

For each change:
1. Inspect existing behavior and identify affected invariants.
2. Implement the smallest coherent working change.
3. Run relevant checks and meaningful tests, especially for data loss, structural editing, pagination, or interoperability.
4. Update status and decision records if behavior or scope changed.
5. Report what works, what was tested, and what remains incomplete. Never claim unrun tests passed.

Do not suppress errors, bypass tests, or silently reduce requirements. If a platform or external integration could not be tested, say so.

Each finished step updates its milestone plan's "Built" notes, README's progress list and, where a person must check something by hand, docs/testing/MANUAL_CHECKS.md. It is tested on both e2e drivers.

## Session Continuity & Constrained Takeover Protocol

AI agents take turns on this repository (Claude Code, OpenAI Codex, Google Antigravity or Gemini CLI, Qwen Code); all follow these rules every session. `CLAUDE.md`, `GEMINI.md` and `QWEN.md` only point here.

### 1. Startup sequence (read before writing)

At the start of any session, or when asked to "continue" or "pick up where we left off":
1. Read `START_HERE.md`, `HANDOFF.md`, `STATUS.md` and the current milestone plan (`docs/M4_PLAN.md`).
2. Inspect uncommitted work: run `git status`, `git diff` and `git diff --staged`.
3. **Stop and summarize** before modifying any file:
   - the uncommitted changes in the working tree;
   - the Next Immediate Step from `HANDOFF.md`;
   - your concrete plan for the next edit.
   Wait for the owner's confirmation if anything is ambiguous or a test is failing.

If `HANDOFF.md` disagrees with the code or git history, trust the code and git, and correct `HANDOFF.md`.

### 2. Constrained takeover rules

When taking over uncommitted work or an unfinished feature:
- **Do not rewrite working diffs.** Never refactor, restyle or replace a previous session's uncommitted code unless it fails `cargo test -p cirth-core` or breaks a spec in `docs/`.
- **Respect the core/app boundary** (see Engineering rules).
- **No unsolicited dependencies** (see Stack).
- **Verify with the existing suites:** `cargo test -p cirth-core`, and `cd app && npm run build` for the front end. Before a step is called done, also run the contract and e2e suites (see Repository map and commands).

### 3. Checkpoints in `HANDOFF.md`

Update `HANDOFF.md`:
- after any logical sub-task or passing test gate;
- after an architectural decision (lasting decisions also go in docs/DECISIONS.md or an ADR);
- before every `git commit` or `git push`.

Do not update it on trivial chat turns. Keep it under 50 lines, under four headings:
- **Current Milestone & Goal:** the step being built, from the milestone plan.
- **Completed & Verified:** what was done, with the checks that actually ran (`cargo test`, `npm run build`, e2e). A "Not verified" list holds open manual checks, untried platforms and known limits.
- **In-Progress / Uncommitted State:** the files currently modified and what state they are in.
- **Next Immediate Step:** the exact next function, test or file to touch.

No credentials or personal details in it. A local `pre-push` hook (`.git/hooks/pre-push`, not versioned) warns when code is pushed without a `HANDOFF.md` update; it never blocks a push.
