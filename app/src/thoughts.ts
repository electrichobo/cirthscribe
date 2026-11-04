// The Thoughts editor (Tools > Thoughts): a small rich-text box with bullet
// points (not numbered) and bold, italic and underline, nothing else
// (owner, 2026-11-03). It is used by the Thoughts panel and by its pop-out
// window.
//
// Thoughts stay a plain string in the project (`project_notes`), written in a
// light markup so older plain-text thoughts open unchanged:
//   - a line starting "- " is a bullet point;
//   - **bold**, *italic* and __underline__ (a backslash keeps a literal *, _ or \).
// Bullets are a paragraph style rather than nested lists: Enter on a bullet
// starts the next bullet, Enter on an empty bullet ends the list, and "- " at
// the start of a line makes it a bullet.

import { Schema, type MarkType, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

export const thoughtsSchema = new Schema({
  nodes: {
    doc: { content: "para+" },
    para: {
      content: "text*",
      attrs: { bullet: { default: false } },
      parseDOM: [{ tag: "li", attrs: { bullet: true } }, { tag: "p", getAttrs: (d) => ({ bullet: (d as HTMLElement).classList.contains("bullet") }) }],
      toDOM: (n) => ["p", n.attrs.bullet ? { class: "bullet" } : {}, 0],
    },
    text: {},
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
  },
});
const { strong, em, underline } = thoughtsSchema.marks;
// Longest delimiter first, so "**" is not read as two "*".
const DELIMS: [string, MarkType][] = [
  ["**", strong],
  ["__", underline],
  ["*", em],
];

/** Markup to a document. */
export function parseThoughts(text: string): PMNode {
  const paras = text.split("\n").map((line) => {
    const bullet = line.startsWith("- ");
    const body = bullet ? line.slice(2) : line;
    const open = new Set<MarkType>();
    const nodes: PMNode[] = [];
    let buf = "";
    const emit = () => {
      if (buf) nodes.push(thoughtsSchema.text(buf, [...open].map((m) => m.create())));
      buf = "";
    };
    for (let i = 0; i < body.length; ) {
      if (body[i] === "\\" && i + 1 < body.length) {
        buf += body[i + 1];
        i += 2;
        continue;
      }
      const d = DELIMS.find(([s]) => body.startsWith(s, i));
      if (d) {
        emit();
        if (open.has(d[1])) open.delete(d[1]);
        else open.add(d[1]);
        i += d[0].length;
        continue;
      }
      buf += body[i++];
    }
    emit();
    return thoughtsSchema.nodes.para.create({ bullet }, nodes);
  });
  return thoughtsSchema.nodes.doc.create(null, paras);
}

/** A document to markup (the inverse of `parseThoughts`). */
export function serializeThoughts(doc: PMNode): string {
  const lines: string[] = [];
  doc.forEach((p) => {
    let line = p.attrs.bullet ? "- " : "";
    let open: MarkType[] = [];
    p.forEach((t) => {
      const want = DELIMS.map(([, m]) => m).filter((m) => m.isInSet(t.marks));
      // Close what ends here (innermost first), then open what starts.
      for (const m of [...open].reverse()) if (!want.includes(m)) line += DELIMS.find(([, x]) => x === m)![0];
      open = open.filter((m) => want.includes(m));
      for (const m of want) {
        if (!open.includes(m)) {
          line += DELIMS.find(([, x]) => x === m)![0];
          open.push(m);
        }
      }
      line += (t.text ?? "").replace(/[\\*_]/g, (c) => `\\${c}`);
    });
    for (const m of [...open].reverse()) line += DELIMS.find(([, x]) => x === m)![0];
    lines.push(line);
  });
  return lines.join("\n");
}

const setBullet = (on: boolean): Command => (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (dispatch) {
    const tr = state.tr;
    state.doc.nodesBetween($from.before(1), $to.after(1), (n, pos) => {
      if (n.type.name === "para") tr.setNodeMarkup(pos, undefined, { bullet: on });
      return false;
    });
    dispatch(tr);
  }
  return true;
};

/** Bullets on or off for the selected lines. */
export const toggleBullet: Command = (state, dispatch) => setBullet(!state.selection.$from.parent.attrs.bullet)(state, dispatch);

/** Enter on an empty bullet ends the list; on a bullet with text, the next line is a bullet too. */
const enter: Command = (state, dispatch) => {
  const p = state.selection.$from.parent;
  if (!p.attrs.bullet || !state.selection.empty) return false;
  if (!p.content.size) return setBullet(false)(state, dispatch);
  if (dispatch) dispatch(state.tr.split(state.selection.from, 1, [{ type: thoughtsSchema.nodes.para, attrs: { bullet: true } }]).scrollIntoView());
  return true;
};

/** "- " typed at the start of a line makes it a bullet. */
function dashToBullet(view: EditorView, from: number, to: number, text: string): boolean {
  const $from = view.state.doc.resolve(from);
  if (text !== " " || $from.parent.attrs.bullet || $from.parentOffset !== 1 || $from.parent.textContent[0] !== "-") return false;
  const start = $from.start();
  const tr = view.state.tr.delete(start, to).setNodeMarkup($from.before(), undefined, { bullet: true });
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, start)));
  return true;
}

