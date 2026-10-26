# Roadmap and exit gates

Milestones are capability gates, not delivery-date promises. Finish a stable slice before expanding scope. Each gate records platforms tested, remaining defects, fixture versions, and dependency licenses.

## M0: Feasibility and framework decision

Deliver a small editor/layout spike, not a full application:
- Canonical scene/block IDs, basic typed blocks, contextual Tab/Enter.
- Selection, paste, undo/redo, Unicode/IME checks.
- Save/reopen and crash-recovery proof.
- The same scene shown in editor, navigator, and a linked card.
- Long screenplay fixture, dialogue splits, dual-dialogue layout proof, PDF prototype.
- A concrete proposed native schema/container.
- Dependency/font/license inventory and measured stack decision.

Suggested initial performance budgets, to validate rather than advertise: a 120-page synthetic screenplay, p95 input-to-paint below 50 ms in the reference environment, warm open below 3 seconds, and no visible main-thread pauses during autosave. Record hardware, OS, versions, sample method, and results. Change targets only with a documented reason.

Exit: record accepted stack and critical risks. If only one OS was available, record the others as untested and make their verification part of M1. Do not pretend one-platform results establish full support.

## M1: Dependable writing foundation

- Working app shell and keyboard-first screenplay editor.
- US feature-screenplay profile, Letter/A4 controls, project tree, stable IDs.
- Create/open/save/save-as, autosave, undo/redo, recovery, backups, migration guards.
- Find/replace, character/location suggestions, block/selection/document word counts.
- Local spell-check and user dictionary.
- Independent workspace Free Writing.
- Native project package and TXT export.
- Accessible panel/focus behavior and draft page preview.

Exit: a user can write and safely recover a complete screenplay. Editing smoke tests pass on Windows, Mac, and Linux. No unresolved corruption/data-loss defects.

## M2: Layout, interchange, and production baseline

- Authoritative pagination/PDF output with licensed bundled font strategy.
- Title pages, dual dialogue, continuation rules, headers/footers, page breaks.
- Scene numbers, omitted scenes, revision sets, locked production pages.
- PDF, FDX, DOCX, RTF, TXT, and HTML document exports with capability reports.
- FDX import as a practical interchange priority; explicit scope for unsupported features.
- Verified fixture exchange and baseline compatibility matrix.

Exit: locked-page editing and PDF rendering pass boundary fixtures. Imports do not silently discard content. External editor/Google results are labeled by actual tests, not assumed from file extensions.

## M3: Connected story development

- Nested episodes and mixed document containers with shared bible.
- Navigator, hierarchical outline, notes/bookmarks.
- Corkboard and mind map, images/video links.
- Permission-controlled bi-directional scene ordering.
- Independent chronological story timeline.
- Character/location/world profiles and aliases.
- Non-AI bible extraction/refresh with provenance and review.

Exit: cards, navigator, script, chronology, and bible stay consistent after edits and undo. No duplicated scene prose or accidental reorder.

## M4: Production analysis and stripboard

- Range/entity tags with correction controls.
- Independent character, scene, location, prop/category, and revision reports.
- Vertical stripboard and independent scheduling order.
- Page/eighth calculations tied to a stated layout/scope.
- Character participation charts with honest timing labels.
- PDF/RTF/HTML reports; PDF/HTML stripboards.
- XLSX and CSV/TSV for tabular reports/stripboards.
- Google Docs/Sheets compatibility-profile testing.

Exit: each report works independently; manual schedule data survives script changes; charts and reports agree on selected branch/scope.

## M5: Review, alternatives, and branches

- Anchored local comment threads, inline/side-panel presentation, resolved/orphan behavior.
- Non-destructive alternatives with one explicit active selection.
- Named snapshots, visual branch history, compare/restore.
- Base/source/target integration with conflict review.
- Branch-aware bible facts, reports, page baselines, comments, and schedules.
- Optional portable review package before online services.

Exit: conflicting changes never disappear silently. Branches and alternatives survive native save/export/reopen without affecting unrelated work.

Comment and branch anchors must be designed earlier even though the full UI ships here.

## M6: Additional formats and language tools

- TV and UK profiles, stage plays, comics/graphic novels.
- Immersive passages/choices with valid references and format-specific exports.
- General rich-text documents and improved visual input forms.
- Offline-capable grammar adapter, dictionaries, correction UI.
- Format-specific templates and separate acceptance fixtures.

Exit: each advertised format has an actual structured editor, export behavior, and tests. A label in a template menu does not count as support.

## M7: Optional integrations

- Bring-your-own AI provider/local endpoint.
- Organizational/analytical suggestions first; user-enabled generative tools later.
- Scope disclosure, credentials, diff review, cancellation, stale-result checks.
- Optional Google review/share workflow explored separately.
- Any live collaboration requires an ADR and explicit consistency model.

Exit: disabling integrations leaves a complete offline app. No unsolicited network requests or hidden manuscript transfer.

## First usable release versus full scope

M1 can be a private alpha for writing. Do not call it a full professional replacement.
A production-focused public release needs M2's pagination/interchange gate and packaging checks.
The full requested feature set extends through M7. No date estimate is credible until the editor/layout spike has measured the largest risks.

## Every milestone's definition of done

A real usable workflow, relevant tests, documentation/status updates, recoverable data changes, honest unsupported-feature messaging, dependency/license checks, and evidence for each claimed platform.

