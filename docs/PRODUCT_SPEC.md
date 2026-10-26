# Product specification

Status: proposed requirements. Nothing in this document is an implementation claim.
Owner: Jared Hoy. Working title: CirthScribe.
Scope: free/open-source desktop application for Windows, macOS, and Linux.
Reference products identify liked behaviors, not a requirement to reproduce proprietary internals.

## 1. Product principles

Writing comes first. A writer can install, create a project, write, save, revise, and export without an account, network connection, or AI. Planning and production tools remain close to the manuscript without crowding the writing view.

Projects support nested containers such as universe > series > season > episode > draft document. Users choose their hierarchy; these example labels are not mandatory levels. A project can contain screenplay, stage-play, comic, immersive-story, and prose documents sharing one bible.

Workspace-level Free Writing exists independently of projects. It supports folders, search, autosave, and export. A user can explicitly move or copy a free-writing document into a project with provenance; it is never implicitly attached to the last open project.

## 2. Screenplay editor and formatting

### Formats

Required end state:
- Standard feature screenplays.
- Television: single-camera, multi-camera, and custom show templates.
- Stage plays.
- Graphic novels and comics with explicit page/panel structures.
- Immersive storytelling with linked passages, choices, and conditions.
- General rich-text and plain-text documents.

US screenplay formatting is the initial primary profile. UK profiles are secondary and configurable. "UK format" is not treated as one universal layout. Separate paper size, spelling locale, typography, and template conventions. Letter/A4 changes must not silently select a different spelling dictionary.

The first shipping editor targets screenplays; later formats use dedicated schemas/profile extensions rather than pretending everything is an ordinary screenplay paragraph.

### Block types and behavior

Screenplays include scene heading, action, character cue, dialogue, parenthetical, transition, shot, section/act marker, lyric/custom block, and dual dialogue. A scene groups its blocks. A multi-line speech is not stored as a visual line per block.

Tab changes the block type contextually, inspired by Final Draft. Shift+Tab reverses the applicable cycle. Enter creates the expected next block. Suggested initial transitions: heading -> action, character -> dialogue, parenthetical -> dialogue, transition -> heading. Exact cycles are configurable and tested for empty/nonempty blocks, selections, and autocomplete.

Tab never inserts space characters to simulate alignment. Provide an accessible alternative command and a way to leave the editing region by keyboard.

Include autocomplete for known characters, locations, and headings, configurable continuation markers, scene navigation, find/replace, selection statistics, and per-block word count. Define word-count rules consistently across editor, reports, and exports.

### WYSIWYG

Editable pages should closely match authoritative PDF output. A continuous/draft view is also useful. Distinguish screen UI elements from print content. Comments, controls, spelling underlines, and selection are not manuscript text.

Long dialogue splits correctly with continuation behavior. Keep cues and parentheticals with following dialogue, honor scene-heading keep-with-next, and support dual dialogue, explicit page breaks, headers/footers, and title pages. Zoom never changes pagination.

Spell checking supports US/UK English, project names, user dictionaries, ignored words, and undoable replacements. Grammar checking is available through an offline-capable adapter when feasible; remote grammar services require separate opt-in. Grammar must not require generative AI. Distinguish genuine offline support from unavailable language packs.

## 3. Outline, navigator, corkboard, and timelines

Combine Story Architect-style planning with an MMS-inspired navigator:
- Hierarchical acts, sequences, scenes, beats, notes, and bookmarks.
- Search/filter by character, location, tag, thread, and note category.
- Drag/drop organization with keyboard alternatives.
- Navigator and manuscript scroll to each other's selected scene.
- Corkboard cards with summaries, labels, color, images, and video-link references.
- Freeform mind/brain map with typed, labeled relationships.
- Presentation views without changing document content.

A freeform planning beat can exist before a corresponding scene. Explicitly link it to an existing scene or create a new scene. A scene may have several beats; moving one beat does not create another scene.

### Bi-directional behavior

Canonical scene content and order have one identity. A linked card displays metadata and optionally a live read-only excerpt of the scene.

Permission settings are scoped to a document and persist:
1. Link navigation/metadata only, the safe default.
2. Permit linked structural edits, including changes to canonical scene order.
3. Optional explicit batch operations with a preview.

When structure permissions are off, board movements affect the planning layout only and show a "planning only" indicator. They do not create a secret competing script sequence. Applying an arrangement to script order is a separate explicit command.

When permissions are on, a structural scene move changes the canonical order once, updates all views, and can be undone once. A beat summary and script prose remain separate authored fields. No summary edit overwrites dialogue or action.

Story order is the order the audience encounters scenes. Chronological order is an independent ordering of story events. Flashbacks, simultaneous events, uncertain dates, and scenes spanning several events must be representable. Dragging chronological events does not reorder manuscript scenes unless an explicit action requests it.

## 4. Characters, locations, worlds, and project bible

Offer fast character navigation and script-linked analysis, plus detailed profiles, relationships, biographies, reference images, locations, world facts, and flexible custom fields.

One shared project bible can serve every nested episode/format. Include scope-specific additions for a season, episode, or alternate continuity.

Automatic bible building works without AI:
- Extract known character cues, scene headings, aliases, locations, tags, and references.
- Offer candidates rather than blindly adding every uppercase phrase as a character.
- Record source document, scene/block ID, branch/snapshot, and last-seen version.
- Refresh derived occurrence lists automatically.
- Never overwrite authored descriptions, merge entities, infer canonical plot facts, or delete entries silently.
- Flag contradictions, missing references, and entities no longer mentioned for review.

A renamed character is one entity with aliases, not two characters. Renaming text throughout scripts is a previewed operation; do not automatically replace matching words inside unrelated action text.

