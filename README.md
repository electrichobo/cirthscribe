# Kolbítar

A free, open-source screenplay writing and story-production app for Windows, macOS and Linux. It works offline, needs no account, and has no subscription.

Created by Jared Hoy ([electrichobo](https://github.com/electrichobo)). Free and open source under GPL-3.0 ([details](#license)).

> **0.8.1 RC Alpha: a test release.** Kolbítar is feature-complete for its first release and is now being tested by real writers. Expect rough edges. Keep your own copies of anything important (File > Save As, or export to PDF or Fountain), and please [report what you find](#how-you-can-help).

## Download

Get the latest build from [Releases](https://github.com/electrichobo/cirthscribe/releases):

| System | File | Notes |
| - | - | - |
| Windows 10 or later (64-bit) | `Kolbítar_0.8.1_x64-setup.exe` | The installer is not code-signed yet, so Windows SmartScreen may warn you. Choose **More info**, then **Run anyway**. |
| macOS 11 or later | `Kolbítar_0.8.1_aarch64.dmg` (Apple silicon) | The app is not signed or notarized yet. Open the disk image and drag Kolbítar to Applications. The first time, right-click (or Control-click) the app and choose **Open**, or allow it in System Settings > Privacy & Security. |
| Linux | `.deb` (Debian, Ubuntu and relatives) or `.AppImage` | Not yet: Linux builds are on hold while the Windows and macOS versions mature. You can [build from source](#building-from-source) meanwhile. The `.deb` also registers `.cirth` files and their icons. |

Kolbítar never checks for updates by itself. Use **Help > Check for Updates…** to open the Releases page; each release lists what changed.

## What it is

Kolbítar is one app for the whole path from first idea to shooting script:

- **Write.** A screenplay editor that formats as you type: scene headings, action, characters, dialogue and transitions, with industry-standard pages. Also stage plays, multi-camera TV, comics, interactive stories and treatments.
- **Plan.** Outlines, index cards, a beat board, a story timeline, an evidence board, and a "bible" of your characters, locations and world. These are all views of the same script, so they never drift out of sync.
- **Prepare for production.** Breakdown tags, reports, character sides and a stripboard, built straight from the script.
- **Revise.** Revision sets in the standard colours, locked pages and scene numbers, snapshots, branches, alternate takes, and comments you can share as a review package.
- **Exchange files.** PDF, Final Draft, Fountain, Word, RTF, HTML and plain text, with an honest report of anything a format can't carry.

It is built around a few promises:

- **Free, with no catches.** No subscriptions, paywalls or paid tiers.
- **Your work stays on your computer.** Nothing is uploaded, nothing phones home, and no cloud account is needed.
- **Your work is protected.** Autosave, rolling backups, crash recovery and undo.
- **AI is optional and off by default.** If you turn it on, you choose the provider, and it never changes your script without showing you first.

New to it? **Help > Software Tour** walks through the main parts, and the Home screen has a sample script, *The Obsidian Seal*, to explore.

## How you can help

This alpha is for finding problems before a wider release. Every report helps.

1. **Use it for real writing**, and try the parts you would actually use: planning, revisions, production reports, exports.
2. **Report bugs and rough edges** in [GitHub Issues](https://github.com/electrichobo/cirthscribe/issues). Please include:
   - your system (Windows, macOS or Linux, and its version) and the Kolbítar version (Help > Licences… shows it);
   - what you did, what you expected, and what happened instead;
   - a screenshot if it helps.
   Don't attach a script you want to keep private: describe the problem, or make a small test project that shows it.
3. **Check other apps.** Open Kolbítar's exports in the apps you use (Final Draft, Word, Google Docs, Fountain apps, PDF readers) and tell us what came through and what didn't.
4. **Run a manual check.** [docs/testing/MANUAL_CHECKS.md](docs/testing/MANUAL_CHECKS.md) lists checks that need a person, many not yet run. Pick one for your system and post the result as an issue.
5. **Suggest improvements** in Issues too. Say what you were trying to do; that matters more than a specific solution.

## Known limits in this alpha

- Chinese, Japanese and Korean show on screen but do not print in PDFs yet; the export tells you when this happens. Hebrew, Arabic and Devanagari print.
- Word, RTF and HTML exports print dual dialogue one speech after the other.
- Exchange with Final Draft and other screenwriting apps has been built from their published formats but not yet tested in those apps.
- Installers are not code-signed, so Windows and macOS show a warning the first time (see [Download](#download)).
- Screen readers have not been tested, and input methods (IMEs) have only been tested in simulation.
- Not yet tried: macOS 11 (the oldest supported version) and Intel Macs.

The full list of what has and hasn't been tested is in [STATUS.md](STATUS.md).

## Building from source

Requirements: Rust (stable), Node.js 24, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```
cargo test -p cirth-core
cd app && npm ci && npm run build && cd ..
cargo build -p cirthscribe --release
```

Windows developers can load a checkout-local toolchain with `scripts/dev-env.ps1`. End-to-end tests: `cd app; npm run e2e:cdp` (Windows) or `npm run e2e:webdriver` (needs `tauri-driver` and the platform's WebDriver). See [STATUS.md](STATUS.md) for details.

## How it is built

- **Core** (`crates/cirth-core`, Rust): the document model, the storage (a SQLite working store and the `.cirth` package), page layout, title pages, scene numbering, revision sets and locked pages, production reports, PDF, text, Word, RTF and HTML export, Fountain and Final Draft exchange, word counts, spell check and Free Writing. It has no UI code.
- **App** (`app/`, Tauri 2 + TypeScript + ProseMirror): the desktop shell and editor. The editor is a view of the core's document and sends versioned edits to it, so there is one saved copy of the script.
- **Tests**: Rust unit and integration tests, plus an end-to-end suite that drives the real app through two drivers (DevTools and WebDriver).

## Documentation

| File | What it covers |
| - | - |
| [STATUS.md](STATUS.md) | What works, what was tested on which system, known defects, and the stage-by-stage checklist |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Full feature specification |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones and their exit gates |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, persistence and layout strategy |
| [docs/INTEROPERABILITY.md](docs/INTEROPERABILITY.md) and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Export formats, what each can carry, and what has been tested in other apps |
| [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/adr/](docs/adr/) | Accepted decisions and open questions |
| [docs/testing/MANUAL_CHECKS.md](docs/testing/MANUAL_CHECKS.md) | Checks that need a person, with results |
| [AGENTS.md](AGENTS.md), [START_HERE.md](START_HERE.md) and [HANDOFF.md](HANDOFF.md) | Rules and session handoff for AI coding agents working on this repository |

## Contributing

Code contributions are accepted under the same license as the project (GPL-3.0-only, below). For bugs and ideas, see [How you can help](#how-you-can-help).

## License

Kolbítar is free and open-source software under the **GNU General Public License, version 3 only** ([LICENSE](LICENSE)), with one additional term under section 7(b) ([NOTICE](NOTICE)).

In plain terms (the license text is what counts):

- **Use it for free, for anything**, including professional and commercial writing. Your scripts are yours; the license covers the app, not what you write with it.
- **Change it and share it.** Forks and modified versions are welcome.
- **Keep it open.** Anyone who distributes Kolbítar or a modified version must give it out under the same license, with its full source code.
- **Keep the credit.** Copies and modified versions must keep the attribution "Based on Kolbítar by Jared Hoy", in the NOTICE file and on any About or credits screen.
- **No warranty.** It is provided as is.

The GPL does not forbid charging for copies; no open-source license can. But anyone who sells Kolbítar or a version of it must hand buyers the full source under the GPL, and buyers may then share it for free. Kolbítar itself will always be free.

## Third-party components

Kolbítar ships with these components under their own licenses:

- **Courier Prime** font: SIL Open Font License 1.1 (`assets/fonts/courier-prime/OFL.txt`)
- **Noto Sans**, **Noto Serif**, **Noto Sans Hebrew**, **Noto Sans Arabic**, **Noto Sans Devanagari** and **Noto Sans SC** fonts: SIL Open Font License 1.1 (`assets/fonts/noto-*/OFL.txt`)
- **SCOWL** English dictionaries: © Kevin Atkinson and others, under permissive notices (`assets/dictionaries/*/README_*.txt`)
- **spellbook** spell checker: MPL-2.0
- **SQLite**: public domain
- **Tauri**, **ProseMirror** and other Rust and JavaScript libraries: mostly MIT and/or Apache-2.0

The full inventory, generated from the lock files, is in [docs/m0/LICENSES.md](docs/m0/LICENSES.md).
