# M0 findings: editor and layout feasibility spike

Date: 2026-10-25. Status: measured on one Windows machine only. Everything below is labeled as **measured**, **observed**, **untested** or **open**.

## What was built

A small Rust + Tauri 2 + ProseMirror prototype (`app/`, `crates/cirth-core/`). It is a spike, not the M1 app.

| Area | Implementation |
| - | - |
| Canonical document | Rust working store (SQLite) owns blocks, scenes, beats and an op log. The editor is a projection that submits versioned batches (`apply_batch`, base-version check, idempotent `tx_id`). |
| Typed blocks | One ProseMirror node type with a `kind` attribute: heading, action, character, parenthetical, dialogue, transition, shot, section, lyric. Dual dialogue is a flag on the right-hand cue. Forced break is a flag. |
| Stable IDs | UUID per block; `scene_id` on heading blocks. Duplicate/missing ids are repaired in one place (`app/src/ids.ts`) with a documented rule: the block at the original's mapped position keeps the id. Scenes retired when a heading is removed stay in the `scenes` table. |
| Tab / Enter | Config-driven cycles (`app/src/keys.ts`), Ctrl+1..9 direct type, Escape leaves the editor. Never inserts spacing characters. |
| Undo | One stack (ProseMirror history). Undo is an ordinary change that syncs to Rust. Navigator and board scene moves are editor transactions, so they undo in the same stack. |
| Paste / copy | Multi-line plain text is parsed into typed blocks and inserted as whole blocks; HTML (Word, browsers) goes through the schema parser; copy writes plain text with blank lines between blocks. |
| Navigator / board | Derived from the editor document by scene id. Board cards hold an authored summary (separate entity) plus a live read-only excerpt. "Board may reorder script" toggle: off = planning order only, with a visible "Planning only" badge; on = card moves issue MoveScene. |
| Pagination | Rust layout engine (`crates/cirth-core/src/layout.rs`) for a fixed-pitch profile: wraps by display columns, keeps headings with the next block, keeps cue and parentheticals with dialogue, splits speeches with (MORE) / CONT'D, splits action at sentence ends with 2-line minimums, lays out dual dialogue side by side, honors forced breaks. Editor page markers come from this map, never from the DOM. |
| PDF | `printpdf` draws exactly the page map with embedded Courier Prime (OFL). **Proof of concept, not production-ready.** |
| Save / recovery | WAL + `synchronous=FULL`; exclusive lock per project; package (`.cirth`) written by `VACUUM INTO` temp, flush, rename; reopen detects unsaved working-store commits and recovers them. |

## Platform coverage

| Platform | Status |
| - | - |
| Windows 11 IoT Enterprise LTSC 2024 (10.0.26100), x64, WebView2 155.0.4283.62 | **Measured** (all results below) |
| Windows built with MSVC toolchain | **Untested.** This machine used the Rust GNU toolchain (see ADR 0001). |
| macOS (WKWebView) | **Untested** |
| Linux (WebKitGTK) | **Untested** |
| High DPI, screen readers, keyboard-only walk-through | **Untested** beyond focusable controls and labels |

Reference machine: Intel Core i9-9900K, 64 GB RAM, NVIDIA RTX 5060 Ti. Release build, Rust 1.99.1 (x86_64-pc-windows-gnu), Tauri 2.12.5, ProseMirror view 1.42.8.

## Automated results

Rust core: 17 tests (`cargo test -p cirth-core`), all passing.

