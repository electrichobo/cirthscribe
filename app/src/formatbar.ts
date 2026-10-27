// The toolbar's format island: block type, bold, italic, underline. The
// buttons show the state at the caret (aria-pressed) and run the same
// commands as the keys and the Format menu. Pressing them never takes focus
// from the script, so the selection stays where it was.

import { toggleMark } from "prosemirror-commands";
import type { MarkType } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { KINDS, KIND_LABEL, schema, type Kind } from "./schema";
import { setKind } from "./keys";

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function createFormatBar(root: HTMLElement, getView: () => EditorView | undefined, isMac: boolean) {
  const mod = isMac ? "Cmd" : "Ctrl";
  const kind = document.createElement("select");
  kind.id = "block-kind";
  kind.setAttribute("aria-label", "Block type");
  kind.title = `Block type of the line with the caret (Tab, Shift+Tab, or ${mod}+1 to 9)`;
  for (const k of KINDS) kind.append(new Option(KIND_LABEL[k], k));
  kind.addEventListener("change", () => {
    const v = getView();
    if (!v) return;
    setKind(kind.value as Kind)(v.state, v.dispatch);
    v.focus();
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
      v.focus();
    });
    return { b, m };
  });
  root.append(kind, ...buttons.map((x) => x.b));

  /** Show the state at the caret; called after every editor transaction. */
  function update(state: EditorState) {
    const parent = state.selection.$from.parent;
    if (parent.type.name === "block" && kind.value !== parent.attrs.kind) kind.value = parent.attrs.kind;
    for (const { b, m } of buttons) {
      const on = String(markActive(state, m.type));
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
  }

  return { update };
}
