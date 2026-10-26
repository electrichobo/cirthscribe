# Decision register

The following defaults allow progress without pretending the owner has already selected every implementation detail.

| Topic | Current position | When to settle |
| --- | --- | --- |
| Working title | CirthScribe | Revisit before public naming/branding |
| Desktop stack | Prefer Rust + Tauri; C# + Avalonia allowed if evidence favors it | M0 ADR |
| Web UI/editor | TypeScript structured editor such as ProseMirror is a candidate | M0 |
| Product model | Free/open-source, offline-first, no account required | Owner requirement |
| Project license | Unselected; permissive versus reciprocal licensing needs owner choice | Before public source release |
| Dependency policy | Core must build/run without paid proprietary components or secret licenses | Every adoption |
| Native extension | Propose .cirth | M0 schema/container decision |
| Working storage | Evaluate local SQLite; portable versioned package | M0 recovery prototype |
| Formatting priority | US screenplay first; UK and other templates retained in roadmap | Fixed priority, refinable with owner |
| Structural sync | Off by default; explicit per-document permission | M3 behavior |
| Timing language | Estimates separate from measured on-screen duration | Fixed semantic rule |
| Google support | Tested DOCX/XLSX/CSV profiles first; live feedback later | M2/M4, integration ADR later |
| AI | Optional BYO provider/endpoint, disabled by default | M7 |
| OS support | Windows/Mac/Linux; exact versions/architectures not yet selected | M0/M1 platform matrix |
| Fonts/dictionaries | Redistributable and reproducibly available, exact choices unselected | M0/M1 |
| Signing/installers | Plan separately; no promise that every release can be signed at no cost | Before distribution |
| Git-like history | In-app snapshots/branches, no Git installation requirement | M5 implementation ADR |

## Later questions that do not block drafting or M0

- Preferred open-source license and whether derivative distributions must publish changes.
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