export interface ThoughtsEditor {
  readonly view: EditorView;
  readonly dom: HTMLElement;
  get value(): string;
  set(text: string): void;
  focus(): void;
}

/** A Thoughts editor in `host`, with its small toolbar; `changed` runs after each edit. */
export function createThoughtsEditor(host: HTMLElement, changed: () => void): ThoughtsEditor {
  const mod = /Mac/i.test(navigator.userAgent) ? "Cmd" : "Ctrl";
  const keys = keymap({
    "Mod-b": toggleMark(strong),
    "Mod-i": toggleMark(em),
    "Mod-u": toggleMark(underline),
    "Mod-Shift-8": toggleBullet,
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-y": redo,
    Enter: enter,
  });
  const fresh = (text: string) => EditorState.create({ doc: parseThoughts(text), plugins: [history(), keys, keymap(baseKeymap)] });

  const bar = document.createElement("div");
  bar.className = "thoughts-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Thoughts formatting");
  const mount = document.createElement("div");
  mount.className = "thoughts-text";
  host.append(bar, mount);

  const view = new EditorView(mount, {
    state: fresh(""),
    handleTextInput: (v, from, to, text) => dashToBullet(v, from, to, text),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      showState();
      if (tr.docChanged) changed();
    },
    attributes: { id: "notes-text", role: "textbox", "aria-multiline": "true", "aria-label": "Thoughts", spellcheck: "true" },
  });

  const tools: [string, string, string, Command, (s: EditorState) => boolean][] = [
    ["thoughts-bullet", "•", `Bullet points (${mod}+Shift+8)`, toggleBullet, (s) => !!s.selection.$from.parent.attrs.bullet],
    ["thoughts-bold", "B", `Bold (${mod}+B)`, toggleMark(strong), (s) => markOn(s, strong)],
    ["thoughts-italic", "I", `Italic (${mod}+I)`, toggleMark(em), (s) => markOn(s, em)],
    ["thoughts-underline", "U", `Underline (${mod}+U)`, toggleMark(underline), (s) => markOn(s, underline)],
  ];
  const buttons = tools.map(([id, face, title, cmd]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = `thoughts-tool ${id}`;
    b.textContent = face;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      cmd(view.state, view.dispatch);
      view.focus();
    });
    bar.append(b);
    return b;
  });
  function markOn(s: EditorState, m: MarkType) {
    const { from, to, empty, $from } = s.selection;
    return empty ? !!m.isInSet(s.storedMarks ?? $from.marks()) : s.doc.rangeHasMark(from, to, m);
  }
  function showState() {
    tools.forEach((t, i) => buttons[i].setAttribute("aria-pressed", String(t[4](view.state))));
  }

  return {
    view,
    dom: view.dom as HTMLElement,
    get value() {
      return serializeThoughts(view.state.doc);
    },
    set(text: string) {
      view.updateState(fresh(text));
      showState();
    },
    focus: () => view.focus(),
  };
}
