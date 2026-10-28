# Milestone 3 plan: connected story development

Status: **proposed, 2026-10-27.** Builds on M1, M1b and M2 (closed by the owner 2026-10-27). ROADMAP's M3 gate: cards, navigator, script, chronology and bible stay consistent after edits and undo; no duplicated scene prose and no accidental reorder. Acceptance sections B (linked structure) and C1–C4 (bible and media) are the tests; C5 needs M5's branches and is out of scope.

## Starting point (what exists)

- **One document per project in the UI.** The schema has had containers (series, season, episode) and several documents per project since v2, and beats and blocks carry a `document_id`. Every command still works on the default document; nothing lists or switches documents.
- **Scene list** (side panel): heading and locked number per scene; Up/Down to choose, Alt+arrows to move a scene in the script (a real `MoveScene`, in the script's undo history). It scrolls with the script. No page, length, summary, label, characters, filter or search.
- **Board:** one card per beat with an authored logline and summary, linked to at most one scene by stable id. With "Board may reorder script" off, moving a card changes planning order only and shows "Planning only"; on, it moves the linked scene once, undoably (acceptance B1–B3 in e2e). The switch is **not stored**: it resets to off on every open, where the spec asks for a persisted per-document setting.
- **Undo:** the script has one undo history (ProseMirror). Planning edits (beat text, planning-only moves) are written to the core at once and are **not undoable** except by the text field's own undo.
- **Characters:** only implicit, as cue text. Autocomplete reads cue names; nothing stores a character, an alias or a profile.
- **Pages:** the core's page map knows every block's page and line, so page and length (in eighths) per scene can be derived without the WebView measuring anything.
- **Not yet:** outline, acts, overview, timeline, bible, evidence board, images, multi-document projects.

## Proposed order

Each step is a working, tested slice on both e2e drivers. New tables carry `document_id` or an explicit scope from the start, so step 8 (episodes) needs no reshaping. Every schema change freezes v-previous files in `tests/data` with an upgrade test.

1. **Planning commands and undo** (foundation; decision A).
   - Store the structural permission per document (`document:<id>` settings), as the spec requires; default off.
   - Planning edits (card text, planning moves, links) become core commands with a base version, and get undo and redo.
   - Script-changing moves stay in the script history only; one action is never in both.
   - Tests: B2, B3, B4 (two beats on one scene: moving one never clones or moves the scene), undo of each planning edit, permission survives reopen.
2. **Tabbed navigator: Scenes and Characters** (ROADMAP item 10).
   - Scenes tab: number, heading, page, length in eighths (from the core page map), logline/summary from the linked card, colour label (decision C), characters in the scene. Filter and search; jump to the scene; scroll sync kept.
   - Characters tab: from cues for now (step 6 links them to bible entries): lines and words of dialogue, scenes, first appearance, jump to each. Dual dialogue counts both speakers once each.
   - Schema: a per-scene colour label.
3. **Outline editor** (item 11; decision B).
   - An editable tree: acts, sequences, scene items and beats, each with title, logline and summary. Scene items link to a scene by stable id; a beat can exist before its scene and be linked later, or create the scene explicitly.
   - Reordering under the structural permission moves the script once and undoably; otherwise planning only, with the indicator.
   - The board shows the same items (no second copy of planning data).
   - Keyboard: arrows, indent and outdent, Alt+arrows to move.
4. **Beat and pacing board** (item 12).
   - The writer divides beats into any number of acts. Optional starting structures with generic names (three-act, five-act), never a trademarked method.
   - Pacing: each beat's position against estimated page and estimated minutes, labelled as estimates.
5. **Overview map** (item 11): a read-only, zoomed-out map of the whole script, scenes as blocks sized by length and coloured by label or act, with a text alternative (the same data as a list). Click or Enter jumps.
6. **Project bible: characters, locations, world** (C1–C3).
   - Entities with authored fields, custom fields and aliases; project-scoped, with optional season/episode scope for step 8.
   - Extraction without AI: cue names and scene-heading locations become **candidates** with evidence (document, scene, block, version). An all-caps sound effect in action is never auto-accepted. The writer accepts, rejects or merges into an existing entity (alias).
   - Occurrence lists refresh from the script; authored fields are never overwritten. An entity no longer mentioned is flagged, never deleted.
   - Rename: a previewed replace of cues and headings only; matching words in action text are listed, not changed.
   - The navigator's Characters tab and autocomplete use the entities.
7. **Story timeline** (B5).
   - Story events in their own chronological order, linked to one or more scenes; flashbacks, simultaneous events and uncertain or relative dates representable.
   - Moving an event never moves a scene. "Apply chronology to script order" is a separate, previewed, undoable command, offered only with the structural permission on.
8. **Episodes and series** (decision D).
   - A project tree of containers and documents (already in the schema): create, rename, move and open episodes; one shared bible, with facts scoped to a season or episode.
   - Every step above works per document. Fixture: a nested multi-episode project with aliases, shared facts and its own chronology (ACCEPTANCE's fixture list).
9. **Evidence board, images and video links** (item 9; decision E).
   - A freeform canvas of cards (scenes, beats, bible entities, notes, images, video links) joined by labelled, typed "strings" the writer draws. Keyboard alternatives for placing, linking and moving.
   - Moving a card never reorders the script.
   - Local images packaged in the `.cirth` file, checked by type and size; video links stored as URLs only. Opening a project makes no network request (C4).
   - Notes and bookmarks: free notes as board and outline items, and named bookmarks on a block in the navigator. Anchored comments stay in M5.

The exit review comes after 9. Steps 4 and 5 can swap, and step 8 can move earlier if episodes matter more to you than the board.

## Carried from M2 (not blockers for starting M3)

- External app tests: Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print (docs/COMPATIBILITY.md);
- the Mac recheck of compat pack v2 (deferred: the Mac is busy);
- manual checks N20–N28;
- from M1: Linux desktop latency, named reference machines, STATUS defect 3;
- Windows e2e on the hosted CI runner;
- known limit: non-Latin text prints blank in PDFs until a fallback font is chosen.

## Decisions needed

- **A. Undo for planning edits** (an ADR, 0003).
  - (1) Two histories routed by focus: the script keeps its ProseMirror history; planning edits get a core-side history per document. An action that changes the script (a structural move) lives only in the script history. **Proposed.**
  - (2) One project-wide history in the core for script and planning together. Closest to "one undo stack", but it means moving the script's undo out of ProseMirror: a large change to working, tested code.
- **B. Beats and outline items.**
  - (1) Beats become outline items (migration keeps their ids, text and links); the outline, board and pacing board are views of one tree. **Proposed:** one planning model, no copies.
  - (2) Keep beats separate and link outline items to them.
- **C. Colour labels:** a fixed named palette like the text colours (theme-aware, always with a name, never colour alone), or writer-defined names and colours. Proposed: a fixed palette whose names the writer can rename.
- **D. Episodes in M3?** ROADMAP puts nested episodes and the shared bible in M3. It touches every view (which document is open). Keep it as step 8, or move it to its own milestone after M3.
- **E. Images in the project file.** Packaging them makes the `.cirth` file portable but larger. Proposed: package by default, warn above a size (for example 20 MB per image), and never store absolute paths.
- **Dependencies:** none expected. Images are shown by the WebView and stored as bytes; type checks read the file header. Anything that turns out to need a crate or package comes back to you first.