Visual boards accept local images and user-supplied video URLs with labels. Store URL references and optional explicitly fetched previews. Do not download videos or load third-party content just by opening the project.

## 5. Revisions, locked production scripts, and alternatives

Support revision sets with labels, dates, colors, marks, author metadata, and printable revision headers. Color cannot be the only identifier.

Distinct operations:
- Lock scene numbers without changing scene identity.
- Lock a pagination baseline for a shooting script.
- Add/revise pages with suffix labels without cascading renumbering.
- Omit a scene while retaining its ID, number, history, comments, and restore option.
- Compare drafts, print changed pages, and export the active revision set.
- Keep alternate dialogue, blocks, scenes, and draft branches non-destructively.

Git-style experience means named branches, checkpoints, visual history, comparison, and explicit integration. Users never need Git installed or need to learn Git commands.

An alternative is not a revision color. Only one alternative is active for a given script location in a selected branch. Inactive alternatives do not contribute to active reports, word counts, bible occurrence counts, stripboards, or exports unless explicitly included.

A branch fork preserves the selected state of manuscript, scene order, numbering, revision baseline, bible facts, tags, and scheduling data. Snapshot/branch views are labeled clearly. Integration compares base/source/target, detects conflicts, and requires explicit resolution. Never silently concatenate conflicting dialogue or mix incompatible page-lock baselines.

Comments retain their branch context. Restoring a historical branch does not rewrite another branch.

## 6. Production breakdowns and reports

Tags reference exact script ranges and stable entities. Categories include cast, locations, props, costume, vehicles, sound, VFX/SFX, extras, stunts, and user categories. Users can correct proposed tags.

Each report is independently selectable, filterable, previewable, and exportable:
- Characters/cast and dialogue.
- Scene list and one-liners.
- Locations and sets.
- Props and each other tag category.
- Revision/changed-page report.
- Character participation and timing metrics.

Report scope includes selected documents/episodes, branch, snapshot/revision, scenes, and inclusion of omitted content. Reports identify their source version and whether they are stale. Regeneration must not overwrite manual annotations without retaining them separately.

### Vertical scene stripboard

Generate a vertical stack of scene strips from the script. Each strip includes scene number, INT/EXT, location, time of day, brief description, characters, page/eighth estimate, estimated duration when available, and tags as configured.

Distinguish script order from scheduling order. Dragging strips changes schedule order only. Include unscheduled strips and optional day breaks, banners, grouping, sorting, and color legends. Canonical screenplay edits refresh strip fields while preserving scheduling choices and user notes. Omitted/deleted scenes are visibly reconciled.

This is a scene-planning tool, not a full replacement for budgeting or professional scheduling software in the first release.

### Character "screen time"

Across selected episodes/project, show separately:
- Dialogue words/blocks and percentage of dialogue.
- Number of scenes containing a character, separating speaking from explicitly tagged nonspeaking presence.
- Estimated scene/character participation duration under a documented method.
- Manually entered measured character-on-screen intervals/durations, if supplied.

Do not infer actual visible screen time from a character name or divide scene time equally among the cast. Estimated dialogue reading time is not visible screen time. Participation durations can overlap and therefore exceed the film's runtime when added across characters. Handle aliases, dual dialogue, voiceover, offscreen speech, and inactive alternatives.

## 7. Notes and review

Comment threads attach to a block, text range, scene, or document. Support replies, edit history for comments, resolved/reopened state, author labels, categories, search, and filters.

Show threads inline, in an optional side panel, or both, with a quiet writing mode. Insertion/deletion moves anchors with the text. If referenced text is removed, retain the thread as orphaned with its original quote and a reattach action.

Offline local review is required first. File-based review packages may precede online integration. Google Docs-like live feedback is a later optional feature, not a promised effect of exporting DOCX or saving into a synced Drive folder.

## 8. Optional AI

Disabled by default; no mandatory onboarding, branding in the writing surface, or dependencies for core work. Users bring provider credentials or an endpoint, including compatible local endpoints.

Prioritize entity/tag proposals, bible organization, continuity questions, summaries, scene classification, translation, and organization. If the user enables generative writing tools, the target set includes paraphrase, expand, shorten, insert between passages, summarize, translate, and custom instructions.

Show provider/model, exactly which scope will be sent, and the expected operation. Initial permission can cover a defined task/session; do not repeatedly interrupt within that authorized scope. Broader context or background uploads require renewed opt-in.

Return suggestions with source references and an editable diff. Accept/reject per change; acceptance enters normal undo/history. Validate structured outputs and retain authorship. AI cannot directly commit domain mutations or resolve story facts automatically. Handle unavailable providers, cancellation, timeouts, and stale source versions without data loss.

## 9. Export, usability, and boundaries

Required document formats: native project, DOCX, FDX, PDF, RTF, TXT, HTML.
Required report formats: PDF, RTF, HTML.
Required stripboard formats: PDF, HTML.
Add XLSX and CSV/TSV for tabular reports and stripboard rows to meet the requested Google Sheets workflow. Fountain import/export is a useful proposed addition, not a prerequisite for every initial milestone.

See INTEROPERABILITY.md for fidelity and Google tests. Preserve the strongest supported semantics; never silently discard unsupported features.

Provide resizable panels, keyboard shortcuts, undoable drag/drop, clear save status, readable dark/light themes, adjustable UI scale, high contrast, screen-reader labels, and a distraction-reduced mode. Do not put implementation terminology into ordinary writing workflows.

Initial non-goals: mandatory web service, mobile clients, built-in paid AI, full budgeting, video editing, automatic measured screen time from footage, and copying another app's visual identity.

