# M3 exit review

Date: 2026-10-28. Commit reviewed: 4334037 (all nine steps and the workspace steps W1–W5). Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M3 and its exit line), ACCEPTANCE.md sections B and C, docs/M3_PLAN.md.

**M3 closed by the owner on 2026-10-28 (decision A, option 1), as M1 and M2 were,** carrying into M4: the Mac run of M3 (N31), manual checks N29 and N30, the known limits in docs/m3/EXIT_REVIEW.md section 1, B6 (with M4's reports) and C5 (with M5's branches), and everything carried from M2 and M1. Decision B: straight on to M4.

Verdict before closing: **everything M3 promised is built and tested, with two acceptance items outside M3's reach and a few open checks.**
- Automated: core tests and both end-to-end drivers on Windows; CI green on Windows, macOS and Linux for every M3 push (Linux runs the whole end-to-end suite, so every new M3 test also passes on WebKitGTK).
- Not done: B6 belongs to the reports of M4 (the parts that exist are covered); C5 needs M5's branches.
- Not checked by hand: the new dialogs on a Mac (no M3 run there yet), the pop-out windows and menus by hand on each OS (N29, N30, N31), and the items carried from M2.

## 1. ROADMAP M3 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Nested episodes and mixed document containers with a shared bible | Yes (step 2; bible step 7) | Core series test (folders, episodes, per-document script, cards and numbers, moves, cycle refused, renames, kept through save); e2e "Episodes and series" | Only screenplay documents exist ("mixed" kinds come with M6). Deleting an episode or folder is not built (needs a safe, undoable design) |
| Tabbed navigator, outline editor and overview, notes and bookmarks | Yes (steps 3, 4, 6, 9; notes W2) | e2e "Navigator tabs", "Outline tab", "Overview map", "Notes panel", bookmarks in "Evidence board (C4)" | Notes are a panel and board cards, not a navigator tab |
| Corkboard and mind map as an evidence board with strings, images and video links | Yes (step 9) | Core v9-upgrade test (pictures packaged once with no path, SVG and file links refused, strings, delete and undo); e2e "Evidence board (C4)" | Pictures a card no longer uses stay in the project file until a later clean-up |
| Beat and pacing board with writer-chosen acts | Yes (step 5) | e2e "Beat and pacing board"; core positions | Moving a whole act does not reorder the script; unlinked beats have no pacing mark |
| Permission-controlled bi-directional scene ordering | Yes (step 1, ADR 0003; outline step 4; timeline step 8) | e2e "Planning undo (ADR 0003)", "Outline tab", "Timeline (B5)"; core planning test | — |
| Independent chronological story timeline | Yes (step 8) | Core timeline tests and v8 upgrade; e2e "Timeline (B5)" | Times are free text (no calendar arithmetic); story order applies to the open script only |
| Character, location and world profiles and aliases | Yes (step 7) | Core bible tests; e2e "Bible" | A season or episode scope is stored but does not yet filter anything |
| Non-AI bible extraction and refresh with provenance and review | Yes (step 7) | Core: candidates only from cues and headings, with evidence; e2e "Bible" | World entries have no occurrences; props come with M4's tags |

Also built before step 1, from the owner's notes on the build (W1–W5): reorganised menus, the notes panel, pop-out panel windows (ADR 0004), themes, rebindable shortcuts. Each has its own e2e test.

## 2. Acceptance B (linked structure) and C (bible and media)

| # | Status | Evidence |
| - | - | - |
| B1 Card shows no copy of script text; authored text unchanged | Pass | e2e "Navigator, board and editor show one scene" (since M1) |
| B2 Planning-only move leaves script order; "Planning only" visible | Pass | e2e "Navigator, board…", "Planning undo (ADR 0003)" |
| B3 Permitted move changes order once; one undo; ids stable | Pass | e2e "Planning undo" (from the board), "Outline tab" (from the outline), "Timeline (B5)" (story order, one transaction) |
| B4 Two beats on one scene: moving one never clones or moves it | Pass | e2e "Planning undo (ADR 0003)" |
| B5 A flashback event moved in story order; script order unchanged | Pass | Core timeline tests; e2e "Timeline (B5)" |
| B6 A report computed while a scene changes is tied to its version or recomputed | Partly; reports are M4 | Page markers carry their layout's version and show as stale until a newer one arrives (M1). The navigator's page, length and pacing figures are recomputed after every pagination but not marked stale in between |
| C1 Candidates link to evidence; an all-caps sound effect is not a character | Pass | Core bible unit test (action text never a candidate); e2e "Bible" |
| C2 Rename with aliases keeps authored fields; unrelated words unchanged | Pass | Core two-episode bible test; e2e "Bible" (only cues change; other text identical). A rename reloads the open script, so its own undo history restarts; renaming back reverses it |
| C3 Only occurrence removed: flagged unreferenced, profile kept | Pass | Core two-episode bible test; e2e "Bible" (an unmentioned entry is marked) |
| C4 Offline reopen with video URLs: no network; packaged images available | Pass | Core: the picture's bytes inside the project file, available after reopening; e2e: links shown as text, nothing embedded or fetched; the in-app offline test (A1, M1) covers opening without network |
| C5 Branch fork keeps the other branch's canon | Not in M3 | Branches are M5 |

## 3. Exit line

- **"Cards, navigator, script, chronology and bible stay consistent after edits and undo."** Met for what each view changes: planning edits go through one versioned, undoable command stream (ADR 0003), script-changing moves are single script transactions, and every view reads the same data (one outline tree for outline and board; cards that point at scenes, entries and events hold no copies). Tested in the e2e tests named above and in the core planning, outline, bible and timeline tests.
- **"No duplicated scene prose or accidental reorder."** Met: no planning view stores script text; the script moves only through the board or outline with the permission on, or the timeline's previewed story order. Tests check block ids unchanged and no clones (B3, B4) and the script untouched by planning, bible, timeline and board actions.

## 4. Found and fixed while building M3

- Settings and planning edits did not count as unsaved work, so a crash lost them (step W2, step 1); now recovered like script edits.
- Undo arriving before a card's change was stored, and quick repeated outline moves collapsing into one (race conditions caught by the e2e runs).
- Window creation in a synchronous command deadlocked on Windows (W3).
- Layout problems seen only on screenshots: the navigator's filter and tabs, the overview's total, the evidence board's edit panel and spacing.

## 5. Open items

1. **Mac:** no hands-on run of M3 yet (new dialogs, pop-out windows, themes, shortcuts). macOS CI builds and runs the core tests; its end-to-end run is manual. New manual check N31.
2. **Manual checks** N29 (menus, window commands, real imports), N30 (pop-out windows), N31 (M3 on macOS).
3. **Known limits** (section 1 "Open" column).
4. **Carried from M2 and M1:** external app tests (Word, Google Docs, LibreOffice, Final Draft, Fountain apps, Pages, browser print), the Mac recheck of compat pack v2, manual checks N20–N28, Linux desktop latency, reference machines, defect 3, Windows e2e on the hosted runner, non-Latin PDF glyphs.

## 6. Decisions for the owner

- **A. Closing M3.**
  - (1) Close it now, as M1 and M2 were closed, carrying the Mac run (N31), N29 and N30 and the limits above into M4.
  - (2) Keep it open until the Mac run (N31) is done on GROGU or another Mac.
- **B. Before M4:** anything from the open items you want built first (for example deleting episodes, or using the bible's season scope), or go straight to M4 (production analysis and stripboard).
