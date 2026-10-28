# Kolbítar

A free, open-source screenplay writing and story-production app for Windows, macOS and Linux. It works offline, needs no account, and has no subscription.

Created by Jared Hoy ([electrichobo](https://github.com/electrichobo)).

Free and open source under GPL-3.0 ([details](#license)).

> **Early development.** Kolbítar is not ready to use yet: there is no download and no release. The features marked done below work in development builds and are covered by automated tests, but your scripts are not safe in it yet. Don't trust it with real work until a release says otherwise.

## What it is

Kolbítar is one app for the whole path from first idea to shooting script:

- **Write.** A screenplay editor that formats as you type: scene headings, action, characters, dialogue and transitions, with industry-standard pages.
- **Plan.** Outlines, index cards, a story timeline, and a "bible" of your characters, locations and world. These are all views of the same script, so they never drift out of sync.
- **Prepare for production.** Breakdowns, reports and a stripboard, built straight from the script.
- **Exchange files.** Import and export the formats other tools use (PDF, Final Draft, Word and more), with an honest report of anything a format can't carry.

It is built around a few promises:

- **Free, with no catches.** No subscriptions, paywalls or paid tiers.
- **Your work stays on your computer.** Nothing is uploaded, nothing phones home, and no cloud account is needed.
- **Your work is protected.** Autosave, backups, crash recovery and undo are built into the foundation, not added later.
- **AI is optional and off by default.** If you turn it on, you choose the provider, and it never changes your script without showing you first.

## Roadmap

Each stage builds on the one before. Stages are goals, not dates.

### ✅ Stage 0: Proof of concept (done)

Proved the hard parts before building on them: an editor that keeps up with a 120-page script, accurate page layout, safe saving, and crash recovery. The app framework was chosen with measurements: Rust and Tauri.

### ✅ Stage 1: A writing app you can rely on (done)

Done:
- [x] Screenplay editor with automatic formatting, keyboard shortcuts and undo
- [x] Home screen listing your projects, with sample scripts
- [x] Save, Save As, and open files from anywhere
- [x] Autosave, rolling backups, crash recovery, and protection when a file changes outside the app
- [x] Older project files upgraded safely, with the original kept
- [x] Find and replace
- [x] Autocomplete for character names, locations and transitions
- [x] Word counts
- [x] Spell check (US and UK English) with your own dictionary
- [x] Dual dialogue, forced page breaks, and a page view
- [x] Free Writing: notes and brain dumps outside any project, with a Flow mode that turns off editing so you just keep writing
- [x] Draft PDF export
- [x] Plain-text export with the same pages and layout
- [x] US Letter / A4 page size, saved with each document
- [x] About screen with the licence and every third-party licence
- [x] Accessibility groundwork: full keyboard control, screen-reader labels and announcements, high contrast, adjustable interface size

Carried forward:
- [ ] Typing-speed check on a Linux desktop

### ✅ Stage 1b: Writing workspace (done)

- [x] Focus mode: full screen with only the script page
- [x] Typewriter mode: the line you are typing stays centred while the text scrolls
- [x] A floating toolbar centred over the script: undo, line type, bold, italic, underline, text colour, highlight, on-screen font and size, scene list and board buttons, find, focus mode, and a ⋮ menu for the rest
- [x] Full menu bar on every system: File, Edit, View, Format, Help
- [x] Show or hide the scene list, board, toolbar and status bar
- [x] In narrow windows the side panels step aside and open over the script, so the page always fits
- [x] Scene cards with a logline and summary instead of a copy of the scene
- [x] Choice of on-screen font and size (pages and exports keep the standard screenplay font)
- [x] Text colour and highlight as your own on-screen markup (never printed)

### ✅ Stage 2: Professional pages and file exchange (done)

Done:
- [x] Title page, printed before page 1 in PDF and text exports
- [x] Fountain import and export, with a report of anything that changed
- [x] Final Draft (FDX) import and export, with a report of what carried over (not yet tested in Final Draft itself)
- [x] Scene numbers: lock them, new scenes get A/B numbers (12A, 12B), omit and restore scenes; numbers show in the margins, exports, FDX and Fountain
- [x] PDF export with title page, scene numbers, headers and footers; the same script always gives the same file, and pages are checked to come out identically on Windows, macOS and Linux
- [x] Revision sets (label, colour, date, mark) in the Writers Guild colour order (White original, then Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry, then Double Blue and so on), revision mode that marks changed lines, and a changed-pages PDF
- [x] Locked pages: later changes go onto added pages (12A, 12B) and fully emptied pages print as "11-12", so later page numbers never move
- [x] Word (DOCX), RTF and HTML export, each with a report of what carried over
- [x] A compatibility test pack and record ([docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)); first results from Preview, TextEdit and Safari on macOS

Known limits:
- Letters Courier Prime doesn't have (Chinese, Japanese, Korean, Hebrew, Arabic, emoji) print blank in PDFs; the export warns you. A fallback font comes later.
- In Word, RTF and HTML exports, dual dialogue is printed one speech after the other.

Carried forward:
- [ ] Results from Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages and browser print
- [ ] Check the page measurements against an industry-standard PDF
- [ ] Tested exchange with other screenwriting apps

### 🔜 Stage 3: Story planning (next; plan accepted)

First, from the owner's notes on the current build:
- [x] Reorganised menus: one Import (it recognises Fountain, Final Draft and plain text) and one Export dialog; View > Mode, Tools, Appearance, Go To (page or scene) and Window; elements, screen font, title page and spelling under Format; a keyboard shortcut list
- [x] A notes scratchpad saved with the project (View > Tools > Notes)
- [x] Panels that pop out into their own windows (scene list, board, notes)
- [x] Themes: Day, Night, Midnight, OLED (true black) and Match System, with high contrast on top of any of them
- [x] Remappable keyboard shortcuts (Help > Keyboard Shortcuts…), with conflicts handled and Reset all


- [x] Episodes and series: folders for seasons, any number of episodes per project, each with its own script, scene list, cards and exports (File > Episodes and Documents…)
- [ ] One story bible shared by every episode
- [ ] Tabbed navigator: scenes (length, summary, characters), characters, notes, outline
- [ ] Outline editor, and an overview map of the whole script
- [ ] Index-card board, and a mind map / evidence board where cards are joined by strings
- [ ] Beat and pacing board, split into acts wherever you choose
- [x] Undo and redo for the board's cards (text, new cards, moves), separate from the script's own undo
- [x] Reordering scenes from the board (only with your permission, which is remembered per script, and undoable)
- [ ] Story timeline, kept separate from script order
- [ ] Character, location and world profiles

### Stage 4: Production tools

- [ ] Script breakdown tags (props, wardrobe, cast and more)
- [ ] StoryScry: a dashboard of charts summarising every report, each opening into the full report
- [ ] Separate reports for characters, scenes, locations and props, plus action vs dialogue, interior vs exterior, and day vs night
- [ ] Character sides: a character's scenes as pages for actors
- [ ] Stripboard and shooting schedule
- [ ] Page counts in eighths, and character appearance charts
- [ ] Reports in PDF, spreadsheet (XLSX/CSV) and HTML

### Stage 5: Notes, alternatives and versions

- [ ] Comments attached to the text, with an add-comment button
- [ ] Alternative takes on a scene or line
- [ ] Snapshots and version history, with compare, restore and merge

### Stage 6: More formats and language tools

- [ ] TV and UK formats, stage plays, comics and graphic novels
- [ ] Interactive and branching stories
- [ ] Offline grammar checking and more dictionaries

### Stage 7: Optional extras

- [ ] Bring-your-own AI (a cloud provider or a model running on your computer), off by default
- [ ] Optional Google Docs and Sheets sharing workflows

---

## Details

### Current status

[STATUS.md](STATUS.md) lists what works, what was tested on which platform, open defects and what is untested. Highlights:

- Windows: built and tested locally (two end-to-end test drivers plus core tests).
- Linux: tested in CI (WebKitGTK under Xvfb), including the full end-to-end suite. Not yet tried on a Linux desktop.
- macOS: builds and passes core tests in CI, and has had hands-on checks of editing and the writing workspace on macOS 26 (Apple silicon), plus a first round of export checks in Preview, TextEdit and Safari. macOS 11, the oldest supported version, has not been tried.

### Building from source

Requirements: Rust (stable), Node.js 24, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```
cargo test -p cirth-core
cd app && npm ci && npm run build && cd ..
cargo build -p cirthscribe --release
```

Windows developers can load a checkout-local toolchain with `scripts/dev-env.ps1`. End-to-end tests: `cd app; npm run e2e:cdp` (Windows) or `npm run e2e:webdriver` (needs `tauri-driver` and the platform's WebDriver). See [STATUS.md](STATUS.md) for details.

### How it is built

- **Core** (`crates/cirth-core`, Rust): the document model, the storage (a SQLite working store and the `.cirth` package), page layout, title pages, scene numbering, revision sets and locked pages, PDF, text, Word, RTF and HTML export, Fountain and Final Draft exchange, word counts, spell check and Free Writing. It has no UI code.
- **App** (`app/`, Tauri 2 + TypeScript + ProseMirror): the desktop shell and editor. The editor is a view of the core's document and sends versioned edits to it, so there is one saved copy of the script.
- **Tests**: Rust unit and integration tests, plus an end-to-end suite that drives the real app through two drivers (DevTools and WebDriver).

### Documentation

| File | What it covers |
| - | - |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Full feature specification |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones and their exit gates (the detailed version of the roadmap above) |
| [docs/M3_PLAN.md](docs/M3_PLAN.md) | Stage 3 plan (accepted) and what each step builds |
| [docs/M2_PLAN.md](docs/M2_PLAN.md) and [docs/m2/EXIT_REVIEW.md](docs/m2/EXIT_REVIEW.md) | Stage 2 plan, what each step built, and its exit review |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Which formats have been tested in which other apps, and how to test |
| [docs/M1_PLAN.md](docs/M1_PLAN.md) and [docs/m1/EXIT_REVIEW.md](docs/m1/EXIT_REVIEW.md) | Stage 1 plan and its exit review |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, persistence and layout strategy |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Observable acceptance scenarios |
| [docs/INTEROPERABILITY.md](docs/INTEROPERABILITY.md) | Export matrix and fidelity rules |
| [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/adr/](docs/adr/) | Accepted decisions and open questions |
| [docs/m0/FINDINGS.md](docs/m0/FINDINGS.md) | Proof-of-concept measurements and risks |
| [docs/testing/MANUAL_CHECKS.md](docs/testing/MANUAL_CHECKS.md) | Checks that need a person (macOS, other screenwriting apps, input methods), with results |
| [docs/ART_ASSETS.md](docs/ART_ASSETS.md) | Art the app needs (icons, logo, installer art) and their sizes |
| [AGENTS.md](AGENTS.md), [START_HERE.md](START_HERE.md) and [HANDOFF.md](HANDOFF.md) | Rules, first brief and session handoff for AI coding agents working on this repository |

### Contributing

Issues and suggestions are welcome. Contributions are accepted under the same license as the project (GPL-3.0-only, below).

### License

Kolbítar is free and open-source software under the **GNU General Public License, version 3 only** ([LICENSE](LICENSE)), with one additional term under section 7(b) ([NOTICE](NOTICE)).

In plain terms (the license text is what counts):

- **Use it for free, for anything**, including professional and commercial writing. Your scripts are yours; the license covers the app, not what you write with it.
- **Change it and share it.** Forks and modified versions are welcome.
- **Keep it open.** Anyone who distributes Kolbítar or a modified version must give it out under the same license, with its full source code.
- **Keep the credit.** Copies and modified versions must keep the attribution "Based on Kolbítar by Jared Hoy", in the NOTICE file and on any About or credits screen.
- **No warranty.** It is provided as is.

The GPL does not forbid charging for copies; no open-source license can. But anyone who sells Kolbítar or a version of it must hand buyers the full source under the GPL, and buyers may then share it for free. Kolbítar itself will always be free.

### Third-party components

Kolbítar ships with these components under their own licenses:

- **Courier Prime** font: SIL Open Font License 1.1 (`assets/fonts/courier-prime/OFL.txt`)
- **SCOWL** English dictionaries: © Kevin Atkinson and others, under permissive notices (`assets/dictionaries/*/README_*.txt`)
- **spellbook** spell checker: MPL-2.0
- **SQLite**: public domain
- **Tauri**, **ProseMirror** and other Rust and JavaScript libraries: mostly MIT and/or Apache-2.0

The full inventory, generated from the lock files, is in [docs/m0/LICENSES.md](docs/m0/LICENSES.md).
