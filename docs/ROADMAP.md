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

**Closed by the owner on 2026-10-27** (docs/m2/EXIT_REVIEW.md). Carried into M3: the external app tests (the compatibility matrix is a baseline only), the Mac recheck, manual checks N20–N28 and the M1 carry-overs. Non-Latin PDF text is a reported limitation until a fallback font is chosen.

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
   - **Redesigned 2026-10-27 (owner, Story Architect-style reference):** one island centred over the script (it stays centred as side panels are shown or hidden).
     - On the island: Home, undo, redo; block type, B, I, U, text colour, highlight, screen font and size; scene-list and board toggles, find, focus mode.
     - A More (⋮) popover holds focus and typewriter mode, panel check items, page view, zoom, page size, spelling, Save and Free Writing.
     - Project title and save status moved to the status bar.
     - Temporary original icons (`app/src/icons.ts`) until the art set exists.
     - On narrow windows the island wraps onto a second row, ribbon-style.
     - A comments/review panel toggle joins the island when M5 builds comments; there is no placeholder button.
     - **Narrow windows (owner, 2026-10-27):**
       - When the page does not fit beside the side panels, they shrink (scene list 200 px, board 260 px).
       - If it still does not fit, they leave the layout and float over the script, opened from the island's scene-list and board buttons.
       - Escape, going back to the script, or the same button closes them.
       - Floating is temporary; the View menu's show/hide choice is unchanged.
       - The window's minimum size is 900 × 560.
5. **Format controls in the toolbar:** bold, italic, underline (already in the editor, with no buttons yet), text colour, highlight colour, and font and size (see decision A). **B, I and U built 2026-10-26:**
   - Block-type dropdown and B, I, U buttons show the state at the caret (pressed or not).
   - Using them keeps the selection and focus in the script.
   - **Screen font and size built 2026-10-27** (decision A1):
     - Fonts: Courier Prime, system monospace, serif or sans serif; size 10–20 pt.
     - Set from the toolbar's Format island or View > Screen Font, and stored per user.
     - Column widths are now in inches, so larger text wraps inside the page.
     - Pages view always shows Courier Prime 12 pt, so its breaks match the printed pages; the page map and exports never change.
   - **Text colour and highlight built 2026-10-27** (decision B: on-screen markup only):
     - Five text colours and five highlights, by palette name, from the toolbar or Format > Text Colour / Highlight.
     - Stored with the text (in the contract), undoable, kept by copy and paste inside the app.
     - Colours follow light, dark and contrast themes; in Windows contrast themes, marked text keeps a dotted underline or outline so colour is not the only sign.
     - The page layout never reads them, so the page map, PDF and text export are unchanged (core test and e2e).
     - Colours pasted from other apps are not taken over.
6. ~~**Add comment button:** see decision C.~~ **Moved to M5** (owner, decision C option 2, 2026-10-27): comments arrive with M5's anchored threads; no button in M1b.
7. **Scene cards as planning cards:** each card shows the scene's **logline** (one line, authored) and the **summary** (authored, exists). The live excerpt of script text is removed, so cards are no longer a copy of the scene. Needs a schema change (a logline field on beats, migration v3) and replaces acceptance B1's "live excerpt" wording. **Built 2026-10-26:**
   - Schema v3 adds `logline` to beats. Older files are upgraded on open with the original kept; tested against real v2 files frozen before the change (`tests/data/schema-v2-*.cirth`).
   - Cards show the linked scene's heading, an editable logline and the summary. The script excerpt is gone.
   - Keyboard: Enter on a card edits the logline, Enter again goes to the summary, Escape returns to the card.
   - The Rust/TypeScript contract includes the field.

8. **Typewriter mode** (owner, 2026-10-26): a View toggle, like focus mode, that keeps the line being typed at a fixed height (centred) in the window. The text scrolls up instead of the caret running down the page. It works on its own or together with focus mode, and the choice is stored per user. It changes the view only, never pages or exports. **Built 2026-10-26:**
   - On or off from View > Typewriter Mode, the toolbar's View dropdown, or Ctrl/Cmd+Shift+T.
   - The caret's line is kept at the middle after typing and keyboard movement, but not after mouse clicks, so the text never jumps under the pointer.
   - Extra space above and below the script lets the first and last lines reach the middle.
   - Stored in `preferences.json`.

**Dual dialogue across the app** (owner asked to make sure it is handled everywhere):

