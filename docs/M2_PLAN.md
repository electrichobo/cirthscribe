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
3. **FDX export and import** (Final Draft XML). **Built 2026-10-27** (`cirth_core::fdx`, quick-xml 0.42):
   - **Support matrix:**

     | Kolbítar | FDX written | Read back |
     | - | - | - |
     | Heading, action, character, parenthetical, dialogue, transition, shot | Same `Paragraph Type` | Same |
     | Section | `General` | Action (reported on export) |
     | Lyric | `Dialogue` | Dialogue (reported on export) |
     | Bold, italic, underline | `Text Style` | Same |
     | Dual dialogue | `DualDialogue` group | Second cue is the right column |
     | Forced page break | `StartsNewPage="Yes"` | Same |
     | Title page | Aligned `TitlePage` paragraphs | Read by position (reported) |
     | Colour, highlight | Left out (reported) | n/a |
     | Other FDX paragraph types | n/a | Action, text kept (reported) |
     | FDX scene numbers, script notes, settings | n/a | Not kept (listed in the report) |

   - Tests: three fixtures round-trip; a hand-written FDX with the cases above; escaping; broken XML and non-FDX files are refused; e2e import, report, export, re-import.
   - **Not checked against Final Draft itself**: manual check N23 is needed before any compatibility claim. This is the interchange priority in INTEROPERABILITY.md.
   - Covers paragraph types, emphasis, dual dialogue, the title page, and scene numbers once they exist.
   - Unknown elements are kept as text where possible and always listed in the import report.
   - A tested element/attribute support matrix.
   - **Needs an XML parser dependency** (decision B).
4. **Scene numbers and scene-number locking**, a separate feature from page locking. **Built 2026-10-27** (`cirth_core::numbering`, schema v4 table `scene_numbers` keyed by stable scene id; older files upgrade unlocked; tested against frozen v3 files):
   - Format > Scene Numbers: Lock (1..N), Unlock… (asks first), Omit This Scene, Restore This Scene.
   - While locked, new scenes get numbers from the scene before them (12A, 12B, 12AA, A1) and existing numbers never change. Undoing a deleted heading brings its number back.
   - Omitted scenes print as "12 OMITTED 12"; their text stays in the project.
   - Numbers appear in the scene list, both editor margins, the PDF and text exports (both margins), FDX (`Number`) and Fountain (`#12A#`). Imported numbers are kept and locked.
   - Tests: rules, store, migration, layout, both formats' round trips, e2e.
   - Not yet: FDX/Fountain have no way to mark a scene omitted, so omitted scenes are written with their text and the report says so.
   Original plan:
   - number scenes;
   - lock them (inserted scenes get A/B numbers: 12A, 12B);
   - OMITTED scenes keep their number;
   - unlocking renumbers after a confirmation.
   - Numbers appear in the scene list, the PDF margins and FDX.
5. **Production PDF.** **Built 2026-10-27:**
   - File > Export > PDF… asks where to save. Title, author and draft come from the title page into the PDF's properties.
   - Repeatable output: the same script and options give the same bytes; printpdf's random trailer ids are replaced by a stable project id, and the date is set explicitly. Tested.
   - Headers and footers (File > Headers and Footers…, tokens {title} {draft} {date}) from page 2 in PDF and text exports.
   - Scene numbers in both margins (step 4).
   - **Cross-platform reference pages (acceptance D7):** `crates/cirth-core/tests/golden.rs` compares the text layout of the three sample scripts (Letter and A4) and a numbered variant with committed files in `fixtures/golden/`. CI runs it on Windows, macOS and Linux.
   - The "proof" label is gone. The export still says that page measurements follow published guidance and have not been compared with an industry PDF; manual check N25 does that.
   Original plan:
   - headers and footers;
   - scene numbers in both margins;
   - the "draft proof" label dropped once acceptance D1, D2 and D7 pass on all three OSes;
   - repeatable output (fixed metadata), so tests can compare files.
6. **Revision sets.** **Built 2026-10-27** (`cirth_core::revisions`; schema v5 table `revision_sets`; tested against frozen v4 files):
   - Format > Revisions > Revision Sets…: sets with label, paper colour, date and margin mark, in the usual colour order (Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry, White, then "Double Blue" and so on). One set is active. A set that still marks text cannot be deleted.
   - Format > Revisions > Revision Mode: changed text is tagged with the active set (`Run::revision`, a mark on the text). The tag is added in the same editor transaction as the change, so undo removes both. A change is found by comparing each block with its previous version by stable id, on text plus printed formatting. A deletion tags the character where it happened. A block whose kind, dual setting or page break changed is tagged whole. Colour and highlight (screen only) never count; undo and redo are never tagged.
   - Printing: every line holding the active set's text gets the set's mark in the right margin (7.9 in). Those pages get the set's label and date before the page number. File > Export > Changed Pages (PDF)… prints only those pages, keeping their script page numbers (D6). Earlier sets' tags stay in the script but do not print while another set is active.
   - On screen: the active set's text is underlined in its colour, and its blocks show the mark in the margin; the status bar names the set. Colour is never the only sign.
   - Format > Revisions > Clear Marks of This Set… asks first and can be undone.
   - Fountain and FDX exports write the revised text without marks and say so in their reports. FDX revision sets are a later step if needed.
   - Not yet: marking scene moves made from the board or scene list (text that is moved, not edited, is not tagged); A/B pages (step 7). Tests: core (colour order, line marks, changed pages, store, v4→v5 migration), a golden text file of a revised dialogue page and the changed page alone, and an e2e flow on both drivers.
   Original plan:
   - named sets with date and colour (colour never the only identifier);
   - a revision mode that marks changed lines (asterisk in the margin);
   - a changed-pages export (D6).
