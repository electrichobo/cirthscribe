# Decision register

The following defaults allow progress without pretending the owner has already selected every implementation detail.

| Topic | Current position | When to settle |
| --- | --- | --- |
| Working title | CirthScribe | Revisit before public naming/branding |
| Desktop stack | Rust + Tauri 2, accepted for M1 on Windows evidence (ADR 0001); macOS/Linux verification is an M1 gate | M0 ADR (done) |
| Web UI/editor | ProseMirror, single undo stack, Rust-owned canonical document (ADR 0001) | M0 (done) |
| Pagination authority | Rust fixed-pitch layout engine; WebView never measures pages; PDF draws the same page map (ADR 0001) | M0 (done); production rules M2 |
| Product model | Free/open-source, offline-first, no account required | Owner requirement |
| Project license | GPL-3.0-only with a section 7(b) author-attribution term (see `NOTICE`); chosen by the owner 2026-10-26. Selling is allowed by any open-source license, but sellers must pass on the full source under the GPL. | Done |
| Dependency policy | Core must build/run without paid proprietary components or secret licenses | Every adoption |
| Native extension | .cirth proposed (SQLite file); owner confirmation pending | M1 |
| Working storage | SQLite working copy (WAL, exclusive lock) plus atomic package save; proposal in docs/m0/SCHEMA.md | M0 prototype (done); schema v2 in M1 |
| Formatting priority | US screenplay first; UK and other templates retained in roadmap | Fixed priority, refinable with owner |
| Structural sync | Off by default; explicit per-document permission | M3 behavior |
| Timing language | Estimates separate from measured on-screen duration | Fixed semantic rule |
| Google support | Tested DOCX/XLSX/CSV profiles first; live feedback later | M2/M4, integration ADR later |
| AI | Optional BYO provider/endpoint, disabled by default | M7 |
| OS support | Windows/Mac/Linux; exact versions/architectures not yet selected | M0/M1 platform matrix |
| Fonts/dictionaries | Courier Prime (OFL 1.1) for the screenplay profile; non-Latin fallback and dictionaries unselected | Font M0 (done); fallback and dictionaries M1/M2 |
| Signing/installers | Plan separately; no promise that every release can be signed at no cost | Before distribution |
| Git-like history | In-app snapshots/branches, no Git installation requirement | M5 implementation ADR |

## Later questions that do not block drafting or M0

- Exact visual identity, keyboard cycle variants, and preferred default page profile.
- Which production revision conventions should ship as presets.
- Whether immersive storytelling first targets branching prose, interactive screenplay annotations, or another output engine.
- Which minimum OS versions and CPU architectures should be supported at launch.
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

