# Spell check: options compared (M1)

Status: proposal, 2026-10-26. No dependency added yet; the owner decides.

Requirement (PRODUCT_SPEC 2, M1 plan 3): local spell check that works offline, US and UK English, project names (characters, places), a user dictionary, ignored words, undoable replacements. Grammar is separate and later.

## Measured

Throwaway benchmark (scratch project outside the repo, release build, i9-9900K, Windows 11): spellbook 0.4.2 with SCOWL dictionaries 2026.02.25, against the 127-page synthetic script (2,048 blocks, 29,685 words).

| | en_US | en_GB-ise | en_US-large | en_GB-large |
| - | - | - | - | - |
| Dictionary load | 7.7 ms | 7.7 ms | 12.5 ms | 12.2 ms |
| Check every word of the script | 3.3 ms | 3.2 ms | 3.3 ms | 3.2 ms |
| Suggestions for one word | 6 to 31 ms | 6 to 29 ms | 11 to 28 ms | 11 to 21 ms |
| Words flagged in the script (distinct) | 11 | 11 | 9 | 9 |
| ...after adding the 10 character names at runtime | 2 | 2 | 1 | 1 |
| `.dic` size (zip) | 497 KB (183) | 497 KB (183) | 823 KB (292) | 838 KB (296) |

Observations:
- US and UK separate correctly (color/colour, realize/realise; each suggests the other).
- The standard-size dictionaries flag café and naïve; the large ones accept them. Crème, brûlée and Zoë are flagged by all four (project or user dictionary words).
- All-caps possessives ("HARBORMASTER'S") are flagged although the word is known: our checker should also try the ordinary-case form of all-caps words (cues, headings).
- Runtime `add` works for names; case follows Hunspell rules ("Margit" accepts Margit and MARGIT, not margit).

The built-in WebView spell check (WebView2 on Windows, with `spellcheck="true"` on the editor) was also tried in the running app: it underlines misspellings in typed text, using the Windows language (US here), and skips all-caps words entirely.

## Options

| Option | Licence | What it gives | Problems |
| - | - | - | - |
| **A. spellbook (pure Rust) + SCOWL "large" dictionaries** (recommended) | spellbook MPL-2.0 (one dependency, hashbrown; foldhash optional). SCOWL: permissive notice (keep copyright notice in copies and docs); affix file BSD-style (Kuenning) | Same results on Windows, macOS and Linux. Language per project (US/UK). Runtime project and user dictionaries; ignore lists. Fast enough to check the whole script on open and each block on edit. Underlines drawn by us as editor decorations (never manuscript text) | spellbook is labelled alpha (pin the exact version; API may change). No phonetic suggestions. English only until other dictionaries are added. Adds about 1.6 MB of dictionary files (about 0.6 MB zipped) |
| B. Built-in WebView spell check | None (part of the OS/WebView) | Zero code; native squiggles and context-menu suggestions | Language follows the OS, not the project (a UK script on a US machine is marked wrong). No project or user dictionary API found for WebView2. Behaviour differs per platform (WebKitGTK needs Enchant and is off by default; macOS uses system settings). Skips all-caps words. Fails the spec's project-name and US/UK requirements |
| C. Hunspell C library via Rust bindings | Hunspell MPL-1.1/GPL-2/LGPL-2.1 tri-licence | The reference implementation, phonetic suggestions | C++ build on three platforms and two Windows toolchains; same dictionary work as A |
| D. JavaScript (nspell, typo.js) | MIT / BSD | Runs in the WebView | Slow and memory-heavy for long scripts; runs on the UI thread; slower suggestions |
| zspell (Rust) | Non-standard licence field on crates.io | Similar to A | Last release June 2024; licence needs separate review. Not pursued |

## Recommendation

Option A: add `spellbook = "=0.4.2"` and bundle SCOWL en_US-large and en_GB-large (with their README/copyright files, listed in LICENSES.md). Checking runs in Rust: the whole script on open (about 3 ms), changed blocks after each sync. The UI draws underlines, offers suggestions on right-click and in a small menu, and supports "Add to project dictionary" (stored in the project's settings), "Add to my dictionary" (app data) and "Ignore". Replacements go through the editor, so they are undoable. Character cue names are added to the project dictionary automatically. Spelling language is a project setting, separate from page size (Letter/A4), as the spec requires.

MPL-2.0 matches the five MPL-2.0 crates already in the build (file-level copyleft; fine to distribute; note when choosing the project licence).
