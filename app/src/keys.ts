// Contextual Tab / Shift+Tab / Enter. Behavior comes from a config object so
// cycles can be changed without code; tests exercise the defaults.
//
// Documented behavior (defaults):
// - Tab and Shift+Tab change the type of every block touched by the
//   selection, using `tab` / `shiftTab` (with optional overrides for empty
//   blocks). They never insert characters.
// - Enter at the end of a block creates a new block of type `enterNext[kind]`.
// - Enter on an empty block whose kind is in `enterOnEmpty` changes its type
//   instead of creating another empty block.
// - Enter in the middle of a block splits it; both halves keep the kind; the
//   first half keeps the block id.
// - Changing an empty block to parenthetical inserts "()" with the cursor inside.
// - Escape leaves the editor (moves focus to the navigator).
// - Ctrl+1..9 set a type directly (keyboard alternative to the cycle).

import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { KINDS, type Kind } from "./schema";

export interface KeyConfig {
  tab: Partial<Record<Kind, Kind>>;
  shiftTab: Partial<Record<Kind, Kind>>;
  tabEmpty: Partial<Record<Kind, Kind>>;
  shiftTabEmpty: Partial<Record<Kind, Kind>>;
  enterNext: Record<Kind, Kind>;
  enterOnEmpty: Partial<Record<Kind, Kind>>;
}

export const defaultKeyConfig: KeyConfig = {
  tab: { action: "character", character: "transition", transition: "heading", heading: "action", dialogue: "parenthetical", parenthetical: "dialogue", shot: "action", section: "action", lyric: "dialogue" },
  shiftTab: { action: "heading", heading: "transition", transition: "character", character: "action", parenthetical: "dialogue", dialogue: "character", shot: "heading", section: "heading", lyric: "dialogue" },
  tabEmpty: {},
  shiftTabEmpty: {},
  enterNext: { heading: "action", action: "action", character: "dialogue", parenthetical: "dialogue", dialogue: "character", transition: "heading", shot: "action", section: "heading", lyric: "lyric" },
  enterOnEmpty: { character: "action", dialogue: "action", parenthetical: "dialogue" },
};

let config: KeyConfig = defaultKeyConfig;
export const setKeyConfig = (c: KeyConfig) => (config = c);
export const getKeyConfig = () => config;

function blocksInSelection(state: EditorState): { pos: number; kind: Kind; empty: boolean }[] {
  const out: { pos: number; kind: Kind; empty: boolean }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === "block") {
      out.push({ pos, kind: n.attrs.kind, empty: n.content.size === 0 });
      return false;
    }
    return true;
  });
  return out;
}

export function setKind(kind: Kind): Command {
  return (state, dispatch) => {
    const targets = blocksInSelection(state);
    if (!targets.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const t of targets) {
        const node = tr.doc.nodeAt(t.pos)!;
        tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, kind });
      }
      if (targets.length === 1 && targets[0].empty && kind === "parenthetical") {
        tr.insertText("()", targets[0].pos + 1);
        tr.setSelection(TextSelection.create(tr.doc, targets[0].pos + 2));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function cycle(forward: boolean): Command {
  return (state, dispatch) => {
    const targets = blocksInSelection(state);
    if (!targets.length) return false;
    if (dispatch) {
      const tr = state.tr;
      let parenOpened: number | null = null;
      for (const t of targets) {
        const map = t.empty ? (forward ? config.tabEmpty : config.shiftTabEmpty) : {};
        const next = map[t.kind] ?? (forward ? config.tab : config.shiftTab)[t.kind];
        if (!next) continue;
        const node = tr.doc.nodeAt(t.pos)!;
        tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, kind: next });
        if (targets.length === 1 && t.empty && next === "parenthetical") parenOpened = t.pos;
      }
      if (parenOpened !== null) {
        tr.insertText("()", parenOpened + 1);
        tr.setSelection(TextSelection.create(tr.doc, parenOpened + 2));
      }
      dispatch(tr.scrollIntoView());
    }
    // Tab is always consumed inside the editor so focus never jumps unexpectedly.
    return true;
  };
}

const enter: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection;
  if ($from.parent.type.name !== "block") return false;
  const kind = $from.parent.attrs.kind as Kind;
  if (empty && $from.parent.content.size === 0 && config.enterOnEmpty[kind]) {
    return setKind(config.enterOnEmpty[kind]!)(state, dispatch);
  }
  if (!dispatch) return true;
  const tr = state.tr;
  if (!empty) tr.deleteSelection();
  const $pos = tr.doc.resolve(tr.mapping.map($to.pos));
  const atEnd = $pos.parentOffset === $pos.parent.content.size;
  const attrs = $pos.parent.attrs;
  if (atEnd) {
    const next = config.enterNext[kind] ?? "action";
    tr.split($pos.pos, 1, [{ type: state.schema.nodes.block, attrs: { kind: next, id: null, sceneId: null, dual: false, breakBefore: false } }]);
  } else {
    tr.split($pos.pos, 1, [{ type: state.schema.nodes.block, attrs: { ...attrs, id: null, sceneId: null, breakBefore: false } }]);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

export function screenplayKeymap(onEscape: () => void) {
  const bindings: Record<string, Command> = {
    Tab: cycle(true),
    "Shift-Tab": cycle(false),
    Enter: enter,
    Escape: () => {
      onEscape();
      return true;
    },
  };
  KINDS.forEach((k, i) => (bindings[`Mod-${i + 1}`] = setKind(k)));
  return keymap(bindings);
}
