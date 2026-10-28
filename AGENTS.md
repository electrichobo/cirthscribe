# Kolbítar: instructions for coding agents

Kolbítar is a free, open-source, offline-first desktop writing and production application for Windows, macOS, and Linux. It combines screenplay editing, story planning, a shared project bible, and script-derived production tools. The project file extension stays `.cirth`; internal crate names (cirth-core) and the app identifier keep the older working name.

This repository currently contains a planning pack, not an implemented application. Never present a planned feature as working.

## Read before making changes

1. Read this file and docs/PRODUCT_SPEC.md.
2. Read docs/ARCHITECTURE.md and docs/ROADMAP.md.
3. For the task at hand, read docs/ACCEPTANCE.md and docs/INTEROPERABILITY.md.
4. Read existing code, applicable repository instructions, and current status before choosing an implementation.
5. Work on the earliest incomplete milestone unless the owner gives a different priority.

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
- Do not promise lossless export to formats that cannot express CirthScribe features.

## Stack policy

Provisional preference: Rust with Tauri 2, a TypeScript web UI, and a structured rich-text editor evaluated during milestone 0. Tauri is a desktop shell, not a screenplay editor or pagination engine.

C# with Avalonia remains an allowed alternative if the editor/layout spike demonstrates a material advantage. The framework decision is made once at milestone 0 and recorded with evidence. Do not build two complete apps, switch frameworks opportunistically, or add a second runtime speculatively. A later switch requires a documented reason and owner agreement.

The free Avalonia framework and premium Avalonia controls have different licensing. Do not assume its current rich-text editor or export components are freely redistributable/buildable. Audit any selected dependency and bundled font. Do not buy licenses or select the project's final open-source license on the owner's behalf.

## Engineering rules

- Keep domain logic independent of UI toolkit, editor-library internals, storage, AI providers, and cloud services.
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

## First task

Start with milestone 0, not the full feature list. Produce:
- a domain/schema sketch and dependency/license inventory;
- a runnable editing/layout risk prototype in the preferred stack;
- representative synthetic fixtures and measured findings;
- an architecture decision recommending Tauri or Avalonia;
- the next milestone's implementation plan.

Do not implement the complete product during the feasibility spike.


## Session Handoff Protocol

Several AI agents (Claude Code, Gemini CLI and others) may work on this repository in turn. `HANDOFF.md` in the repository root carries the working state between them.

- **At the start of every session**, read `HANDOFF.md` before making any change. Treat it as the latest state of the work. If it disagrees with the code or git history, trust the code and git, and correct `HANDOFF.md`.
- **Update `HANDOFF.md`**:
  - after completing a meaningful sub-task;
  - after an architectural decision (record lasting decisions in docs/DECISIONS.md or an ADR as well);
  - before any `git commit` or `git push`.
  Do not update it on trivial chat turns.
- Keep its four sections short and factual:
  - **Current Goal:** what is being built now.
  - **Completed & Verified:** what was done and how it was checked. Name the tests that actually ran.
  - **Assumed / Untested:** guesses, platforms not tried, manual checks still open.
  - **Next Immediate Step:** the next concrete action.
- Never claim a test passed unless it ran. Never put credentials or personal details (hostnames, IPs, usernames, personal paths) in it.
- `CLAUDE.md` and `GEMINI.md` only import this file (`@AGENTS.md`). Edit the instructions here, not there.
- A local `pre-push` hook (`.git/hooks/pre-push`, not versioned) warns when code changes are pushed without a `HANDOFF.md` update. It only warns; it never blocks a push.