| Where | State |
| - | - |
| Editor: toggle (Ctrl/Cmd+D, Format menu), side-by-side display, caret moves left column then right | Built (M1) |
| Pagination, PDF proof, plain-text export | Built (M1); pairs taller than a page fall back to sequential speeches with a warning |
| Data model and Rust/TypeScript contract (`dual` flag on the right speaker's cue) | Built (M1) |
| FDX import/export (`DualDialogue` element), Fountain (`^`), DOCX/RTF/HTML | M2: must round-trip or be reported in the loss report |
| Production PDF (title pages, continuations, locked pages) | M2 |
| Reports and StoryScry: both speakers counted as speaking in that scene; simultaneous speech labelled, not double-counted as time | M4 |
| Character sides | M4: a dual pair stays whole when either speaker's sides are made |
| Comments and alternatives anchored inside a dual pair | M5 |
| Acceptance fixtures | Dual pair at a page end exists; add dual cases to report, interchange and sides fixtures as those features are built |

**M3, made explicit:**
9. **Corkboard and mind map as an evidence board:** cards (scenes, beats, characters, notes, images) linked by visible "strings": typed, labelled connections the writer draws. Moving a card never reorders the script unless the structural permission is on.
10. **Navigator, Final Draft 13-style** (reference for behaviour only): a side panel with tabs:
   - **Scenes:** number once locked, heading, page and length in eighths, summary, colour label, and the characters in the scene. Filter, search and jump.
   - **Characters:** speaking counts, scenes, first appearance, and jump to each.
   - **Notes:** later, with comments.
   - **Outline.**
   It extends the current scene list; the scroll sync with the script stays.
11. **Outline editor and overview:** an editable outline of acts, sequences, scenes and beats. Each item has its title, logline and summary. Reordering an item reorders the script only with the structural permission, and is undoable. The **overview** is a zoomed-out read-only map of the whole script (scenes as blocks sized by length, coloured by label or act) for finding your place.
12. **Beat / pacing board:** a lane of beats that the writer divides into acts wherever they choose, any number of acts. Optional starting structures (for example three-act or five-act) use generic names, not trademarked methods. It shows pacing (beat position against estimated page or time, labelled as an estimate). It links to scenes the same way cards do.

**Decisions needed (they affect data and pagination):**
- **A. Fonts.** Screenplay pages are fixed-pitch Courier Prime 12 pt, and page count depends on it. Options:
  - (1) Font and size change only how the script looks on screen; pages and exports stay standard. **Chosen by the owner 2026-10-26.**
  - (2) A per-document font that also changes pages and exports. This breaks the one-page-per-minute convention and needs bundled, licensed fonts.
  - (3) (1) for screenplays, plus free font choice in non-screenplay documents (M6 rich text).
- **B. Colours.** **Decided 2026-10-27: on-screen writer's markup only; never printed or exported.** (Was: should text colour and highlight print in PDF exports, or show on screen only?) Either way they are stored as marks with stable meaning, never as the only signal: the rule "colour cannot be the only identifier" applies. Plain text cannot keep them, and FDX keeps them only partly; the export reports say so.
- **C. Comments.** **Decided 2026-10-27: option 2, all comment work stays in M5.** Anchored comments are M5 (anchors that survive edits, moves and splits; orphans; threads). Options: (1) keep M5 and give the button a basic slice early: a comment on a selection, anchored by block id and text offsets, with a side list; or (2) move all of M5's comment work forward. Option (1) needs the anchor design now, which ROADMAP already asks for ("Comment and branch anchors must be designed earlier").

## M3: Connected story development

- Nested episodes and mixed document containers with shared bible.
- Tabbed navigator (item 10 above), outline editor and overview (item 11), notes/bookmarks.
- Corkboard and mind map as an evidence board with strings (item 9), images/video links.
- Beat/pacing board with writer-chosen acts (item 12).
- Permission-controlled bi-directional scene ordering.
- Independent chronological story timeline.
- Character/location/world profiles and aliases.
- Non-AI bible extraction/refresh with provenance and review.

Exit: cards, navigator, script, chronology, and bible stay consistent after edits and undo. No duplicated scene prose or accidental reorder.

## M4: Production analysis and stripboard

**StoryScry** (owner's name, 2026-10-26) is where every report and chart lives. Opening it shows a dashboard summary of all available reports, mostly as charts. Each chart opens into the full report, which can be filtered and exported on its own. The reference for the approach is Celtx's Insights; no copying of its look.
- **Metrics** (each also an independent report):
  - action vs dialogue (words and lines, per scene and overall);
  - interior vs exterior (and INT/EXT);
  - day vs night (time of day);
  - locations (scenes, pages, first and last use);
  - characters (dialogue, scenes speaking and present, first appearance);
  - scene lengths and pacing across acts;
  - props and other tags once tagging exists.
- **Chart types**, chosen to suit the data:
  - Nightingale (polar area) for shares such as INT/EXT, day/night and locations;
  - bullet charts for a value against a target, such as page count or act lengths;
  - dot plots for per-scene or per-character distributions;
  - plain bar and line charts where they read better.
- **Rules:** charts and their report rows come from the same data and agree (acceptance E8). Estimates are labelled as estimates. Colour is never the only signal. Every chart has a table view for keyboard and screen-reader users. Exports: PDF, HTML, CSV/XLSX.
- **Libraries:** the charting approach (original SVG or a charting library) is not chosen yet; any library needs the owner's OK and a licence check.

**Character sides** (owner, 2026-10-26): for a chosen character or characters, export the scenes they appear in, as pages for actors and auditions.
- Options: their scenes only, or full pages with the other scenes crossed out.
- Each scene keeps its scene numbers and page labels from the locked script when locking exists.
- A dual-dialogue pair stays whole.
- Built on the M2 production PDF.

- Range/entity tags with correction controls.
- Independent character, scene, location, prop/category, and revision reports.
- Vertical stripboard and independent scheduling order.
- Page/eighth calculations tied to a stated layout/scope.
- StoryScry dashboard and charts (above); character participation charts with honest timing labels.
- Character sides (above).
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

