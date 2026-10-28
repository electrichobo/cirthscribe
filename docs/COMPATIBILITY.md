# Compatibility matrix

M2 step 9. Every claim here comes from an actual test, with its date. Rules and statuses come from INTEROPERABILITY.md ("Compatibility record"). An export is never "compatible" in general, only within the profile and tests named here.

## How to test

1. Make the test pack: `cargo run -p cirth-core --bin cirth-cli -- compat-pack`. It writes every sample in every format to `out/compat-pack-v1/` with a `MANIFEST.md` of sizes and hashes. The same commit always makes the same files, so a result names its exact file.
2. Open a file in the external app. Check what the matching manual check lists:
   - PDF: N25;
   - Fountain: N22;
   - FDX: N23;
   - DOCX, RTF, HTML: N28.
3. Add a row to the results log:
   - date, format, app and version, OS;
   - pack version, commit and file hash;
   - what was kept and what was lost;
   - reviewer, and where the evidence is (screenshot, note).
4. Update the format's status.

## Status by format

Statuses: not implemented · implemented, unverified · verified within profile · partial with documented losses · unsupported.

| Format | Status | Profile / scope | Basis |
| - | - | - | - |
| .cirth (native) | Verified within profile | Kolbítar reopening its own projects, upgrades from schemas v1–v4 | Automated store, migration and crash tests on Windows, macOS and Linux CI |
| .pdf | Implemented, unverified | US Letter and A4, Courier Prime 12 pt | No external viewer or industry comparison recorded yet (N25) |
| .txt | Implemented, unverified | Fixed-pitch page text | No external check recorded |
| .fountain | Implemented, unverified externally | Fountain syntax (fountain.io), within the limits the export report lists | Kolbítar's own round trip: automated, see log. No other app recorded (N22) |
| .fdx | Implemented, unverified externally | Elements listed in the export report | Kolbítar's own round trip: automated, see log. Final Draft not yet tried (N23) |
| .docx | Implemented, unverified | Word and Google Docs profile | Well-formedness and content checked by automated tests only (N28) |
| .rtf | Implemented, unverified | Word, LibreOffice, TextEdit | Automated tests only (N28) |
| .html | Implemented; one informal check | Any current browser, screen and print | Owner's visual check, see log. Print view and per-browser checks pending (N28) |
| .xlsx / .csv | Not implemented | Reports and stripboards (later milestones) | — |

## Results log

| Date | Format | App and version | OS | Pack / file | Kept | Lost or different | Reviewer | Evidence |
| - | - | - | - | - | - | - | - | - |
| 2026-10-27 | HTML | Browser (name and version not recorded) | Not recorded | Step 8 export (commit ce5c517), file not recorded | Looked right and matched the script; "not being critical" | None noted | Owner | Owner's message in the development session |
| 2026-10-27 | Fountain, FDX | Kolbítar itself (export, then import) | Windows 11 | Pack v1: page-boundaries, unicode-marks, long-120 | Every block's kind and text, in order | Only what the export reports name | Automated test | `compat::tests::the_pack_is_complete_and_repeatable` |

Kolbítar reading its own files proves the adapters agree with each other, not that other apps read them. External rows are still needed for every format.
