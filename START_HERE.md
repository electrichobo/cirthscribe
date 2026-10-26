# First prompt for the coding agent

You are helping me build CirthScribe, a free/open-source, offline-first desktop screenplay and story-production application.

Read CLAUDE.md and its referenced documents before changing files. Treat the pack as the product brief and acceptance criteria, not evidence that any features already exist.

Begin with milestone 0. Prefer Rust + Tauri with a TypeScript structured editor, but test the risky parts before committing. C# + Avalonia is permitted if evidence supports it. Do not build both applications or adopt a paid editor component.

Build a small runnable prototype demonstrating:
- typed screenplay blocks and configurable Tab/Enter behavior;
- realistic text selection, paste, undo/redo, Unicode, and IME;
- stable scene/block IDs and one canonical document;
- recoverable save/reopen;
- long-document editing and a pagination/PDF proof of concept;
- one scene represented in editor, navigator, and board without duplicated script text.

Use original synthetic scripts, including long dialogue and page-boundary cases. Record actual platform coverage, measurements, dependency licenses, failures, and unresolved risks. Do not label browser-print output production-ready.

Finish with a concise framework decision record and a concrete milestone 1 plan. Keep later features in the roadmap. Make routine reversible decisions yourself; flag assumptions clearly and ask only when a decision materially blocks progress.

