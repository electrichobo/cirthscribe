# Decision register

The following defaults allow progress without pretending the owner has already selected every implementation detail.

| Topic | Current position | When to settle |
| --- | --- | --- |
| Product name | **Kolbítar** (owner, 2026-10-27; trademark and copyright checked by the owner). Public-facing text uses it; the `.cirth` extension, crate names, the binary name and the app identifier keep the old working name, and the repository stays `electrichobo/cirthscribe` | Done |
| Desktop stack | Rust + Tauri 2, accepted for M1 on Windows evidence (ADR 0001); macOS/Linux verification is an M1 gate | M0 ADR (done) |
| Web UI/editor | ProseMirror, single undo stack, Rust-owned canonical document (ADR 0001) | M0 (done) |
| Pagination authority | Rust fixed-pitch layout engine; WebView never measures pages; PDF draws the same page map (ADR 0001) | M0 (done); production rules M2 |
| Product model | Free/open-source, offline-first, no account required | Owner requirement |
| Project license | GPL-3.0-only with a section 7(b) author-attribution term (see `NOTICE`); chosen by the owner 2026-10-26. Selling is allowed by any open-source license, but sellers must pass on the full source under the GPL. | Done |
| Dependency policy | Core must build/run without paid proprietary components or secret licenses | Every adoption |
| Native extension | `.cirth` (SQLite file); confirmed by the owner 2026-10-26 | Done |
| Working storage | SQLite working copy (WAL, exclusive lock) plus atomic package save; proposal in docs/m0/SCHEMA.md | M0 prototype (done); schema v2 in M1 |
| Screenplay font | Fixed: pages and exports use Courier Prime 12 pt. Font and size choices change only the on-screen editor (owner, 2026-10-26) | Done |
| Text colour and highlight | On-screen writer's markup only: stored with the text, never printed or exported (owner, 2026-10-27) | Done |
| Pop-out panels | Panel windows are remote views; the main window stays the only authority and applies every change (ADR 0004, 2026-10-28) | Done |
| Breakdown tags and text anchors | Separate records storing `(document_id, block_id, start, end, quote)` in Unicode scalar values at the core boundary, mapped through script edits and marked orphaned when their text or block is deleted (ADR 0005, owner decision B, 2026-10-28) | Done |
| Comments | All comment work, including the add-comment button, stays in M5 (owner, 2026-10-27) | Done |
| Formatting priority | US screenplay first; UK and other templates retained in roadmap | Fixed priority, refinable with owner |
| Structural sync | Off by default; explicit per-document permission, stored with the document (M3 step 1) | Done |
| Planning undo | Two histories routed by focus: the script's in the editor, planning edits in the core; no step is in both (ADR 0003, owner decision A, 2026-10-27) | Done |
| Timing language | Estimates separate from measured on-screen duration | Fixed semantic rule |
| Google support | Tested DOCX/XLSX/CSV profiles first; live feedback later | M2/M4, integration ADR later |
| AI | Optional BYO provider/endpoint, disabled by default | M7 |
| OS support | Owner, 2026-10-26: Windows 10 or later, x64 only (no 32-bit build); macOS 11 Big Sur or later; Linux distribution-agnostic. macOS builds for both Apple Silicon and Intel, since Big Sur runs on both (inferred, not stated by the owner). Distribution-agnostic Linux needs packaging that carries or targets an old enough base (AppImage built on an older distribution, or Flatpak); a binary built on CI's Ubuntu 24.04 needs glibc 2.39 and WebKitGTK 4.1, so it would not run on older distributions. Not yet stated: Windows on ARM | Packaging before the first release |
| Fonts/dictionaries | Courier Prime (OFL 1.1) for the screenplay profile; non-Latin fallback and dictionaries unselected | Font M0 (done); fallback and dictionaries M1/M2 |
| Signing/installers | Plan separately; no promise that every release can be signed at no cost | Before distribution |
| Git-like history | In-app snapshots/branches, no Git installation requirement | M5 implementation ADR |

## Later questions that do not block drafting or M0

- Exact visual identity, keyboard cycle variants, and preferred default page profile.
- Which production revision conventions should ship as presets.
- Whether immersive storytelling first targets branching prose, interactive screenplay annotations, or another output engine.
- Windows on ARM (other platform minimums settled 2026-10-26).
- Whether private notes/history are included by default in shared native packages.

## ADR template

Title:
Status: proposed / accepted / superseded
Date:
Problem:
Options considered:
Evidence and tested platforms:
Dependency/license implications:
Decision:
Consequences and remaining limitations:
Revisit trigger:
Linked acceptance scenarios:

Do not convert a provisional suggestion into an accepted decision merely by copying it into code.

