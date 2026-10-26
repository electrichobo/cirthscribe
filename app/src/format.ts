// Dual dialogue and forced page breaks.
//
// Dual dialogue: the `dual` flag on a character cue makes that speech the
// right-hand column of a pair with the speech just before it, the rule the
// Rust layout engine uses (cirth_core::layout::group). Toggle with
// Ctrl/Cmd+D or Edit > Dual Dialogue, with the caret in the second cue. It is
// refused, with a message, where the layout could not pair it: no speech
// right before, or that speech is already the right side of a pair.
// In the editor the pair is shown side by side: the left speech's blocks
// float left, the right speech's blocks sit beside them at the layout's
// column positions, and the next block clears both.
//
// Forced page break: `breakBefore` on any block starts a new page there.
// Toggle with Ctrl/Cmd+Enter or Edit > Page Break Before.
//
// Both are ordinary transactions: one undo each.

import { Plugin, PluginKey, type Command, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

const SPEECH = new Set(["character", "parenthetical", "dialogue", "lyric"]);

interface Speech {
  start: number; // index of the cue (or first speech block)
  end: number; // index after the last block
  dualRight: boolean;
}

/** Speeches by block index, grouped like the layout engine groups them. */
function speeches(doc: PMNode): { nodes: PMNode[]; list: Speech[] } {
  const nodes: PMNode[] = [];
  doc.forEach((n) => nodes.push(n));
  const list: Speech[] = [];
  let i = 0;
  while (i < nodes.length) {
    if (!SPEECH.has(nodes[i].attrs.kind)) {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < nodes.length && SPEECH.has(nodes[i].attrs.kind) && nodes[i].attrs.kind !== "character") i++;
    const cue = nodes[start];
    const prev = list.at(-1);
    // Right side only if it follows a plain speech directly (as in layout).
    const dualRight = cue.attrs.kind === "character" && !!cue.attrs.dual && !!prev && prev.end === start && !prev.dualRight && nodes[prev.start].attrs.kind === "character";
    list.push({ start, end: i, dualRight });
  }
  return { nodes, list };
}

/** Can the speech whose cue is at block index `cue` be the right side of a pair? */
function pairable(doc: PMNode, cue: number): string | null {
  const { nodes, list } = speeches(doc);
  if (nodes[cue]?.attrs.kind !== "character") return "Put the cursor in a character cue (the second speaker of the pair).";
  const k = list.findIndex((s) => s.start === cue);
  const prev = k > 0 ? list[k - 1] : null;
  if (!prev || prev.end !== cue || nodes[prev.start].attrs.kind !== "character") return "Dual dialogue pairs this speech with the speech just before it, and there is none.";
  if (prev.dualRight) return "The speech before this one is already the right side of a pair.";
  return null;
}

function blockIndexAt(state: EditorState): number {
  return state.selection.$from.index(0);
}

export function toggleDual(notify: (msg: string) => void): Command {
  return (state, dispatch) => {
    const idx = blockIndexAt(state);
    const node = state.doc.child(idx);
    if (!node.attrs.dual) {
      const why = pairable(state.doc, idx);
      if (why) {
        notify(why);
        return true; // handled: nothing to do
      }
    }
    if (dispatch) {
      let pos = 0;
      for (let i = 0; i < idx; i++) pos += state.doc.child(i).nodeSize;
      dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, dual: !node.attrs.dual }));
    }
    return true;
  };
}

export const togglePageBreak: Command = (state, dispatch) => {
  const idx = blockIndexAt(state);
  const node = state.doc.child(idx);
  if (dispatch) {
    let pos = 0;
    for (let i = 0; i < idx; i++) pos += state.doc.child(i).nodeSize;
    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, breakBefore: !node.attrs.breakBefore }));
  }
  return true;
};

export const dualKey = new PluginKey<DecorationSet>("cirth-dual");

function decorate(doc: PMNode): DecorationSet {
  const { nodes, list } = speeches(doc);
  const pos: number[] = [];
  let p = 0;
  for (const n of nodes) {
    pos.push(p);
    p += n.nodeSize;
  }
  const decos: Decoration[] = [];
  const mark = (i: number, cls: string) => decos.push(Decoration.node(pos[i], pos[i] + nodes[i].nodeSize, { class: cls }));
  list.forEach((s, k) => {
    if (!s.dualRight) return;
    const left = list[k - 1];
    for (let i = left.start; i < left.end; i++) mark(i, "dual-left");
    for (let i = s.start; i < s.end; i++) mark(i, "dual-right");
    if (s.end < nodes.length) mark(s.end, "dual-after");
  });
  return DecorationSet.create(doc, decos);
}

export function dualPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: dualKey,
    state: {
      init: (_c, state) => decorate(state.doc),
      apply: (tr, set, _o, state) => (tr.docChanged ? decorate(state.doc) : set),
    },
    props: { decorations: (state) => dualKey.getState(state) },
  });
}
