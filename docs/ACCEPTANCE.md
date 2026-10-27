# Acceptance scenarios

These are proposed scenarios to implement and test. They have not been run. Use original synthetic fixtures and small manually checked expectations. Avoid tests that merely repeat implementation logic.

## A. Writing and persistence

1. With networking disabled, create a project, type a screenplay, save, reopen, and export the currently supported formats. No sign-in or AI prompt blocks the flow.
2. Tab changes a block's type using the configured cycle without adding alignment spaces. Shift+Tab and Enter follow documented behavior. Undo restores the prior text and type in one logical step.
3. Select across blocks, paste formatted/plain text, split/join blocks, type accented text and emoji, and compose using an IME. No characters disappear, duplicate, or corrupt.
4. Type in Free Writing without an open project. Restart and recover it. Attaching a copy to a project preserves the original unless an explicit move was chosen.
5. Simulate a process crash after acknowledged autosave. Recover the latest durable state. Label the tested autosave/recovery window; do not claim unacknowledged keystrokes were saved.
6. Interrupt package saving and attempt a second writer. A valid previous checkpoint remains available; a second writer cannot overwrite unnoticed.
7. Open an older native schema and a deliberately newer schema. Migrate the old version with backup; reject/open read-only safely for unsupported future data.
8. Per-block word counts use documented treatment of apostrophes, hyphens, punctuation, emoji, and empty blocks. Summed scoped counts match the report.

## B. Linked structure

1. Link beat B to scene S. Edit S's dialogue. B's card shows no copy of the script text; its authored logline and summary remain unchanged. (Changed 2026-10-26 by owner decision: cards show logline and summary, not a live excerpt.)
2. With structural permission off, drag B to another board column. S does not move in script order. "Planning only" remains visible.
3. With permission on, move S through its linked card/navigator. Scene order changes exactly once across all linked views. One undo restores it. Block/scene IDs remain stable.
4. Link two beats to S. Moving one beat cannot clone or unexpectedly relocate S; explicit scene-order commands identify their target.
5. Move a flashback event in chronological order. Reading/script order stays unchanged.
6. Change a scene while a report is calculating. The result is tied to its original version or recomputed; it is not presented as current silently.

## C. Bible and media

1. Extract character cues and scene locations. Each candidate links to evidence; an uppercase sound effect in action is not automatically accepted as a character.
2. Rename a character using an approved alias map. Existing authored biography and manual fields survive refresh. Unrelated identical words do not change silently.
3. Omit/delete the only occurrence of a character. Flag the entity as unreferenced; do not delete its profile.
4. Reopen a project containing video URLs while offline. The app opens without network attempts. Local images remain available when packaged.
5. Fork a branch and change a world fact. The other branch's accepted canon is unchanged and derived views identify their continuity/scope.

## D. Pagination and production revisions

1. Render a known script with fixed profile/fonts. Check page count, block boundaries, continuation markers, title page, dual dialogue, and selectable PDF text.
2. Zoom and resize the editor. The authoritative page map is unchanged.
3. Lock a production baseline. Add text in the middle of a locked page. The inserted content uses the defined suffix-page policy; later baseline pages keep their labels.
4. Delete most of a locked page. Preserve page-label continuity under the documented policy, without accidentally renumbering all later pages.
5. Omit a numbered scene. Retain its scene identity/number, restore it, and confirm comments and tags still link correctly.
6. Revise a dialogue passage, switch revision sets, export changed pages, and verify dates/colors/marks and selected-page coverage.
7. Use identical fixture/fonts/layout engine on all three OSes. Compare authoritative line/page boundaries. Record actual differences and block a fidelity claim if they remain.
8. Upgrade the layout engine or lose a required font. Existing production baselines must not silently reflow.
9. Cover long headings, dialogue crossing multiple pages, parentheticals near a page end, explicit breaks, non-Latin text, and invalid profile settings.

## E. Reports and stripboards

