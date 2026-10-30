# Interoperability and export contract

## The promise

Native format retains CirthScribe's complete project semantics. External formats retain supported content and formatting, accompanied by a readable capability/loss report where needed.

"100% compatible with Google Docs and Sheets" is a goal of convenient tested exchange, not a guarantee of identical page layout, executable story behavior, comments, revision controls, or full native round-trip. Plain text cannot retain typography; Google Sheets is a table destination, not a screenplay pagination engine.

## Required end-state matrix

| Output | Documents | Independent reports | Stripboard | Fidelity target |
| --- | --- | --- | --- | --- |
| .cirth (proposed) | Whole native project, including mixed document kinds | Save report settings/annotations in project | Save schedule/order in project | Full native fidelity including IDs/history/assets under the declared schema |
| .docx | Required | Useful optional readable report export | Optional | Editable paragraphs/styles/indents; Google Docs profile |
| .fdx | Required for compatible screenplay/TV content | No | No | Supported screenplay structures; explicit unsupported-field report |
| .pdf | Required | Required | Required | Authoritative paginated visual artifact; embedded font strategy |
| .rtf | Required | Required | Optional | Editable text/basic styles, best supported structural fidelity |
| .txt | Required | Optional | Optional table text | Text/reading order; no typography or production semantic guarantee |
| .html | Required | Required | Required | Escaped semantic content, readable browser/print views |
| .xlsx | No | Required for tabular reports | Required as tabular rows | Google Sheets-friendly cells, headings, types, totals |
| .csv/.tsv | No | Required for tabular reports | Required as tabular rows | Unicode text exchange; no styling/multiple-sheet guarantee |
| .fountain | Proposed addition | No | No | Screenplay plain-text interchange with stated syntax limits |

Use real serializers. Do not store HTML under a .docx extension or invent proprietary XML elements without compatibility testing.

Not all document kinds map to all formats. An immersive graph cannot be represented as an ordinary FDX screenplay without flattening. A comic's panel semantics may survive as readable text in DOCX but are not a native screenplay feature. Provide an explicit flattening preview or mark the combination unsupported.

## Export selection and visibility

Users choose scope: current document, selected scenes, episode set, project, branch/snapshot, revision set, selected report, or schedule. Show omitted-content and inactive-alternative options.

Default exports contain the selected active script, not every historical branch. Comments, private notes, AI prompts, hidden alternatives, and profile data are excluded unless explicitly selected. A native project export is different: preview which assets/history/private material the package includes.

An export must not mutate the source, replace the native project, or mark unimplemented fidelity as successful.

## Google Docs profile

Use semantic DOCX paragraph styles for screenplay roles, explicit paper dimensions/margins, supported spacing/indents, and conservative headers/footers. Preserve editable text instead of page images or manually spaced alignment.

Acceptance checks:
- Every expected paragraph/character is present in reading order.
- Scene headings, character cues, dialogue, emphasis, and basic indent relationships survive.
- UK spelling and Unicode are preserved as text.
- Tables and optional comments are verified only where actually supported.
- Record title-page, dual-dialogue, headers/footers, and page-break behavior.
- Page count/line breaks may change after import. PDF remains the authoritative visual reference.

The first version can export files for manual upload. A direct Drive conversion connector is a separate optional feature. Query current conversion support if implementing an API route. Successful upload alone is not a layout test.

## Google Sheets profile

Export script-derived tables as XLSX plus CSV/TSV. Examples: scene rows, cast appearances, props, duration metrics, stripboard rows, and schedule order.

Include:
- Stable source IDs in optionally hidden/dedicated columns.
- Human-readable scene numbers separately from IDs.
- Explicit scope/version, units, date/time convention, and timing methodology.
- Consistent column names, one header row per table, no layout-only merged cells in data regions.
- Separate sheets for distinct report categories when bundled; independent exports still work.
- Safe handling of leading formula characters and correct CSV quoting/newlines/encoding.

Test import, row/column counts, Unicode, booleans/numbers, duration units, and totals. Never rely on Excel-only macros or formulas for essential report meaning.

Editing an exported spreadsheet does not automatically edit the screenplay or schedule. Any future re-import requires stable-ID reconciliation, conflict review, and a dry-run preview.

## Google Docs & Sheets Collaboration Workflows (M7)