7. **Locked pages.** **Built 2026-10-27** (`cirth_core::locked`; the baseline is stored as JSON in the document's settings, so no schema change):
   - Format > Locked Pages > Lock Pages records the pages as laid out at that moment, with scene numbers and omitted scenes. It records where each page starts (block id and offset) and which page each block starts on. Unlock Pages… asks first.
   - Afterwards each block keeps its baseline page. A new block joins the page of the block before it. A block never moves to an earlier page than the one before it, so a scene moved earlier flows in like new text.
   - Each locked page is laid out on its own. Overflow goes onto added pages (12A, 12B … 12Z, 12AA) and later pages keep their numbers (D3). A page that loses text gets shorter. A page that loses all its text folds into the page before it, which prints as "11-12" (D4). A speech cut at a locked boundary keeps its (MORE) and (CONT'D) cue.
   - Boundaries come from the stored baseline, never from a new layout. A different layout-engine version or paper size is reported as a warning and moves no boundary (D8). Pages always use the bundled font, so a missing system font changes nothing. The page size cannot be changed while pages are locked.
   - The labels appear in the editor's page markers, the PDF and the text export, the revision header, and the changed-pages export.
   - Known limits:
     - An edit before a split point inside a block that runs across a locked boundary can move that split point by the edited amount, because the stored offset counts characters.
     - Re-locking after A pages (an "A pages become real pages" renumbering) is just Unlock, then Lock.
   - Tests:
     - core: unchanged pages match exactly, A pages, shortened pages and folded pages, engine change, labels;
     - golden: both samples locked and unchanged match the unlocked reference byte for byte, and an edited page runs onto A pages;
     - store, and an e2e flow on both drivers.
   Original plan:
   - lock a baseline;
   - later edits create A/B pages instead of reflowing (D3, D4, D8);
   - a layout-engine upgrade or a missing font never reflows a locked baseline.
8. **Further exports with capability reports.** **Built 2026-10-27:**
   - File > Export > Word (.docx)…, Rich Text (.rtf)… and Web Page (.html)…, each followed by a report of what the format could not keep.
   - **Shared production view** (`cirth_core::printdoc`):
     - locked scene numbers, omitted scenes printed as OMITTED, upper case where the page shows it;
     - indents and spacing taken from the layout profile;
     - the title page as editable paragraphs: centre block a third of the way down, then contact and draft items stacked at the foot;
     - headers and footers as set for the PDF.
   - **DOCX** (`docx.rs`), a real WordprocessingML package written with `zip`:
     - Google Docs profile: one paragraph style per element, explicit paper size and margins, Courier Prime 12 pt named, exact 12 pt lines;
     - the title page is its own section; the script section numbers pages from 1 with a PAGE field and shows no number on page 1;
     - scene numbers hang in the left margin;
     - same input gives the same bytes.
   - **RTF** (`rtf.rs`): the same styles, also applied directly on each paragraph; Unicode as \uN escapes; the same section, header and page-number arrangement.
   - **HTML** (`html.rs`): a standalone page, escaped, with inline CSS and nothing to fetch; scene numbers in both margins; CSS page breaks.
   - **Reports** say what each format cannot keep:
     - the opening app lays out its own pages, so page breaks and locked labels such as 12A are not kept;
     - dual dialogue is written one speech after the other;
     - revision marks and on-screen colour are left out;
     - HTML has no page headers.
   - Not yet checked in Word, Google Docs, LibreOffice, TextEdit or a browser's print view: that is step 9 (compatibility matrix) and manual check N28.
   - Tests:
     - core: well-formed XML parts, escaping, styles and indents, repeatable bytes, RTF escapes and balanced groups, HTML escaping;
     - e2e on both drivers: the DOCX is unzipped and its document part checked.
   - Dependency: `zip` 9.1.3 (MIT; deflate through the existing `flate2` only), owner-approved. It brings `typed-path` (MIT or Apache-2.0) and, on Linux and macOS, `nix` (MIT).
   Original plan:
   - DOCX (Google Docs profile; needs a zip writer, decision B);
   - RTF;
   - HTML.
9. **Compatibility matrix:** fixtures exchanged with real external apps where available. Every external result is labelled by an actual test and its date. **Started 2026-10-27:**
   - `cirth-cli compat-pack` writes the test pack (`cirth_core::compat`): the three samples in all seven export formats, with a title page, locked scene numbers and a header. Output is byte-for-byte repeatable, with a `MANIFEST.md` of sizes and FNV-1a hashes. It is in `out/`, not committed: regenerate it from the commit being tested.
   - docs/COMPATIBILITY.md holds the status of each format, the results log, and how to test and record.
     - Recorded so far: the owner's informal HTML check, and Kolbítar's automated Fountain and FDX round trips of the whole pack (internal, not external).
   - **First external round, 2026-10-27, on the owner's Mac with pack v1:** Preview, TextEdit and Safari; Pages was not installed. Defects found and fixed in pack v2:
     - DOCX files differed between Windows and macOS (zip host OS and mode): every entry is now Unix 0644;
     - DOCX formatting was lost in TextEdit, which ignores styles: indents, spacing, alignment, font and size are now also written on each paragraph and run;
     - PDF metadata showed "KolbÃ­tar": non-ASCII Info strings are rewritten as UTF-16BE after saving, and cross-reference offsets are shifted and checked by a test;
     - PDF page size was 612.00006 pt: now exactly 612 × 792;
     - the RTF title page was not on its own page in TextEdit: the first script paragraph now also has a page break.
     Results and the remaining losses are in docs/COMPATIBILITY.md. A recheck on v2 is pending.
   - Open: external results for every format. These need the apps (Final Draft, Word, Google Docs, LibreOffice, a Fountain app, browser print) and the manual checks N22, N23, N25 and N28.

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
