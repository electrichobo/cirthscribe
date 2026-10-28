// The toolbar's format island: element (the block type), bold, italic, underline, text
// colour and highlight. The controls show the state at the caret and run the
// same commands as the keys and the Format menu. Pressing the buttons never
// takes focus from the script, so the selection stays where it was. Colour
// and highlight are on-screen markup only (never printed or exported).

import { toggleMark } from "prosemirror-commands";
import type { MarkType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { HIGHLIGHTS, KINDS, KIND_LABEL, TEXT_COLORS, schema, type Kind } from "./schema";
import { setKind } from "./keys";
import { iconSelect } from "./icons";
import { usedPointer } from "./a11y";

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** Set (or with null, remove) a valued mark on the selection, or for the
 *  next typed text when nothing is selected. One undo step. */
export function setMarkValue(type: MarkType, value: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection;
    const tr = state.tr;
    if (empty) {
      const rest = (state.storedMarks ?? $from.marks()).filter((m) => m.type !== type);
      tr.setStoredMarks(value ? [...rest, type.create({ value })] : rest);
    } else {
      tr.removeMark(from, to, type);
      if (value) tr.addMark(from, to, type.create({ value }));
    }
    dispatch?.(tr);
    return true;
  };
}

/** The value of a valued mark at the caret, or at the start of the selection. */
function markValue(state: EditorState, type: MarkType): string {
  const { empty, $from } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : (state.doc.nodeAt($from.pos)?.marks ?? $from.marks());
  return type.isInSet(marks)?.attrs.value ?? "";
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function createFormatBar(root: HTMLElement, getView: () => EditorView | undefined, isMac: boolean) {
  const mod = isMac ? "Cmd" : "Ctrl";
  const kind = document.createElement("select");
  kind.id = "block-kind";
  kind.setAttribute("aria-label", "Element");
  kind.title = `Element of the line with the caret (Tab, Shift+Tab, or ${mod}+1 to 9)`;
  for (const k of KINDS) kind.append(new Option(KIND_LABEL[k], k));
  kind.addEventListener("change", () => {
    const v = getView();
    if (!v) return;
    setKind(kind.value as Kind)(v.state, v.dispatch);
    if (usedPointer()) v.focus();
  });

  const marks: { id: string; label: string; key: string; type: MarkType; face: string }[] = [
    { id: "fmt-bold", label: "Bold", key: "B", type: schema.marks.strong, face: "b" },
    { id: "fmt-italic", label: "Italic", key: "I", type: schema.marks.em, face: "i" },
    { id: "fmt-underline", label: "Underline", key: "U", type: schema.marks.underline, face: "u" },
  ];
  const buttons = marks.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = m.id;
    b.className = `fmt fmt-${m.face}`;
    b.textContent = m.key;
    b.setAttribute("aria-label", m.label);
    b.setAttribute("aria-pressed", "false");
    b.title = `${m.label} (${mod}+${m.key})`;
    // Keep the editor's selection: no focus change on press.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const v = getView();
      if (!v) return;
      toggleMark(m.type)(v.state, v.dispatch);
      if (usedPointer()) v.focus();
    });
    return { b, m };
  });
  const valued = (id: string, label: string, type: MarkType, values: readonly string[]) => {
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = `fmt-${type.name}`;
    sel.setAttribute("aria-label", `${label} (on screen only, never printed)`);
    sel.title = `${label}: your own markup, shown on screen only. It is never printed or exported.`;
    sel.append(new Option("None", ""));
    for (const v of values) sel.append(new Option(cap(v), v));
    sel.addEventListener("change", () => apply(type, sel.value || null));
    return sel;
  };
  const color = valued("fmt-color", "Text colour", schema.marks.color, TEXT_COLORS);
  const highlight = valued("fmt-highlight", "Highlight", schema.marks.highlight, HIGHLIGHTS);
  const colorWrap = iconSelect("colour", color);
  const highlightWrap = iconSelect("highlight", highlight);
  root.append(kind, ...buttons.map((x) => x.b), colorWrap, highlightWrap);

  function apply(type: MarkType, value: string | null) {
    const v = getView();
    if (!v) return;
    setMarkValue(type, value)(v.state, v.dispatch);
    if (usedPointer()) v.focus();
  }

  /** Show the state at the caret; called after every editor transaction. */
  function update(state: EditorState) {
    const parent = state.selection.$from.parent;
    if (parent.type.name === "block" && kind.value !== parent.attrs.kind) kind.value = parent.attrs.kind;
    for (const { b, m } of buttons) {
      const on = String(markActive(state, m.type));
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    color.value = markValue(state, schema.marks.color);
    highlight.value = markValue(state, schema.marks.highlight);
    colorWrap.dataset.value = color.value;
    highlightWrap.dataset.value = highlight.value;
  }

  return { update, apply };
}
