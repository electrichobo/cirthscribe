# Proposed architecture

Status: provisional until milestone 0. These are design requirements and proposals, not installed dependencies or implemented services.

## 1. Framework selection

Preferred hypothesis: Rust + Tauri 2, TypeScript UI, a structured editor such as ProseMirror, and a small domain core. Choose the UI framework during the spike based on integration evidence and maintainability, not novelty.

Tauri hosts a web UI using platform WebViews. Rust is suitable for persistence, validated domain operations, parsing, export orchestration, and background analysis. The editor still needs a TypeScript/JavaScript layer unless an alternative is demonstrated.

Avalonia/C# is a valid alternative if a freely buildable editor and pagination stack perform better. Avalonia's current vendor rich-text editor is a Pro component. The framework being open source does not make every control free. AvaloniaEdit is worth evaluating as a text-editor component, but a code editor is not automatically a paginated WYSIWYG screenplay editor.

Do not implement duplicate production apps to compare stacks. Start with the preferred stack. If a blocking risk appears, build only the smallest competing experiment needed to compare that risk.

### Decision evidence

Record exact framework/editor versions and:
- Selection, composition/IME, dual dialogue, clipboard, undo, long-document editing.
- Page layout, font metrics, PDF generation, and production locking feasibility.
- Accessibility, keyboard focus, high DPI, and platform packaging.
- Free build/redistribution rights for code, fonts, dictionaries, and export components.
- Domain/UI separation and contributor maintenance burden.
- Actual Windows/macOS/Linux results; list untested platforms explicitly.

A successful static web mockup is not evidence that editor behavior or cross-platform printing works.

## 2. Layers and ownership

1. Domain model and commands: stable IDs, invariants, document structures, branches, revisions, tags.
2. Editing adapter: maps editor transactions to domain changes and domain changes back to views.
3. Derived projections: navigator, boards, bible occurrences, reports, timelines, stripboards.
4. Layout service: shaping/measurement, pagination, continuation rules, production page maps.
5. Persistence: transactional storage, recovery journal/checkpoints, migrations, portable packages.
6. Format adapters: external input/output, capability descriptions, loss reporting.
7. Optional integrations: grammar services, AI, review/cloud.

One authoritative transaction stream changes the active project state. Derived views may cache results but never become an independent manuscript.

Not every keystroke needs a synchronous Rust round trip. The editor can hold an optimistic working projection, batch validated operations, and reconcile at version boundaries. The design must establish one commit sequence and coordinated undo semantics, not two undo stacks fighting each other. Persist operation batches promptly and expose unsaved status truthfully.

## 3. Core entities

| Entity | Key responsibilities |
| --- | --- |
| Workspace | App settings, recent projects, independent free writing; not a universal manuscript database |
| Project | Root identity, nested tree, shared bible, assets, schema version |
| Container | Folder/series/season grouping; parent relation must be acyclic |
| Document | Kind, profile, stable ID, ordered content for a selected branch |
| Scene | Stable ID, typed heading metadata, ordered blocks, story links |
| Block | Stable ID, type, inline content/marks, optional structural child relationships |
| OutlineNode | Hierarchy, summary, label, optional links to scenes/blocks |
| StoryEvent | Independent chronology, time/uncertainty metadata, links to scenes |
| BibleEntity | Character/location/world/prop, authored fields, aliases and scoped facts |
| Occurrence | Derived reference to a source scene/block/range and source version |
| Tag | Category/entity reference, anchored range, manual/proposed status |
| CommentThread | Stable anchor, quoted context, replies, status, branch context |
| RevisionSet | Label/date/color/mark and references to baseline/change scope |
| PaginationBaseline | Frozen profile/fonts/layout version, labeled page-boundary anchors |
| Snapshot/Branch | Parent/base IDs, immutable checkpoint, active branch state |
| AlternativeGroup | Competing content choices and explicit active selection |
| Schedule/Strip | Scene references, independent order, manual notes/day markers |
| Asset | Content ID/hash, media type, relative location or external URL |
| ReportRequest | Report type, filters, scope, source version and export settings |

Use UUIDs or another documented stable scheme. Never use scene numbers as keys. Entity names are editable labels. Alias matching must support deliberate disambiguation.

Spell out the schemas for scene headings, dual-dialogue pairs, comic pages/panels, and immersive passages/edges before those features ship.

## 4. Commands and derived data