- Layout: text preservation (every character placed exactly once), page rules (never ends a page on a cue or parenthetical, every (MORE) followed by CONT'D), boundary fixture cases, determinism, Letter vs A4, edit at page 60 does not change pages 1 to 59.
- Store: round trip with marks and Unicode, stale and duplicate batches, invalid batches roll back fully, moves keep ids, second writer refused in-process and cross-process, **hard process kill after 25 acknowledged commits keeps all 25**, kill mid-transaction leaves the previous state and a clean integrity check, package save atomic with a stray temp file present, recovery detection, future schema refused.
- Font: Courier Prime advance is exactly 0.6 em in all four styles (10 cpi at 12 pt); missing glyphs are detected.

End-to-end in the real WebView2 app (`app/tests/e2e.mjs`, driven through the DevTools protocol): 12/12 passing plus one known-defect probe. Raw results: `docs/m0/e2e-results-2026-10-25.json`.

| Acceptance | Result |
| - | - |
| A2 Tab/Enter/Shift+Tab, configurable cycle, no spacing characters, one-step undo of a type change | **Pass** |
| A3 Cross-block selection replace, split/join, paste plain/HTML, OS clipboard copy and paste, accents/emoji ZWJ/combining/CJK/RTL typing | **Pass** (synthetic input, see limits) |
| A3 IME | **Pass with simulated composition only** (`Input.imeSetComposition`). A real Windows IME was **not** tested: enabling one changes system input settings on this machine. |
| A5 Crash after acknowledged autosave | **Pass**: process tree killed with `taskkill /F`; reopen recovered the acknowledged text and showed a recovery notice. Keystrokes still inside the debounce window were not claimed. |
| A6 Second writer | **Pass**: second app instance refused with a clear message; first instance unaffected. |
| A7 Future schema | **Pass** (refused). Migration of an older schema: not built in M0. |
| B1 Live excerpt follows script edits, summary unchanged | **Pass** |
| B2 Permission off: card move does not reorder script; "Planning only" visible | **Pass** |
| B3 Permission on: scene order changes once, ids stable, one undo restores, store matches editor | **Pass** |
| D2 Zoom does not change the page map | **Pass** (page map is computed in Rust) |
| D1 Selectable PDF text, embedded fonts | **Pass** for Latin text (checked with pypdf 5.4.0). Title page: not built. |

## Measurements (120+ page fixture: 2,048 blocks, 121 scenes, 127 Letter pages)

All times are from one run on the reference machine; sample method in brackets.

| Metric | Budget (ROADMAP) | Measured |
| - | - | - |
| Input to next paint, typing mid-document (530 keys; keydown timestamp to a task after the next animation frame; excludes OS input queue and display scan-out) | p95 < 50 ms | p50 17.8 ms, **p95 29.7 ms**, p99 36.9 ms, max 135 ms (one outlier) |
| Warm open (reopen existing package: Rust open + IPC + editor build + first paint) | < 3 s | **65 ms** (Rust 36 ms) |
| Cold open (seed from fixture, write package) | none | 165 ms |
| Main-thread pauses during autosave (Long Tasks API, supported in this WebView2) | none visible | **0 long tasks** over 12 batches |
| Autosave batch round trip (diff + IPC + SQLite commit with fsync) | none | p50 4.1 ms, max 36 ms; diff 0.5 ms |
| Pagination of the canonical document in Rust (load + layout) | none | 2.5 ms + 14.9 ms |
| PDF render (CLI, debug build of core) | none | 74 ms for 127 pages, 1.3 MB |
| Scene move (first to last scene): editor transaction / store commit | none | 70 ms / 9 ms |

The pixel-level latency of physical keystrokes was not measured.

Run-to-run variance (added in M1, four suite runs on the same machine, same fixture): p95 29.4 to 34.6 ms, but p99 33 to 134 ms and max 65 to 266 ms. No long tasks were recorded in any run, so the tail spikes are not blocking JavaScript; cause not yet identified (compositor or OS scheduling are guesses). Treat single-run p99 figures as unreliable until the tail is explained.

## Failures found and fixed during the spike

1. `File::sync_all` on a read-only handle fails on Windows (Access denied). Package flush now opens the temp file writable.
2. Multi-line plain-text paste merged the first pasted block (a scene heading) into the block at the caret: ProseMirror's default slice fitting. Replaced with explicit block insertion rules (`insertBlocks`).
3. Harness issues (not app defects): `Set-Clipboard` via piped stdin set nothing; separate WebView2 profiles are needed for parallel instances.

## Open defects

1. ~~Native End key right after typing can be missed by the editor.~~ **Fixed in M1 (2026-10-25).** Root cause: Chromium reports native caret moves through an asynchronous `selectionchange` event, and ProseMirror adopts the DOM selection only when that event runs. With a busy main thread (right after open) it arrived ~50 ms late, so an Enter in between split the block at the old caret. Fix: `app/src/selsync.ts` adopts the DOM selection before every key command. Evidence: the original repro (3/3 runs), a startup regression test, and a stress test under an ~80% busy main thread (fix off: 28/50 trials wrong; fix on: 0/500). Typing latency unchanged (p95 29.4 ms). See `docs/m1/e2e-*-2026-10-25.json` (the stress control also detects the bug under WebDriver: 42/50). Physical keystrokes not tested; the mechanism applies to them too.
2. Linker warning on the GNU build: ".rsrc merge failure: multiple non-default manifests". The app runs; consequence unknown (possible missing common-controls manifest). Expected to disappear with MSVC builds; verify.

## Unresolved risks

| Risk | Why it matters | Next step |
| - | - | - |
| macOS and Linux WebViews | Selection, IME and clipboard behavior differ per WebView; only WebView2 measured | M1 gate: run `e2e.mjs`-equivalent checks on WKWebView and WebKitGTK (needs a WebDriver-based harness; the DevTools protocol is WebView2-only) |
| Real IME | Simulated composition is not an OS IME | Manual checklist with Microsoft Japanese/Chinese/Korean IME and macOS input sources |
| Glyph coverage | Courier Prime lacks CJK, Hebrew, Arabic, emoji and U+0301; PDF drops them; fixed-pitch layout assumes 1 or 2 columns | Decide a fallback font strategy with its own metrics, and block production PDF when glyphs are missing |
| RTL and bidi | Layout engine treats text as LTR columns | Out of scope until a non-Latin profile; keep the missing-glyph warning |
| Layout profile accuracy | Margins and widths follow common guidance, not checked against industry PDFs | M2 fixture comparison |
| Atomic rename durability | `std::fs::rename` does not request write-through; no directory fsync on Windows | **Done in M1:** `MoveFileExW(MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH)` on Windows, rename + directory fsync on Unix (`fsutil.rs`). Power-loss behavior itself is not tested. |
| Whole-document scene moves | Diff uses LIS so only moved blocks are written; editor side took 70 ms for a full-length move | Acceptable; recheck on slower hardware |
| GNU-built Windows exe | Needs `WebView2Loader.dll` beside the exe (MSVC links it statically) | Release builds use MSVC in CI |
| printpdf | Embeds whole fonts (no subsetting); no tagged PDF | Evaluate subsetting/tagging or another writer in M2 |

## Not built in M0 (stays in the roadmap)

Title page, scene numbers, revisions and locked pages, A/B pages, find/replace, spell check, autocomplete, Free Writing, exports other than the PDF proof, multi-document projects, bible, reports, stripboard, comments, branches, AI. The A4 profile exists in the layout engine only.
