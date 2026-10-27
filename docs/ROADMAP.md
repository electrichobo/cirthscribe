# Roadmap and exit gates

Milestones are capability gates, not delivery-date promises. Finish a stable slice before expanding scope. Each gate records platforms tested, remaining defects, fixture versions, and dependency licenses.

## M0: Feasibility and framework decision

Deliver a small editor/layout spike, not a full application:
- Canonical scene/block IDs, basic typed blocks, contextual Tab/Enter.
- Selection, paste, undo/redo, Unicode/IME checks.
- Save/reopen and crash-recovery proof.
- The same scene shown in editor, navigator, and a linked card.
- Long screenplay fixture, dialogue splits, dual-dialogue layout proof, PDF prototype.
- A concrete proposed native schema/container.
- Dependency/font/license inventory and measured stack decision.

Suggested initial performance budgets, to validate rather than advertise: a 120-page synthetic screenplay, p95 input-to-paint below 50 ms in the reference environment, warm open below 3 seconds, and no visible main-thread pauses during autosave. Record hardware, OS, versions, sample method, and results. Change targets only with a documented reason.

Exit: record accepted stack and critical risks. If only one OS was available, record the others as untested and make their verification part of M1. Do not pretend one-platform results establish full support.

## M1: Dependable writing foundation

- Working app shell and keyboard-first screenplay editor.
- US feature-screenplay profile, Letter/A4 controls, project tree, stable IDs.
- Create/open/save/save-as, autosave, undo/redo, recovery, backups, migration guards.
- Find/replace, character/location suggestions, block/selection/document word counts.
- Local spell-check and user dictionary.
- Independent workspace Free Writing.
- Native project package and TXT export.
- Accessible panel/focus behavior and draft page preview.

Exit: a user can write and safely recover a complete screenplay. Editing smoke tests pass on Windows, Mac, and Linux. No unresolved corruption/data-loss defects.

## M2: Layout, interchange, and production baseline

- Authoritative pagination/PDF output with licensed bundled font strategy.
- Title pages, dual dialogue, continuation rules, headers/footers, page breaks.
- Scene numbers, omitted scenes, revision sets, locked production pages.
- PDF, FDX, DOCX, RTF, TXT, and HTML document exports with capability reports.
- FDX import as a practical interchange priority; explicit scope for unsupported features.
- Verified fixture exchange and baseline compatibility matrix.

Exit: locked-page editing and PDF rendering pass boundary fixtures. Imports do not silently discard content. External editor/Google results are labeled by actual tests, not assumed from file extensions.

## M1b: Writing workspace (accepted by the owner 2026-10-26)

Jared raised these after the M1 feature work, which so far covered only the script window. Each is recorded here so nothing is lost. The owner accepted M1b as proposed and chose font option A(1). Decisions B and C are still open. Build order: focus mode and the View menu and panel toggles first.

