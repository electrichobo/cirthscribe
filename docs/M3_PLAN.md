# Milestone 3 plan: connected story development

Status: **accepted by the owner, 2026-10-27**, with decisions A–E below (episodes moved to step 2). Builds on M1, M1b and M2 (closed by the owner 2026-10-27). ROADMAP's M3 gate: cards, navigator, script, chronology and bible stay consistent after edits and undo; no duplicated scene prose and no accidental reorder. Acceptance sections B (linked structure) and C1–C4 (bible and media) are the tests; C5 needs M5's branches and is out of scope.

## Starting point (what exists)

- **One document per project in the UI.** The schema has had containers (series, season, episode) and several documents per project since v2, and beats and blocks carry a `document_id`. Every command still works on the default document; nothing lists or switches documents.
- **Scene list** (side panel): heading and locked number per scene; Up/Down to choose, Alt+arrows to move a scene in the script (a real `MoveScene`, in the script's undo history). It scrolls with the script. No page, length, summary, label, characters, filter or search.
- **Board:** one card per beat with an authored logline and summary, linked to at most one scene by stable id. With "Board may reorder script" off, moving a card changes planning order only and shows "Planning only"; on, it moves the linked scene once, undoably (acceptance B1–B3 in e2e). The switch is **not stored**: it resets to off on every open, where the spec asks for a persisted per-document setting.
- **Undo:** the script has one undo history (ProseMirror). Planning edits (beat text, planning-only moves) are written to the core at once and are **not undoable** except by the text field's own undo.
- **Characters:** only implicit, as cue text. Autocomplete reads cue names; nothing stores a character, an alias or a profile.
- **Pages:** the core's page map knows every block's page and line, so page and length (in eighths) per scene can be derived without the WebView measuring anything.
- **Not yet:** outline, acts, overview, timeline, bible, evidence board, images, multi-document projects.

## Order (accepted)

Each step is a working, tested slice on both e2e drivers. Every schema change freezes v-previous files in `tests/data` with an upgrade test.

Episodes come second (decision D: "whichever allows for the most interconnectivity"). Every later view is then built across the whole project from the start: a character's appearances, a timeline event or a board string can reach any episode, and nothing has to be reworked from one document to many.

1. **Planning commands and undo** (foundation; decision A).
   - Store the structural permission per document (`document:<id>` settings), as the spec requires; default off.
   - Planning edits (card text, planning moves, links) become core commands with a base version, and get undo and redo.
   - Ctrl/Cmd+Z goes to whatever has focus: the script's own history in the script, the planning history in a planning view. A move that changes the script lives only in the script history. ADR 0003 records this.
   - Tests: B2, B3, B4 (two beats on one scene: moving one never clones or moves the scene), undo of each planning edit, permission survives reopen.
2. **Episodes and series.**
   - A project tree of containers and documents (in the schema since v2): create, rename, move and open episodes. The scene list, board and exports follow the open document.
   - One shared bible per project (step 7), with facts scoped to a season or episode.
   - Fixture: a nested multi-episode project with aliases, shared facts and its own chronology (ACCEPTANCE's fixture list), grown as later steps add data.
3. **Tabbed navigator: Scenes and Characters** (ROADMAP item 10).
   - Scenes tab: number, heading, page, length in eighths (from the core page map), logline/summary from the linked item, colour label (decision C), characters in the scene. Filter and search; jump to the scene; scroll sync kept. Scope: this episode or the whole project.
   - Characters tab: from cues until step 7 links them to bible entries: lines and words of dialogue, scenes, first appearance, jump to each, across episodes. Dual dialogue counts both speakers once each.
   - Schema: a per-scene colour label.
4. **Outline editor** (item 11; decision B).
   - Beats become outline items: the migration keeps their ids, text, links and planning order.
   - An editable tree: acts, sequences, scene items and beats, each with title, logline and summary. Scene items link to a scene by stable id; a beat can exist before its scene and be linked later, or create the scene explicitly.
   - Reordering under the structural permission moves the script once and undoably; otherwise planning only, with the indicator.
   - The board shows the same items: one planning tree, no copies.
   - Keyboard: arrows, indent and outdent, Alt+arrows to move.
5. **Beat and pacing board** (item 12).
   - The writer divides beats into any number of acts. Optional starting structures with generic names (three-act, five-act), never a trademarked method.
   - Pacing: each beat's position against estimated page and estimated minutes, labelled as estimates.
6. **Overview map** (item 11): a read-only, zoomed-out map of the script or the whole series, scenes as blocks sized by length and coloured by label or act, with a text alternative (the same data as a list). Click or Enter jumps.
7. **Project bible: characters, locations, world** (C1–C3).
   - Entities with authored fields, custom fields and aliases; project-scoped, with optional season or episode scope.
   - Extraction without AI: cue names and scene-heading locations from every episode become **candidates** with evidence (document, scene, block, version). An all-caps sound effect in action is never auto-accepted. The writer accepts, rejects or merges into an existing entity (alias).
   - Occurrence lists refresh from the scripts; authored fields are never overwritten. An entity no longer mentioned is flagged, never deleted.
   - Rename: a previewed replace of cues and headings only; matching words in action text are listed, not changed.
   - The navigator's Characters tab and autocomplete use the entities.
8. **Story timeline** (B5).
   - Story events in their own chronological order, across episodes, linked to one or more scenes; flashbacks, simultaneous events and uncertain or relative dates representable.
   - Moving an event never moves a scene. "Apply chronology to script order" is a separate, previewed, undoable command, offered only with the structural permission on.
9. **Evidence board, images and video links** (item 9; decision E).
   - A freeform canvas of cards (scenes, beats, bible entities, timeline events, notes, images, video links) from any episode, joined by labelled, typed "strings" the writer draws. Keyboard alternatives for placing, linking and moving.
   - Moving a card never reorders the script.
   - Local images packaged in the `.cirth` file, checked by type and size, with a warning above a size limit; video links stored as URLs only. Opening a project makes no network request (C4).
   - Notes and bookmarks: free notes as board and outline items, and named bookmarks on a block in the navigator. Anchored comments stay in M5.

The exit review comes after 9. Steps 5 and 6 can swap.

## Workspace and menus (owner notes, 2026-10-28)

The owner's notes after using the current build. Proposed as steps W1–W5, done **before step 1**: every M3 panel built afterwards then lands in the new menus and can pop out from the start. A menu item appears only once its feature works: never a placeholder for M4–M5 features.

- **W0. Fixed at once (2026-10-28):**
  - The block-type dropdown's open list was unreadable except under the mouse (system list background, theme text colour). Options now use the theme's panel and ink colours.
  - Home: Free Writing sits directly under "Open a project file…", the same size.
  - Already true, checked in the code: Free Writing belongs to no project, saves half a second after typing, on leaving a field and on closing the app.
- **W1. Menus and naming.**
  - "Elements" instead of "blocks" everywhere the writer sees it (the code keeps `block`).
  - **File:** one Import… that detects the format from the file (Fountain and FDX now; TXT, RTF and DOCX need new importers, see question 3). One Export… dialog listing every export with its options and capability report; reports, sides and stripboards join it when M4 builds them. Free Writing leaves File for the island's More menu. Title Page… and Headers and Footers move to Format.
  - **View:** a Mode submenu (Normal, Page, Typewriter, Focus, Full Screen); a Tools submenu with every panel's toggle and pop-out (scene navigator, board now; outline, beat board, overview, bible, timeline, evidence board and notes as each is built); Appearance (themes Day, Night, Midnight, OLED and Match System; interface size; high contrast); Window (minimise, zoom, bring all to front; split, document list once episodes exist); Go To (page, scene; act once acts exist); Reports (the StoryScry dashboard and every report: M4).
  - **Format:** Element submenu (the block types); Page (size; margins and spacing, see question 4); Spelling moves here from Edit; Title Page, Headers and Footers; Revisions, Scene Numbers, Locked Pages as now; Rename Globally (characters and locations: the bible's previewed rename, step 7); Tags (M4); Keyboard Shortcuts (W5).
  - **Help:** About, Keyboard Shortcuts, Licences, Check for Updates (see question 5), Typing Latency.
- **W2. Notes panel:** a scratchpad saved with the project and tied to nothing else. A Tools panel that can pop out. **Built 2026-10-28:**
  - View > Tools > Notes (and the More menu's panel list) shows or hides it; the choice is stored per user like the other panels, off at first.
  - It floats over the script; its title bar moves it (drag, or arrow keys with Shift for bigger steps) and it can be resized. The position is remembered per user.
  - Text goes to the working store half a second after typing stops and when the field loses focus; every save, autosave and close includes it. Escape returns to the script.
  - Stored in the project's settings (`project` / `notes`): no schema change, and the script, its history and every document are untouched.
  - **Fix found while testing:** settings changes (notes, title page, headers, revision sets) did not count as unsaved work, so after a crash the working store was replaced by the older project file and those changes were lost. The store now counts settings changes since the last save; a working store with newer settings is recovered like one with newer script edits, and the recovery banner says which.
  - Tests: core (notes saved with the package, the script untouched; recovery after a crash with only a notes change); e2e "Notes panel" on both drivers (show, type, move by keyboard, kept through Home and a hard kill, separate per project, hide).
- **W3. Pop-out panels:** any panel can leave the main window as its own window, move freely, and come back. Clicking or focusing a window brings it to the front as the active one. Panels stay views of the core's data, so two windows never hold separate copies; keyboard focus and undo follow the active window (decision A). Tauri 2 opens extra windows itself: no new dependency. An ADR records how windows share state. **Built 2026-10-28** (ADR 0004, docs/adr/0004-panel-windows.md):
  - View > Tools > Scene List / Board / Notes "in Its Own Window", and a ⧉ button in the scene list's and board's headers, open the panel as a window of its own; the island's scene-list and board buttons then bring that window to the front.
  - The main window stays the only authority: a panel window draws a snapshot sent from it and sends every change back as a command (go to a scene, move a scene, edit or move a card, the board's permission switch, notes text, undo and redo). The panel code is shared through a small `ScriptView` interface in `views.ts`.
  - A scene move from a panel window is one transaction in the script's history; Ctrl/Cmd+Z in the panel window (outside a text field) undoes it there.
  - The Dock button or the window's own close button puts the panel back; going Home or closing the main window closes every panel window. The main window gives the space to the script while a panel is out.
  - Not yet: which panels are out is not remembered between sessions; a panel window takes theme, high contrast and interface size from the preferences when it opens, not later changes.
  - Tests: e2e "Pop-out panels" on both drivers (windows open and close, each draws from the main window's snapshot, a move from the window reaches the script and redraws, undo from the window, a card edit stored once, notes kept, Dock, close button, Home). Manual check N30: moving windows, focus and front-most window by hand on each OS.
- **W4. Themes:** Day, Night, Midnight, OLED (true black) and Match System, each checked for contrast like the current two. **Built 2026-10-28:**
  - View > Appearance > Theme, with a check mark on the current one; stored per user in the preferences file (old files get Match System).
  - Day and Night are the former light and dark colours; Midnight is a deep blue-black; OLED is true black. Match System follows the OS's light or dark setting as before.
  - Native controls (dropdown lists, scrollbars) follow the theme. Screen-only text colours switch to their light-on-dark versions in the dark themes.
  - High contrast stays a separate switch on top of any theme: white with Day, black with the dark ones. The OS's own high-contrast request applies while the theme is Match System.
  - Pop-out panel windows take the theme, contrast and interface size when they open.
  - Tests: e2e "Themes" on both drivers: every theme's text and background pairs at least 4.5:1, OLED plus high contrast at least 7:1 and still black, one check mark, stored.
- **W5. Keyboard shortcut remapping:** a list of commands with their keys, conflict warnings, reset to defaults; stored per user. **Built 2026-10-28:**
  - Help > Keyboard Shortcuts… lists every shortcut by group. Change waits for the next key combination (Escape cancels, Backspace removes the shortcut); Reset puts one back; Reset all puts every one back.
  - Rebindable: open, save, save as, export, find, spelling suggestions, bold, italic, underline, dual dialogue, page break, the nine elements, go to page and scene, focus mode, typewriter mode, full screen, interface size.
  - Fixed, listed but not changeable: undo and redo, cut, copy, paste, select all, Tab and Shift+Tab, Enter, Escape, F6, Alt+arrows. A shortcut needs Ctrl/Cmd or Alt (or is an F key), so it never stops a letter from typing.
  - Keys that belong to another command move to the new one, and the dialog says which command lost them.
  - One registry (`bindings.ts`) and one dispatcher replace the separate key handlers; each shortcut runs its menu item's action. Formatting keys act only in the script. The native menus show the keys in force.
  - Stored per user in the preferences file (`keys`, only what differs from the defaults).
  - Tests: e2e "Shortcuts: Help > Keyboard Shortcuts…" on both drivers (rebind, menu label, a taken key moves, fixed and plain keys refused, Escape, the new keys work and the old do not, stored, Reset all); every earlier e2e test still drives the default keys.

**Workspace steps W1–W5 are done (2026-10-28).** Next: M3 step 1.

**W1 built 2026-10-28:**
- **File:** New, Open, **Import…** (Final Draft by content or extension; Fountain, .spmd and .txt read as Fountain; anything else is refused with the formats named), Save, Save As, **Export…** (Ctrl/Cmd+E: a dialog listing PDF, changed-pages PDF (only with an active revision set), plain text, Fountain, Final Draft, Word, RTF and HTML, each with what it keeps; each then runs its own export and report), Close Project, Quit. Free Writing left File; it stays in the island's More menu and on Home.
- **Edit:** undo, redo, cut, copy, paste, select all, find. Spelling moved to Format.
- **View:** Mode (Normal View, Page View, Typewriter Mode, Focus Mode, Full Screen with F11; full screen keeps the menu bar); Tools (Scene List, Board); Toolbar and Status Bar; Appearance (interface size, high contrast; themes come in W4); Go To (Page… Ctrl/Cmd+G by printed label such as 12A; Scene… Ctrl/Cmd+Shift+G by locked number, position or heading words); Window (Minimise, Zoom, Next Panel).
- **Format:** bold, italic, underline, text colour, highlight; **Element** (was Block Type); dual dialogue, page break; Screen Font (moved from View); Page Size; Title Page…; Headers and Footers…; Scene Numbers, Locked Pages, Revisions; Spelling.
- **Help:** Keyboard Shortcuts… (the list; remapping is W5), Typing Latency…, Check for Updates… (opens the releases page in the browser only when clicked), Licences…, About.
- "Element" replaces "block type" in the toolbar and find bar.
- The island has a comment button marked inactive: it says comments come in a later version and changes nothing (owner answer 1).
- Tests: e2e "Menus" checks every item's place, mode check marks, import detection, the Export dialog's formats, Go To page and scene, the shortcut list and the comment placeholder. Manual check N29 covers minimise, zoom, full screen, the browser and real imports.

Owner answers (2026-10-28):
1. **Comment icon on the island:** a placeholder icon now; comments stay in M5.
2. **Reports dashboard:** StoryScry.
3. **Import:** TXT read as Fountain now; RTF and DOCX import later.
4. **Screenplay pages stay standard:** page size is the only screenplay page setting; margins, spacing and fonts are for other document kinds (M6).
5. **Check for Updates:** opens the releases page in the browser when clicked; no background checks.

The questions as asked:
1. **Comment icon on the island.** On 2026-10-27 comments went wholly to M5 (decision C, option 2: no button before then). Bring a basic anchored comment forward into M3 so the icon works, or add the icon when M5 builds comments?
2. **Name of the reports dashboard:** the README says StoryScry; your notes say ScriptScry. Which one?
3. **Import formats:** Fountain and FDX import exist. TXT can be read as Fountain. RTF and DOCX import are new work (no dependency for RTF; DOCX can reuse the approved `zip` crate). In M3, or later?
4. **Margins, line spacing and fonts for screenplays:** pages use the fixed industry format so a page stays about a minute (decision A1, 2026-10-26). Proposed: page size stays the only page setting for screenplays; margins, spacing and fonts apply to other document kinds (M6). Or do you want them for screenplays too, knowing page counts stop matching the standard?
5. **Check for Updates:** the app makes no network request without opt-in. Proposed: the menu item opens the project's releases page in your browser only when clicked; no background checks. Nothing to point at until there is a first release.

## Carried from M2 (not blockers for starting M3)

- External app tests: Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print (docs/COMPATIBILITY.md);
- the Mac recheck of compat pack v2 (deferred: the Mac is busy);
- manual checks N20–N28;
- from M1: Linux desktop latency, named reference machines, STATUS defect 3;
- Windows e2e on the hosted CI runner;
- known limit: non-Latin text prints blank in PDFs until a fallback font is chosen.

## Decisions (owner, 2026-10-27)

- **A. Undo for planning edits:** Ctrl/Cmd+Z goes to the view with focus. The script keeps its ProseMirror history; planning edits get a core-side history per document; an action that changes the script lives only in the script history. (Option 1. Not chosen: one project-wide history in the core.) To be written up as ADR 0003 in step 1.
- **B. Beats become outline items** (option 1): the outline, board and pacing board are views of one tree.
- **C. Colour labels on scenes and planning items:** a fixed named palette whose names the writer can rename; a label always has a name, never colour alone. Separate from revision colours.
  - Revision colours (M2), settled by the owner on 2026-10-28 to the Writers Guild order: White (original production draft), Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry, then "Double Blue", "Double Pink" and so on. New sets start at Blue; White can be chosen to label the original draft.
- **D. Episodes in M3,** placed for the most interconnection: step 2, before every view that should reach across episodes.
- **E. Images packaged in the project file** by default, with a size warning; never absolute paths.
- **Dependencies:** none expected. Images are shown by the WebView and stored as bytes; type checks read the file header. Anything that turns out to need a crate or package comes back to the owner first.
