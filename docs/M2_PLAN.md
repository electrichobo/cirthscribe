# Milestone 2 plan: professional pages and file exchange

Status: **accepted by the owner, 2026-10-27**: order as proposed (title page → Fountain → FDX); `quick-xml` and `zip` (both MIT) approved for steps 3 and 8; title page also gets WGA registration and a revision/draft label. M1 closed with its items carried forward. Builds on M1 and M1b. ROADMAP's M2 gate: locked-page editing and PDF rendering pass boundary fixtures; imports never silently discard content; results with external editors and Google are labelled from actual tests, never assumed from the file extension.

## Starting point (what exists)

- **Layout:** a fixed-pitch Rust layout engine (US Letter and A4) with (MORE)/(CONT'D), dual dialogue, forced page breaks, keep-with-next, and page numbers from page 2. It is the only authority on pages.
- **PDF "proof":** draws exactly the page map, with Courier Prime (SIL OFL 1.1) embedded via printpdf 0.7, so the text is selectable.
  - It has no title page and no scene numbers.
  - Its bytes differ on every render (per-render metadata).
- **Plain-text export** from the same page map.
- **Not yet:** title pages, scene numbering, revisions, locked pages, and any import or export format beyond PDF and TXT.

## Proposed order

Each step is a working, tested slice. Every export gets a capability/loss report, and every import reports what it could not keep.

1. **Title page.** **Built 2026-10-27:**
   - Fields: title, credit, authors, source, draft/revision label, draft date, WGA registration, contact, notes. Stored per document in the project's settings, so no schema change was needed (`cirth_core::title`).
   - Edited in File > Title Page… (also under More).
   - Printed before page 1 in PDF and text exports when it has a title; the title page is unnumbered and the script's page numbers are unchanged.
   - Layout: centre block about a third of the way down; contact bottom left; draft, date, WGA and notes bottom right.
   - Tests: core (layout, text export, storage with save/reopen) and e2e (dialog, reopen, text and PDF page counts, no title means no title page).
   - Not yet: a preview inside the app; FDX/Fountain carry it in their own steps.
   - Data: authored fields per document (title, credit, authors, source, draft date, contact, notes), stored in the project. This needs a schema v4 migration.
   - Display and editing: a title-page panel or dialog.
   - Exports: PDF and TXT.
   - Acceptance: D1 (title page).
   - Why first: it is small, it is needed by every export format below, and it touches the schema once.
2. **Fountain import and export** (plain-text screenplay interchange). **Built 2026-10-27** (`cirth_core::fountain`, no dependency):
   - **Export** (File > Export > Fountain…):
     - writes every block type, emphasis, dual dialogue (`^`), page breaks and the title page;
     - forces (`!`, `@`, `.`, `>`) whatever plain rules would misread;
     - reports that shots become action and that colour and highlight are left out.
   - **Import** (File > Import Fountain…, creating a new library project):
     - reads the title page, headings, action, cues, dual dialogue, parentheticals, dialogue, lyrics, transitions, sections, page breaks and emphasis;
     - keeps notes and boneyard as visible text;
     - reports joined line breaks, centred text, synopses and removed scene numbers.
   - Tests: three fixtures round-trip with identical blocks and title page; a hand-written file covers the spec features; forcing rules; e2e import, Home, export and re-import.
   - Not yet: Fountain's own scene numbers (step 4); line breaks inside a paragraph (blocks hold none). It needs no dependency, is easy to inspect, and gives a real round-trip test of the model, dual dialogue included (`^`). It also covers "bring an existing script in" before FDX.
3. **FDX export and import** (Final Draft XML). This is the interchange priority in INTEROPERABILITY.md.
   - Covers paragraph types, emphasis, dual dialogue, the title page, and scene numbers once they exist.
   - Unknown elements are kept as text where possible and always listed in the import report.
   - A tested element/attribute support matrix.
   - **Needs an XML parser dependency** (decision B).
4. **Scene numbers and scene-number locking**, a separate feature from page locking:
   - number scenes;
   - lock them (inserted scenes get A/B numbers: 12A, 12B);
   - OMITTED scenes keep their number;
   - unlocking renumbers after a confirmation.
   - Numbers appear in the scene list, the PDF margins and FDX.
5. **Production PDF:**
   - headers and footers;
   - scene numbers in both margins;
   - the "draft proof" label dropped once acceptance D1, D2 and D7 pass on all three OSes;
   - repeatable output (fixed metadata), so tests can compare files.
6. **Revision sets:**
   - named sets with date and colour (colour never the only identifier);
   - a revision mode that marks changed lines (asterisk in the margin);
   - a changed-pages export (D6).
7. **Locked pages:**
   - lock a baseline;
   - later edits create A/B pages instead of reflowing (D3, D4, D8);
   - a layout-engine upgrade or a missing font never reflows a locked baseline.
8. **Further exports with capability reports:**
   - DOCX (Google Docs profile; needs a zip writer, decision B);
   - RTF;
   - HTML.
9. **Compatibility matrix:** fixtures exchanged with real external apps where available. Every external result is labelled by an actual test and its date.

The exit review comes after 7–9. Steps 2 and 3 can swap if the owner wants FDX first.

## Carried from M1 (not blockers for starting M2)

- Linux desktop latency measurement and reference machines (owner);
- STATUS defect 3, the rare End-then-Enter stress miss;
- macOS recheck N20;
- Windows e2e on the hosted CI runner.

## Decisions needed

- **A. Close M1** with the carried items above? (See docs/m1/EXIT_REVIEW.md.)
- **B. Dependencies** (each needs the owner's OK and a licence check):
  - an XML reader and writer for FDX (proposal: `quick-xml`, MIT);
  - a zip writer for DOCX (proposal: `zip`, MIT), not needed until step 8.
- **C. Order:** title page → Fountain → FDX as proposed, or FDX before Fountain.
- **D. Title page fields:** the standard set above, or anything else you always use (e.g. WGA registration, copyright line, revision label).
