# M5 exit review

Date: 2026-10-29. Commit reviewed: `0fab4d9` (Build M5 Step 6: Portable review package (.cirth-review) import and export). Reviewer: coding agent, for the owner.

Gate sources: ROADMAP.md (M5 and its exit line), ACCEPTANCE.md section F (comments, alternatives, and history) and G5, docs/M5_PLAN.md.

**M5 closed for review, carrying into M6:** manual checks N37–N40, external spreadsheet and viewer manual checks (N32–N36), the Mac runs (N31, carried), and the items carried from M1–M4. Next: Milestone 6 (Additional formats and language tools).

Verdict before closing: **everything M5 promised is built and verified with automated suites (142 core unit/integration tests, 4 contract tests, 355 license notices, 75 e2e CDP tests, and 74 e2e WebDriver tests).**
- Automated: core tests, contract tests, and both end-to-end drivers on Windows.
- Carried forward: desktop manual checks N37–N40 logged in `docs/testing/MANUAL_CHECKS.md`, plus carried items from M1–M4.

## 1. ROADMAP M5 items

| Item | Built | Evidence | Open |
| - | - | - | - |
| Anchored local comment threads, inline/side-panel presentation, resolved/orphan behavior | Yes (step 1, ADR 0005) | Core `comments::tests`, migration `migrate_v12`, store integration, e2e "Comment threads and review (ADR 0005, F1, F2, F3)" | — |
| Non-destructive alternatives with one explicit active selection | Yes (step 2, schema v13) | Core `alternatives::tests`, migration `migrate_v13`, take switcher badge, e2e "Block alternatives and takes (ADR 0005, F4, E5)" | — |
| Named snapshots and checkpoints with safe restore | Yes (step 3, schema v14) | Core `snapshots::tests`, migration `migrate_v14`, store tests, e2e "Named snapshots and checkpoints (M5 step 3)" | — |
| Visual branch history and independent branch canon | Yes (step 4, schema v15) | Core `branches::tests`, migration `migrate_v15`, status bar branch pill, e2e "Visual branch history and independent branch canon (M5 step 4)" | — |
| Base/source/target 3-way conflict integration and locked-page baseline guard | Yes (step 5) | Core `merge::tests`, 3-column conflict dialog, baseline divergence guard, e2e "Base/source/target 3-way conflict integration (M5 step 5, F5, F6)" | — |
| Branch-aware bible facts, reports, page baselines, comments, and schedules | Yes (steps 4 & 5) | Independent branch canon isolation (Acceptance C5), branch-scoped store transactions, locked-page baseline divergence checks | — |
| Portable review package (`.cirth-review`) before online services | Yes (step 6) | Core `review::tests`, format `cirth-review-v1`, sanitization against traversal and formula injection, e2e Test 75 | — |

## 2. Acceptance F (comments, alternatives, and history) and G5

| # | Status | Evidence |
| - | - | - |
| F1 Add thread to selected text, insert before it, move scene, split block: anchor follows under documented rules | Pass | Core `comments::map_comments_through_batch`, ADR 0005 text anchor tracking; e2e Test 70 |
| F2 Delete referenced text: keep orphaned thread with original quote, replies, and reattach option | Pass | Core `CommentThread.orphaned` detection and restoration; e2e Test 70 orphan and reattach checks |
| F3 Toggle inline/side-panel views: same thread ID and replies appear without duplication | Pass | Unified `comments_state` Tauri command and ProseMirror decoration engine; e2e Test 70 |
| F4 Activate alternate dialogue: word counts, reports, bible occurrences, and export use chosen alternative; switching back restores original content | Pass | Core `block_alternatives` active take projection; dynamic word count update in status bar; StoryScry inactive alternative label; e2e Test 71 |
| F5 Fork two branches from one checkpoint and edit same speech differently: integration shows base and both edits; no automatic concatenation or lost version | Pass | Core `cirth_core::merge` 3-way comparison engine; UI `dialog#merge-dialog` 3-column side-by-side diff with explicit resolution buttons; e2e Test 74 |
| F6 Compare branches with different locked-page baselines: require explicit baseline decision before merging structural changes | Pass | Core `baseline_diverged` detection; modal warning banner requiring user baseline selection before apply; e2e Test 74 |
| F7 Native round-trip preserves history, alternatives, and comments; export never silently mutates source | Pass | Core store migrations v12–v15; snapshot and review export tests; e2e Test 75 disk inspections verifying zero machine paths or credentials |
| G5 Sanitization and validation defense: reject path traversal (`..`), script/HTML injection, and formula prefixes (`=`, `+`, `-`, `@`) | Pass | Core `review::sanitize_text` and `review::validate_no_traversal`; e2e Test 75 rejection of `../../traversal-attack` and formula escaping |

## 3. Exit line

- **"Conflicting changes never disappear silently."** Met: `cirth_core::merge` compares base ancestor, current branch, and incoming branch at granular block and scene levels. Conflicting speeches or scenes are presented side-by-side in a 3-column diff preview with user resolution choices ("Keep Current", "Take Incoming", "Custom Edit..."). No edits are concatenated or discarded automatically.
- **"Branches and alternatives survive native save/export/reopen without affecting unrelated work."** Met: alternative takes attach non-destructively to blocks, projecting only the active take to layout, word counts, and exports; inactive branches are stored as verified, compressed SQLite state snapshots in the native `.cirth` package, guaranteeing strict canon isolation (Acceptance C5).

## 4. Found and fixed while building M5

- **In-memory ProseMirror synchronisation on branch/snapshot switch:** When switching branches or restoring snapshots, syncing the active DOM editor and background syncer directly via `applyOpened` prevents stale debounced autosaves from overwriting the switched branch state.
- **Locked-page baseline divergence protection:** Detected when source and target branches diverge in their production locked-page baselines (e.g. revisions introducing A/B pages), requiring an explicit baseline choice before merging structural changes (Acceptance F6).
- **Take 0 baseline initialization on review package import:** When importing an external alternative take onto a block that had no prior alternatives, the author's current text is automatically established as Take 0 (`Take 1 (Original)`, `is_active: true`), ensuring the author's draft remains undisturbed and active.
- **Security defense against formula injection and path traversal:** Sanitized review bundle metadata and text fields against spreadsheet formula injection triggers (`=`, `+`, `-`, `@`) and rejected parent directory traversal sequences (`..`) to secure offline exchange.

## 5. Open items

1. **Manual checks N37–N40:** desktop verification of comments, alternate takes, branches, and review packages.
2. **Carried forward from M1–M4:** external spreadsheet and PDF viewer manual checks (N32–N36), Mac run (N31), non-Latin PDF glyphs, reference machine latency budgets, external screenplay interchange checks.

## 6. Decisions for the owner

- **A. Closing M5:** Close Milestone 5 as complete, carrying manual checks N37–N40 into the manual checklist backlog.
- **B. Moving to M6:** Proceed to Milestone 6 (Additional formats and language tools: TV and UK profiles, stage plays, comics/graphic novels, interactive branching stories, offline grammar checking).
