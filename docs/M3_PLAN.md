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
  - The owner also gave the revision colour order while answering, which corrected M2: Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry, Tan, then a second cycle "Second Blue", "Second Pink" and so on; white is the unrevised draft. Fixed in the commit that accepts this plan (it had White ninth and "Double Blue").
- **D. Episodes in M3,** placed for the most interconnection: step 2, before every view that should reach across episodes.
- **E. Images packaged in the project file** by default, with a size warning; never absolute paths.
- **Dependencies:** none expected. Images are shown by the WebView and stored as bytes; type checks read the file header. Anything that turns out to need a crate or package comes back to the owner first.
