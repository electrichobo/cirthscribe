// Find and replace in the script.
//
// Matching is per block (blocks hold no line breaks), in UTF-16 offsets that
// map one-to-one onto ProseMirror positions inside the block. Options: match
// case; whole word (Unicode letters and digits are word characters, so
// "Zoë" and "café" work); limit to one block type (e.g. character cues only,
// to rename a character without touching action or dialogue).
//
// Replace all is one transaction: one undo restores every replacement, and
// it reaches the store as one batch like any other edit. Inline marks at a
// match are kept on its replacement.

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { Kind } from "./schema";

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  kind: Kind | "all";
}

export interface Match {
  from: number;
  to: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matcher(o: FindOptions): RegExp | null {
  if (!o.query) return null;
  let src = escapeRe(o.query);
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${o.matchCase ? "" : "i"}`);
}

/** Matches in one string (UTF-16 offsets). Exposed for tests. */
export function matchesIn(text: string, o: FindOptions): [number, number][] {
  const re = matcher(o);
  if (!re) return [];
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

export function findAll(doc: PMNode, o: FindOptions): Match[] {
  const re = matcher(o);
  if (!re) return [];
  const out: Match[] = [];
  doc.forEach((block, pos) => {
    if (o.kind !== "all" && block.attrs.kind !== o.kind) return;
    const text = block.textContent;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const from = pos + 1 + m.index!;
      out.push({ from, to: from + m[0].length });
    }
  });
  return out;
}

interface FindState {
  opts: FindOptions | null;
  matches: Match[];
  current: number; // index into matches, -1 = none
  decos: DecorationSet;
}

export const findKey = new PluginKey<FindState>("cirth-find");

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "find-hit current" : "find-hit" })),
  );
}

/** Index of the first match at or after `pos` (wrapping to 0). */
function nearest(matches: Match[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i === -1 ? 0 : i;
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ opts: null, matches: [], current: -1, decos: DecorationSet.empty }),
      apply(tr, prev, _old, state): FindState {
        const meta = tr.getMeta(findKey) as { opts?: FindOptions | null; current?: number } | undefined;
        const opts = meta && "opts" in meta ? meta.opts ?? null : prev.opts;
        if (!opts || !opts.query) return { opts, matches: [], current: -1, decos: DecorationSet.empty };
        if (!meta && !tr.docChanged) return prev;
        const matches = findAll(state.doc, opts);
        let current = meta?.current ?? prev.current;
        if (meta && "opts" in meta && meta.current === undefined) current = nearest(matches, state.selection.from);
        if (current >= matches.length) current = matches.length ? 0 : -1;
        if (!matches.length) current = -1;
        return { opts, matches, current, decos: decorate(state.doc, matches, current) };
      },
    },
    props: { decorations: (state) => findKey.getState(state)?.decos },
  });
}

export const findState = (state: EditorState) => findKey.getState(state)!;

/** Set or clear the query (highlights update; selection is not moved). */
export function setQuery(state: EditorState, opts: FindOptions | null): Transaction {
  return state.tr.setMeta(findKey, { opts }).setMeta("addToHistory", false);
}

/** Move to the next/previous match and select it. */
export function step(state: EditorState, dir: 1 | -1): Transaction | null {
  const fs = findState(state);
  if (!fs.matches.length) return null;
  const n = fs.matches.length;
  let i: number;
  if (fs.current < 0) i = dir > 0 ? nearest(fs.matches, state.selection.to) : n - 1;
  else {
    const cur = fs.matches[fs.current];
    // If the selection is not on the current match (user moved), start from the caret.
    const onCurrent = state.selection.from === cur.from && state.selection.to === cur.to;
    i = onCurrent ? (fs.current + dir + n) % n : dir > 0 ? nearest(fs.matches, state.selection.to) : (nearest(fs.matches, state.selection.from) - 1 + n) % n;
  }
  const m = fs.matches[i];
  return state.tr
    .setSelection(TextSelection.create(state.doc, m.from, m.to))
    .setMeta(findKey, { current: i })
    .setMeta("addToHistory", false)
    .scrollIntoView();
}

/** Replace the current match (if the selection is on it) and select the next. */
export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const fs = findState(state);
  if (fs.current < 0) return null;
  const m = fs.matches[fs.current];
  if (state.selection.from !== m.from || state.selection.to !== m.to) return null;
  const tr = state.tr;
  replaceRange(tr, m, replacement);
  const after = m.from + replacement.length;
  const next = findAll(tr.doc, fs.opts!);
  const i = nearest(next, after);
  if (i >= 0) tr.setSelection(TextSelection.create(tr.doc, next[i].from, next[i].to)).setMeta(findKey, { current: i });
  return tr.scrollIntoView();
}

/** Replace every match in one transaction (one undo). Returns the count. */
export function replaceAll(state: EditorState, replacement: string): { tr: Transaction; count: number } | null {
  const fs = findState(state);
  if (!fs.matches.length) return null;
  const tr = state.tr;
  // Back to front so earlier positions stay valid.
  for (let i = fs.matches.length - 1; i >= 0; i--) replaceRange(tr, fs.matches[i], replacement);
  return { tr: tr.setMeta(findKey, { current: -1 }), count: fs.matches.length };
}

/** Replace keeping the marks of the first matched character. */
function replaceRange(tr: Transaction, m: Match, replacement: string) {
  const marks = tr.doc.resolve(m.from + 1).marks();
  if (replacement) tr.replaceWith(m.from, m.to, tr.doc.type.schema.text(replacement, marks));
  else tr.delete(m.from, m.to);
}
