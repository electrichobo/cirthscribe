# ADR 0004: Pop-out panel windows

Status: accepted (owner request W3, 2026-10-28; design by the coding agent)
Date: 2026-10-28

## Problem

The owner asked for panels that leave the main window, move freely as windows of their own, and come back (docs/M3_PLAN.md, W3). The window that is clicked or focused comes to the front and is the active one. The script, scene list, board and notes are views of one canonical project (AGENTS.md): two windows must never hold separate copies or write past each other, and undo must not split into competing histories (ADR 0001; M3 decision A).

## Options considered

1. **Each panel window opens the project itself** (its own store connection and editor state). Rejected: two writers on one working store, two script states, and the store holds an exclusive lock.
2. **`window.open` popups that share the main window's DOM.** Rejected: Tauri and WKWebView do not give popups reliable same-origin DOM access, and behaviour differs per OS.
3. **The main window stays the authority; panel windows are remote views.** A panel window renders the same panel code against a snapshot that the main window sends, and every change goes back to the main window as a command, which applies it exactly as if it were made in its own panel.

## Decision

Option 3.

- A panel window is a Tauri window labelled `panel-<name>` (`nav`, `board`, `notes`), opened by the core (`pop_out_panel`) on `panel.html`. On Windows and Linux it has no menu bar of its own.
- **Main → panel:** `panel-state` events with what the panel shows: scenes (id, position, heading), locked numbers, the caret's scene, beats, the board's permission switch, and the notes text when the window opens.
- **Panel → main:** `panel-command` events: go to a scene, move a scene, move or edit a card, add a card, set the permission switch, notes text, undo or redo, dock. The main window runs them through the same functions as its own panels: a scene move is one editor transaction in the script's history; a card edit is the same `put_beat` call.
- Panel windows never call commands that change the project.
- **Undo** follows focus (decision A): in a panel window, Ctrl/Cmd+Z outside a text field undoes in the script's history (scene moves are script edits); text fields keep their own undo.
- **Docking:** the Dock button or closing the panel window puts the panel back in the main window. Closing the project or the main window closes every panel window first. Which panels are popped out is not remembered between sessions yet.
- While a panel is popped out, its place in the main window is free for the script.

## Consequences

- One authority, no second copy of the script, one undo history for the script.
- Every change from a panel window takes one event round trip to the main window (a few milliseconds locally).
- The panel code is written once against a small interface (`ScriptView` in `views.ts`), implemented by the editor in the main window and by the event bridge in panel windows.
- A panel window's interface size follows the app preference only when it opens.
- Tests check the round trip from the main window: panel windows report what they drew (`panel-rendered`), and commands are sent the same way a panel window sends them.

## Revisit triggers

- Several projects open at once, or split views of the script (the main window then stops being the only authority).
- Panels that need data the main window does not hold (for example the bible from step 7): they read it from the core directly, read-only, and still send changes through the main window.
