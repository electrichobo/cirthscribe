# ADR 0003: Undo for planning edits

Status: accepted (owner decision A for M3, 2026-10-27: "Ctrl Z should go to the focus")
Date: 2026-10-28

## Problem

Until M3, only the script could be undone (ProseMirror's history). Planning edits (a card's logline or summary, a planning-only card move, a new card) were written to the store at once and could not be undone, except by a text field's own undo while it still had focus. ROADMAP's M3 exit asks that cards, navigator, script, chronology and bible "stay consistent after edits and undo". AGENTS.md forbids duplicate undo stacks fighting over the same data, and structural changes must be undoable once (ACCEPTANCE B3).

## Options considered

1. **Two histories, routed by focus** (chosen by the owner). The script keeps its ProseMirror history. Planning edits get a history of their own in the core, per open project. Ctrl/Cmd+Z goes to the history of the view with focus. An action that changes the script lives only in the script's history.
2. **One project-wide history in the core** for script and planning together. Closest to a single undo stack, but it moves the script's undo out of ProseMirror: a large change to working, tested code (typing, IME, paste, revision marks).

## Decision

Option 1.

- **Planning commands** (`cirth_core::planning`): `PutBeat` (create or change a card) and `DeleteBeat`. Each carries the planning version it was based on; a command based on an older version is refused as stale, and the view reloads. Each applied command records its exact inverse. Planning changes count as unsaved work, so they are kept after a crash like script edits.
- **The planning history** lives in the core session for the open project (like ProseMirror's, it does not survive closing the project). Undo applies the inverse; redo applies the command again. A new planning command clears the redo list. It holds the last 200 steps.
- **Routing:**
  - In the script: the script's history (unchanged).
  - In the scene list: the script's history (its moves are script edits).
  - In the board (outside a text field): the board's own sequence. A planning edit is undone in the planning history. A card move with "Board may reorder script" on is a script edit: the board undoes it through the script's history, but only if the script has not changed since; otherwise it says so and leaves the script alone, because the script's next undo step would be something else.
  - In a text field: the field's own undo while typing; once the text is committed (Enter, Tab or leaving the field), the change is one planning step.
  - In a pop-out panel window (ADR 0004): the same rules, sent to the main window.
- **The board's permission switch** ("Board may reorder script") is stored per document in the project's settings (`document:<id>` / `board_structural`), off by default, as PRODUCT_SPEC 3 requires.

## Consequences

- Two histories exist, but they never hold the same change: no step is in both.
- Undo depends on focus, which is how the owner asked for it; the board's announcements say what was undone ("Card text restored", "Scene order restored").
- Later planning views (outline, beat board, timeline, bible) add their commands to the same planning history.

## Revisit triggers

- A planning command that must also change the script in one step (for example "apply chronology to script order", M3 step 8): it lives in the script's history as one transaction, with its planning side recorded so one undo restores both.
- Persistent history across sessions (M5 snapshots).