**M1b, "writing workspace"** (after M1's exit, before M2; the app shell around the editor):
1. **Focus mode:** full screen with only the script page. Everything else is hidden; one key or Esc returns. This is the spec's "distraction-reduced mode", which no milestone covered. **Built 2026-10-26:** View > Focus Mode, the toolbar's View dropdown, or Ctrl/Cmd+Shift+F. The window goes full screen; on Windows and Linux the menu bar is hidden too. Escape, the same menu item or going Home leaves, and leaving full screen from the OS ends it. Not stored.
2. **View menu and a panel toggle:** show or hide the scene list, board, toolbar and status line from View, and from a toolbar dropdown like the "View" options in Windows File Explorer. Choices persist per user, not per project. **Built 2026-10-26:**
   - Native View menu check items: Scene List, Board, Toolbar, Status Bar.
   - A toolbar "View ▾" dropdown with the same items, keyboard-operable.
   - Hidden panels take no space.
   - Choices are stored in `preferences.json` and survive a hard kill.
   - The toolbar's page-layout dropdown is now labelled "Page view".
3. **Everything in the menus:** File, Edit, View, Format, Help on every OS (the macOS app menu as well), covering save, export, Free Writing, Home, undo/redo, cut/copy/paste and formatting. The toolbar becomes an optional shortcut, never the only route. **Built 2026-10-26:** the same menus on Windows, Linux and macOS (which also keeps its app menu).
   - File: New Project, Open, Save, Save As, Export (PDF proof, Plain Text), Free Writing, Close Project, Quit (in the app menu on macOS).
   - Edit: Undo, Redo, the OS's own Cut, Copy, Paste and Select All, Find and Replace, and Spelling (Suggestions; US, UK or Off, with a check mark).
   - View: as built in item 2.
   - Format: Bold, Italic, Underline; Block Type (all nine, in Ctrl/Cmd+1–9 order); Dual Dialogue; Page Break Before; Page Size (Letter or A4, with a check mark).
   - Help: Typing Latency, plus About on Windows and Linux.
   - Labels show the keyboard shortcut.
   - Check marks follow the open document and the toolbar.
   - The toolbar's buttons stay until the island toolbar (item 4) replaces them.
4. **Island toolbar:** compact floating groups rather than a full-width bar. Story Architect is the reference for layout ideas only; no copying of its look or assets. **Built 2026-10-26 (first pass, text labels until the icon set exists):**
   - Islands: Project (Home, title, Free Writing, Save), Format, View (View ▾, page view, zoom), Document (page size, spelling), and save status.
   - Save As and Export are in the File menu only.
   - The "Board may reorder script" switch moved onto the board.
5. **Format controls in the toolbar:** bold, italic, underline (already in the editor, with no buttons yet), text colour, highlight colour, and font and size (see decision A). **B, I and U built 2026-10-26:**
   - Block-type dropdown and B, I, U buttons show the state at the caret (pressed or not).
   - Using them keeps the selection and focus in the script.
   - Colour, highlight and screen font/size are still to do.
6. **Add comment button:** see decision C.
7. **Scene cards as planning cards:** each card shows the scene's **logline** (one line, authored) and the **summary** (authored, exists). The live excerpt of script text is removed, so cards are no longer a copy of the scene. Needs a schema change (a logline field on beats, migration v3) and replaces acceptance B1's "live excerpt" wording.

**M3, made explicit:**
8. **Corkboard and mind map as an evidence board:** cards (scenes, beats, characters, notes, images) linked by visible "strings": typed, labelled connections the writer draws. Moving a card never reorders the script unless the structural permission is on.
9. **Beat / pacing board:** a lane of beats that the writer divides into acts wherever they choose, any number of acts. Optional starting structures (for example three-act or five-act) use generic names, not trademarked methods. It shows pacing (beat position against estimated page or time, labelled as an estimate). It links to scenes the same way cards do.

**Decisions needed (they affect data and pagination):**
- **A. Fonts.** Screenplay pages are fixed-pitch Courier Prime 12 pt, and page count depends on it. Options:
  - (1) Font and size change only how the script looks on screen; pages and exports stay standard. **Chosen by the owner 2026-10-26.**
  - (2) A per-document font that also changes pages and exports. This breaks the one-page-per-minute convention and needs bundled, licensed fonts.
  - (3) (1) for screenplays, plus free font choice in non-screenplay documents (M6 rich text).
- **B. Colours.** Should text colour and highlight print in PDF exports, or show on screen only (writer's markup)? Either way they are stored as marks with stable meaning, never as the only signal: the rule "colour cannot be the only identifier" applies. Plain text cannot keep them, and FDX keeps them only partly; the export reports say so.
- **C. Comments.** Anchored comments are M5 (anchors that survive edits, moves and splits; orphans; threads). Options: (1) keep M5 and give the button a basic slice early: a comment on a selection, anchored by block id and text offsets, with a side list; or (2) move all of M5's comment work forward. Option (1) needs the anchor design now, which ROADMAP already asks for ("Comment and branch anchors must be designed earlier").

## M3: Connected story development

- Nested episodes and mixed document containers with shared bible.
- Navigator, hierarchical outline, notes/bookmarks.
- Corkboard and mind map, images/video links.
- Permission-controlled bi-directional scene ordering.
- Independent chronological story timeline.
- Character/location/world profiles and aliases.
- Non-AI bible extraction/refresh with provenance and review.

Exit: cards, navigator, script, chronology, and bible stay consistent after edits and undo. No duplicated scene prose or accidental reorder.

## M4: Production analysis and stripboard

- Range/entity tags with correction controls.
- Independent character, scene, location, prop/category, and revision reports.
- Vertical stripboard and independent scheduling order.
- Page/eighth calculations tied to a stated layout/scope.
- Character participation charts with honest timing labels.
- PDF/RTF/HTML reports; PDF/HTML stripboards.
- XLSX and CSV/TSV for tabular reports/stripboards.
- Google Docs/Sheets compatibility-profile testing.

Exit: each report works independently; manual schedule data survives script changes; charts and reports agree on selected branch/scope.

## M5: Review, alternatives, and branches

- Anchored local comment threads, inline/side-panel presentation, resolved/orphan behavior.
- Non-destructive alternatives with one explicit active selection.
- Named snapshots, visual branch history, compare/restore.
- Base/source/target integration with conflict review.
- Branch-aware bible facts, reports, page baselines, comments, and schedules.
- Optional portable review package before online services.

Exit: conflicting changes never disappear silently. Branches and alternatives survive native save/export/reopen without affecting unrelated work.

Comment and branch anchors must be designed earlier even though the full UI ships here.

## M6: Additional formats and language tools

- TV and UK profiles, stage plays, comics/graphic novels.
- Immersive passages/choices with valid references and format-specific exports.
- General rich-text documents and improved visual input forms.
- Offline-capable grammar adapter, dictionaries, correction UI.
- Format-specific templates and separate acceptance fixtures.

Exit: each advertised format has an actual structured editor, export behavior, and tests. A label in a template menu does not count as support.

## M7: Optional integrations

- Bring-your-own AI provider/local endpoint.
- Organizational/analytical suggestions first; user-enabled generative tools later.
- Scope disclosure, credentials, diff review, cancellation, stale-result checks.
- Optional Google review/share workflow explored separately.
- Any live collaboration requires an ADR and explicit consistency model.

Exit: disabling integrations leaves a complete offline app. No unsolicited network requests or hidden manuscript transfer.

## First usable release versus full scope

M1 can be a private alpha for writing. Do not call it a full professional replacement.
A production-focused public release needs M2's pagination/interchange gate and packaging checks.
The full requested feature set extends through M7. No date estimate is credible until the editor/layout spike has measured the largest risks.

## Every milestone's definition of done

A real usable workflow, relevant tests, documentation/status updates, recoverable data changes, honest unsupported-feature messaging, dependency/license checks, and evidence for each claimed platform.