### 1. Google Docs (.docx) Export & Collaboration Workflow

Kolbítar provides a dedicated WordprocessingML (.docx) exporter designed specifically for clean import into Google Docs and Microsoft Word:

- **Generating the Export:** Choose `File > Export… > Word (.docx)`. The dialog presents an instant fidelity analysis badge and loss warnings.
- **Uploading to Google Drive:** Drag the `.docx` file into Google Drive and select "Open with Google Docs".
- **Collaborator Mode:** Recommend external readers and co-writers use **"Suggesting" mode** in Google Docs. This prevents accidental disruption of screenplay margins or element indentation styles.
- **Preserved Semantics:**
  - Standard screenplay elements (Scene Heading, Action, Character Cue, Parenthetical, Dialogue, Transition) map directly to dedicated named Word styles.
  - Page dimensions (US Letter or A4) and precise margin offsets (1.5" left margin, standard character/dialogue indents) are explicitly encoded in twips.
  - Bold, italic, underline, and non-ASCII Unicode characters survive intact.
  - Title page metadata is placed in an isolated front-matter section.
- **Documented Conversion Losses:**
  - *Pagination:* Google Docs uses its own browser layout engine and local font rasterization; exact 55-line pagination may drift by several lines compared to Kolbítar's authoritative Courier Prime 12pt layout engine. Always distribute `.pdf` when exact production page numbers are legally required.
  - *Dual Dialogue:* Google Docs does not support multi-column screenplay layouts within flowing paragraphs; dual dialogue speeches are serialized sequentially.
  - *Locked Production Pages:* Dynamic word processor flow cannot retain locked A/B production page divisions.
  - *Private Metadata:* Inactive alternative takes, private project notes, and anchored comment threads are excluded by default to protect writer privacy.
- **Reconciliation back to Kolbítar:** To merge feedback without losing structural integrity, import outside comments via `.cirth-review` packages or copy revised text into a dedicated comparison branch using `File > Branches…`.

### 2. Google Sheets (.xlsx / .csv) Tabular Workflow

Kolbítar strictly refuses to flatten dramatic screenplay prose into spreadsheet grids. Instead, tabular cloud workflows operate on script-derived production metadata:

- **Generating the Export:** Choose `File > Export… > Reports (StoryScry)…` or `Stripboard & schedule…` and select `.xlsx` or `.csv`.
- **Opening in Google Sheets:** Upload to Google Drive and open with Google Sheets.
- **Preserved Structure:**
  - Stable internal IDs (`sc_...`) are included in dedicated identifier columns to support deterministic reconciliation.
  - Explicit header row with typed columns: Scene Number, INT/EXT, Day/Night, Eighths Length, Estimated Duration (seconds), Speaking Characters, Tagged Cast, Props, and Wardrobe.
  - Formula safety: Cells starting with `=`, `+`, `-`, or `@` are sanitized with leading apostrophes to protect against spreadsheet formula injection attacks.
  - Stripboards retain scheduled shooting order, company moves, banners, and day-break totals.
- **Preserving Canonical Truth:** Modifying an exported spreadsheet never silently alters the canonical `.cirth` database. Spreadsheets remain read-only production derivatives.

## Supported interchange versus native fidelity

These features may not survive external conversion and must be assessed separately:
- Stable internal IDs and many-to-one scene/beat links.
- Board positions, mind-map edges, chronology metadata.
- Branches and inactive alternatives.
- Exact locked-page semantics and revision metadata.
- Comment threads/anchors/resolved status.
- Bible provenance, private notes, media attachments.
- Custom block types, immersive choices/conditions, comic panel structure.

An FDX export may carry some revision or numbering data if the adapter actually supports it. Never infer complete parity from a valid XML file. Maintain a tested element/attribute support matrix.

Prioritize native reopen and FDX import during the early interchange work. DOCX/RTF/TXT/HTML imports are separate parser features, not implied by the export list. Arbitrary PDF-to-editable reconstruction is out of the initial scope.

## Compatibility record

For each tested pair, record: application/version or Google web test date, OS, fixture hash/version, export settings, features preserved, known losses, reviewer, and evidence location.

Statuses: not implemented, implemented but unverified, verified within profile, partial with documented losses, unsupported.

Never label an export "100% compatible" without specifying exactly which profile and tests that statement refers to.

