# ADR 0005: Anchored records for breakdown tags (and future comments)

- **Status:** Accepted
- **Date:** 2026-10-28
- **Decision owner:** Project owner (M4 plan decision B)

## Context

Breakdown tags (M4 step 3) and margin comments (M5) attach metadata to a span of screenplay text inside a block (`[start, end)` within a block's text). Two representations were considered in `docs/M4_PLAN.md`:

1. Inline text marks on `Run` (like `Run::revision`).
2. Separate records keyed by their own stable ID, storing `(document_id, block_id, start, end, quote)` and mapped through script edits by the core.

The owner chose option 2 (Decision B) so that breakdown tags and M5 comments share one anchor model, screenplay text runs stay free of production-tag clutter, and a tag whose underlying text or block is deleted becomes an explicit **orphan** for the writer to review (reattach or delete) rather than vanishing with the text.

## Decision

1. **Separate persisted record.** Each breakdown tag is stored in `breakdown_tags` with:
   - `id`: stable `Id`
   - `document_id`: `Id` of the script document
   - `block_id`: `Id` of the block holding the span
   - `start`, `end`: 0-based character offsets in **Unicode scalar values** (`char` indices, `0 <= start < end <= block.text().chars().count()`) at the core boundary (`ARCHITECTURE.md` §5)
   - `quote`: the exact covered substring (`block.text().chars().skip(start).take(end - start).collect()`)
   - `category`: standard breakdown category (`cast`, `extras`, `props`, `costume`, `vehicles`, `sound`, `vfx_sfx`, `stunts`, `makeup`, `set_dressing`) or a writer-defined project category
   - `entity_id`: `Id` of the linked project bible entry (`bible_entities.id`), so aliases (`"the red ledger"`, `"the ledger"`) resolve to the same production element
   - `note`: optional short note
   - `orphaned`: boolean flag (`0` or `1`)

2. **UTF-16 conversion at the UI boundary.** ProseMirror and JavaScript strings index text by UTF-16 code units, whereas `cirth-core` indexes by Unicode scalar values (`char`). The TypeScript UI converts between UTF-16 code-unit offsets and `char` indices when creating tags from a selection or decorating tagged ranges in the editor, so astral-plane characters (such as emoji) never drift offsets.

3. **Authoritative anchor mapping in `Store::apply`.** Whenever a script edit `Batch` is applied to a document, `Store::apply` maps that document's tags inside the same SQLite transaction:
   - **Unchanged block:** if a block is untouched by the batch (including when scenes are reordered around it or omitted), its tags keep their `block_id`, `start`, `end`, and `quote`.
   - **Within-block edit (`Op::Update`):** compare the old block text `before` and new block text `after` by their common prefix (`pre` chars) and common suffix (`suf` chars, with `pre + suf <= min(before.len, after.len)`), where the edited old range is `[edit_start, edit_end) = [pre, before.len - suf)` and `delta = after.len as isize - before.len as isize`:
     - **Left-open / right-open affinity at boundaries:** an edit strictly after the tag (`edit_start >= end`, including pure insertion at `end`) leaves `[start, end)` unchanged; an edit strictly before the tag (`edit_end <= start`, including pure insertion at `start`) shifts both `start` and `end` by `delta`.
     - **Edit strictly inside the tag (`edit_start >= start && edit_end <= end` and `end_new > start`):** `start` stays, `end` adjusts by `delta`, and `quote` updates to the new covered text.
     - **Boundary-overlapping edit or deletion:** if the edit overlaps `[start, end)` or collapses it, search `after` for `quote` (preferring the match closest to the shifted `start`). If found, re-anchor `[start, end)` to that match; otherwise mark `orphaned = true` and preserve the last `block_id`, `start`, `end`, and `quote`.
   - **Block split (`Op::Update` + `Op::Put` in the same batch):** when an updated block loses a suffix (or prefix) that appears in a newly inserted block in the same batch and a tag's `quote` is no longer in the updated block, if `quote` appears in the new block, move the tag's `block_id` and `[start, end)` to the new block and keep `orphaned = false`.
   - **Block join (`Op::Update` + `Op::Delete` in the same batch):** when a block is deleted in the same batch that an updated block gains its text, tags on the deleted block whose `quote` appears in the updated block move to the updated block at the joined offset.
   - **Block deletion (`Op::Delete` without join):** tags on a deleted block are marked `orphaned = true` (never deleted).
   - **Orphan recovery on script undo:** if an orphaned tag's `block_id` is present in the document after a batch (for example after undoing a block or text deletion) and contains `quote`, the tag automatically re-anchors to `quote` and clears `orphaned = false`.

4. **Planning undo and suggestions.** Creating, editing, reattaching, or deleting a tag—and rejecting or un-rejecting a suggested tag—are `PlanningOp` commands with exact inverses on `PlanningHistory` (ADR 0003). Suggested tags scan script blocks for whole-word matches of bible entries' names and aliases in breakdown categories and are presented for the writer to accept or reject, never applied automatically.

## Consequences

- Tag anchors survive typing before/within/after a tag, splitting a paragraph with Enter, joining paragraphs with Backspace/Delete, moving scenes, and omitting/restoring scenes.
- Deleting tagged text or its block never loses the breakdown record; the writer sees the orphaned tag with its original quote and can reattach it to current selection or delete it with undo.
- M5 comments can reuse the exact same `(document_id, block_id, start, end, quote, orphaned)` anchor mapping functions.