1. Request only a prop report for episode 2. No other report is required; rows link to the correct source scenes and honor scope.
2. Tag one prop twice in a scene. Distinguish occurrence count from distinct scene count.
3. Generate strips from three scenes, reorder them for scheduling, then reorder the screenplay. Scheduled order stays independent while source fields refresh.
4. Omit a scene already scheduled. Its strip is flagged according to the selected policy, not silently erased with manual notes.
5. Counts exclude inactive alternatives by default. Explicitly including them displays an unambiguous label.
6. Use a fixture with offscreen speech, voiceover, nonspeaking presence, aliases, and dual dialogue. Speaking, presence, and timing metrics remain distinct.
7. With no measured durations, no chart labels an estimate "actual screen time." Overlapping character durations are not forced to total 100% of runtime.
8. Filter a report and a chart to the same project branch/episodes. Their underlying row data agrees.
9. Export long strip descriptions to PDF/HTML. No text clips; color legends and page headers are readable.

## F. Comments, alternatives, and history

1. Add a thread to selected text, insert before it, move its scene, and split its block. The anchor follows under the documented rules.
2. Delete the referenced text. Keep an orphaned thread with original quote, replies, and reattach option.
3. Toggle inline/side-panel views. The same thread ID/replies appear; no duplicate comment is created.
4. Activate alternate dialogue. Word counts, reports, current bible occurrences, and export use the chosen alternative. Switching back restores original content.
5. Fork two branches from one checkpoint and edit the same speech differently. Integration shows the base and both edits; no automatic concatenation or lost version.
6. Compare branches with different locked-page baselines. Require an explicit baseline decision before merging structural changes.
7. Native round-trip preserves history/alternatives/comments according to the declared native schema. Exporting PDF never silently mutates the source.

## G. Interoperability and trust

1. Export every supported format through its real serializer; parse/reopen the result with an independent reader where practical.
2. Import an FDX fixture containing unsupported/custom elements. Preserve known content and report limitations; do not lose unknown text silently.
3. Import DOCX into Google Docs and XLSX/CSV into Sheets manually or through an explicitly authorized integration. Record the test date and exact observed results.
4. Compare critical text, paragraph roles, indents, Unicode, tables, and row totals after conversion. Record pagination/comments/branch limitations separately.
5. Open a project containing traversal archive paths, oversized media, external XML entities, script-bearing HTML, and spreadsheet formulas in text fields. Reject/sanitize without executing content or escaping the chosen destination.
6. Launch with optional services disabled. No remote thumbnail, grammar, AI, or telemetry requests occur.

## H. Optional AI and platform claims

1. With AI disabled, all core workflows remain usable. Removing credentials does not prevent opening a project.
2. Before a request, show provider, task, and scope. Send only the authorized data. Logs and exported projects contain no keys.
3. Cancel or time out a request while editing. Manuscript remains intact. A late/stale result is identified and cannot overwrite newer text.
4. Accept one suggested change and reject another. Only the accepted change enters the normal undo/history.
5. Test keyboard-only use, screen-reader labels, focus order, high DPI, and color-independent revision status on claimed platforms.
6. Record long-document latency and save/open/export measurements against M0's reference fixture. No claimed threshold is marked passed without a measurement.

## Fixture suite to create during implementation

- Minimal feature screenplay and long 120-page synthetic screenplay.
- Unicode/IME, dual dialogue, long dialogue and pagination edge cases.
- Nested multi-episode project with aliases, shared facts, and independent chronology.
- Locked-page revision/omitted-scene fixture.
- Branch/alternative conflict fixture with anchored comments.
- Tagged scene/report/stripboard fixture with known expected counts.
- TV/UK/stage/comic/immersive fixtures as those formats are implemented.
- Malformed imports/packages and Google exchange samples.

All fixture content must be original, public-domain, or permissibly licensed. Keep manual expected outputs small enough to review.