Suggested commands include CreateScene, MoveScene, UpdateBlock, ChangeBlockType, LinkBeat, MoveStoryEvent, SetActiveAlternative, LockSceneNumbers, LockPages, OmitScene, AddTag, AddComment, and ApplyProposedChanges.

Each command carries relevant project/document IDs, expected base version, and a transaction ID. Compound moves/renames are atomic and undoable as one action. Validate references and structural invariants before commit. No loops in "board changed -> script changed -> board changed" callbacks.

Example: MoveScene(sceneId, afterSceneId) updates canonical script order. The navigator and linked board reflect that result. MoveStrip(stripId, afterStripId) changes only schedule order.

Entity discovery and reports run against a consistent branch/snapshot. Cache keys include project, branch, content version, scope, settings, and engine version as needed. A result from an earlier version must not silently replace the current view.

Authored facts are never recomputed away. Derived lists are replaceable caches. Suggested facts carry pending/accepted/rejected state and evidence.

## 5. Range anchors

Use block IDs plus logical offsets and explicit insertion affinity, with transaction mapping across edits. Specify offset units at every boundary, especially JavaScript UTF-16 versus Rust Unicode indexing.

Do not persist pixel positions, DOM node paths, or raw page coordinates as text identity. Preserve original quote/context for orphan recovery. Define behavior for split/join, cut/paste, moved scenes, omitted content, alternatives, and branch forks.

Importing a plain external document generally cannot recreate original IDs or thread anchors. Reattachment is a previewed reconciliation process, not exact identity based on matching text alone.

## 6. Persistence and native format

Proposed working implementation: local transactional store, with SQLite as the first candidate, and a user-portable .cirth package. Final container decision belongs to milestone 0.

Requirements:
- Open/versioned schema; native export retains every CirthScribe feature.
- No credentials or machine-specific absolute paths inside a portable package.
- External links remain explicit references; optional local assets are packaged by policy.
- Atomic checkpoints and temp-write/rename for package replacement.
- Recovery journal/checkpoint adequate for crash recovery; no need for complete event sourcing initially.
- Consistent database snapshot when packaging; never copy a live SQLite main file while ignoring its WAL.
- Migration backup before changes; reject unknown future schemas safely.
- Detect concurrent writers and externally changed files. Preserve both versions after a sync conflict.
- Validate archive paths, decompression sizes, file types, hashes, and references.
- Backups and free-writing recovery remain usable without cloud services.

Do not write to a cloud-synced open database and treat that as collaboration. A read-only second window or explicit clone is safer than two uncoordinated writers.

Branching initially can use immutable snapshots plus structured change records. Full Git object storage, distributed merging, and CRDTs are not prerequisites.

## 7. Pagination and print

This is a first-class engineering risk, not a final styling task.

Define authoritative layout inputs: page dimensions, margins, embedded/licensed fonts and fallback policy, text shaping/metrics, line spacing, block rules, continuation markers, headers/footers, and layout engine version.

Draft pagination flows with text. Production pagination references a frozen baseline: stable page labels, insertion/deletion rules, A/B pages, omitted-page treatment, and changed-page selection. Locking freezes the page-label/boundary scheme, not the writer's ability to edit.

PDF export must consume the authoritative page map. If a separate renderer is used, prove agreement with the layout service. OS WebView print-to-PDF alone is not a cross-platform fidelity guarantee. A browser-computed page map that silently changes on another OS is unacceptable for locked production scripts.

Use identical supported font/layout inputs for cross-platform comparisons. Detect missing fonts rather than silently treating substituted output as equivalent. Persist baseline engine/font metadata and require a previewed migration for incompatible changes.

DOCX, FDX, and Google Docs have their own layout behavior. Export semantics and document their reflow limits; do not force a screenshot into editable formats to claim fidelity.

## 8. Integrations and trust boundaries

External imports/media/comments are untrusted input. Disable XML external entity resolution, sanitize HTML/URLs, escape rendered/exported text, and restrict archive extraction. Prevent formula injection in tabular exports. Remote media cannot invoke desktop commands.

Tauri capabilities or the Avalonia equivalent should expose only required filesystem/command scopes. Avoid arbitrary shell execution from UI content.

Store API tokens in OS secret storage. Restrict remote requests to configured providers, use cancellation/timeouts, and redact manuscript text and tokens from diagnostics. Local project text passed to AI is content, never instructions to change tool permissions.

Cloud review is an adapter with explicit identity, permissions, conflict, and revocation rules. A later CRDT/OT decision must account for scene moves, branches, revision baselines, and comment anchors. Do not promise those semantics from a folder-sync service.

