// Revision sets (Format > Revisions). Sets live in the project (Rust:
// cirth_core::revisions, the store's revision_sets table); the script keeps
// which text belongs to which set as a `revision` mark on its runs.
//
// While revision mode is on, every edit's changed text is tagged with the
// active set in the same transaction as the edit, so undo removes the tag
// with the change. A change is found by comparing each block with its
// previous version by stable id, on text plus printed formatting (bold,
// italic, underline): the changed middle is tagged; a deletion tags the
// character where it happened; a block that changed kind, dual or page
// break is tagged whole; a deleted block tags the end of the block before
// it. Colour and highlight (screen only) are not revisions. Undo and redo
// are never tagged.
//
// On screen, the active set's text is underlined in its colour and its
// blocks carry the set's mark in the right margin; colour is never the only
// sign of a revision.

import { invoke } from "@tauri-apps/api/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema";
import { announce } from "./a11y";
import { confirmDialog } from "./confirm";

export interface RevisionSet {
  id: string;
  label: string;
  colour: string;
  date: string;
  mark: string;
  author: string;
}

export interface RevisionState {
  sets: RevisionSet[];
  passages: number[];
  active: string | null;
  mode: boolean;
  next_colour: string;
  next_label: string;
}

/** Paper colours in the usual order (cirth_core::revisions::COLOURS). */
export const COLOURS = ["blue", "pink", "yellow", "green", "goldenrod", "buff", "salmon", "cherry", "tan"] as const;

interface PluginState {
  /** Set new changes go into; null when revision mode is off. */
  tagging: string | null;
  /** Active set (shown on screen) and its margin mark. */
  active: string | null;
  mark: string;
  decos: DecorationSet;
}

export const revisionKey = new PluginKey<PluginState>("cirth-revisions");

/** Printed formatting of one character: bold | italic << 1 | underline << 2. */
function printed(node: PMNode): { text: string; style: number[] } {
  let text = "";
  const style: number[] = [];
  node.forEach((t) => {
    const s = (t.marks.some((m) => m.type.name === "strong") ? 1 : 0) | (t.marks.some((m) => m.type.name === "em") ? 2 : 0) | (t.marks.some((m) => m.type.name === "underline") ? 4 : 0);
    const str = t.text ?? "";
    text += str;
    for (let i = 0; i < str.length; i++) style.push(s);
  });
  return { text, style };
}

const shape = (n: PMNode) => `${n.attrs.kind}|${n.attrs.dual ? 1 : 0}|${n.attrs.breakBefore ? 1 : 0}`;

/** Text ranges (document positions in `doc`) to tag after `before` became `doc`. */
export function changedRanges(before: PMNode, doc: PMNode): [number, number][] {
  const old = new Map<string, PMNode>();
  const oldOrder: string[] = [];
  before.forEach((n) => {
    if (n.attrs.id) {
      old.set(n.attrs.id, n);
      oldOrder.push(n.attrs.id);
    }
  });
  const now = new Map<string, { node: PMNode; pos: number }>();
  doc.forEach((n, pos) => {
    if (n.attrs.id) now.set(n.attrs.id, { node: n, pos });
  });
  const out: [number, number][] = [];
  const point = (node: PMNode, pos: number, at: number) => {
    // One character at a deletion point: the one before it, else the one after.
    const len = node.content.size;
    if (len === 0) return;
    const i = at > 0 ? at - 1 : 0;
    out.push([pos + 1 + i, pos + 2 + i]);
  };
  doc.forEach((n, pos) => {
    const o = n.attrs.id ? old.get(n.attrs.id) : undefined;
    if (o === n) return; // untouched (nodes are shared between versions)
    if (!o || shape(o) !== shape(n)) {
      if (n.content.size) out.push([pos + 1, pos + 1 + n.content.size]);
      return;
    }
    const a = printed(o);
    const b = printed(n);
    const same = (i: number, j: number) => a.text[i] === b.text[j] && a.style[i] === b.style[j];
    let start = 0;
    while (start < a.text.length && start < b.text.length && same(start, start)) start++;
    let endA = a.text.length;
    let endB = b.text.length;
    while (endA > start && endB > start && same(endA - 1, endB - 1)) {
      endA--;
      endB--;
    }
    if (endB > start) out.push([pos + 1 + start, pos + 1 + endB]);
    else if (endA > start) point(n, pos, start);
  });
  // Deleted blocks: tag the end of the nearest earlier block that remains.
  oldOrder.forEach((id, i) => {
    if (now.has(id)) return;
    for (let k = i - 1; k >= 0; k--) {
      const keep = now.get(oldOrder[k]);
      if (keep) {
        point(keep.node, keep.pos, keep.node.content.size);
        return;
      }
    }
    const first = doc.firstChild;
    if (first) point(first, 0, 0);
  });
  return out;
}

function decorations(doc: PMNode, active: string | null, mark: string): DecorationSet {
  if (!active) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.forEach((n, pos) => {
    let has = false;
    n.forEach((t) => {
      if (!has && t.marks.some((m) => m.type.name === "revision" && m.attrs.set === active)) has = true;
    });
    if (has) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: "revised", "data-rev-mark": mark || "*" }));
  });
  return DecorationSet.create(doc, decos);
}

export function revisionsPlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: revisionKey,
    state: {
      init: () => ({ tagging: null, active: null, mark: "*", decos: DecorationSet.empty }),
      apply(tr, v, _old, state) {
        const next = tr.getMeta(revisionKey) as Partial<PluginState> | undefined;
        if (next) {
          const s = { ...v, ...next };
          return { ...s, decos: decorations(state.doc, s.active, s.mark) };
        }
        return tr.docChanged ? { ...v, decos: decorations(state.doc, v.active, v.mark) } : v;
      },
    },
    appendTransaction(trs: readonly Transaction[], oldState: EditorState, newState: EditorState) {
      const set = revisionKey.getState(newState)?.tagging;
      if (!set || !trs.some((t) => t.docChanged)) return null;
      // Undo and redo restore earlier text with its earlier tags.
      if (trs.some((t) => t.getMeta("history$") || t.getMeta(revisionKey))) return null;
      const ranges = changedRanges(oldState.doc, newState.doc);
      if (!ranges.length) return null;
      const tr = newState.tr;
      const mark = schema.marks.revision.create({ set });
      for (const [from, to] of ranges) tr.addMark(from, to, mark);
      return tr.docChanged ? tr : null;
    },
    props: { decorations: (state) => revisionKey.getState(state)?.decos },
  });
}

/** Remove one set's tags from the whole script (one undoable step). */
function clearTr(state: EditorState, setId: string): Transaction {
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    if (!n.isText) return true;
    const m = n.marks.find((x) => x.type.name === "revision" && x.attrs.set === setId);
    if (m) tr.removeMark(pos, pos + n.nodeSize, m);
    return false;
  });
  return tr;
}

/** Colour of each set on screen: one style rule per set id. */
function paintSets(sets: RevisionSet[], active: string | null) {
  let style = document.getElementById("revision-colours") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "revision-colours";
    document.head.append(style);
  }
  style.textContent = sets
    .filter((s) => s.id === active)
    .map((s) => `.ProseMirror .rev[data-rev="${CSS.escape(s.id)}"] { --rev: var(--rev-${s.colour}, var(--accent)); text-decoration: underline 2px var(--rev); text-underline-offset: 3px; }`)
    .join("\n");
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Revision sets dialog, revision mode and clearing marks. `getView` gives the
 * open editor; `onChange` runs after anything that changes printed output.
 */
export function createRevisions(getView: () => EditorView | null, onChange: () => void) {
  let state: RevisionState = { sets: [], passages: [], active: null, mode: false, next_colour: "blue", next_label: "Blue Revision" };
  const statusEl = document.createElement("span");
  statusEl.id = "revision-status";
  statusEl.hidden = true;
  document.getElementById("status")?.after(statusEl);

  const dialog = document.createElement("dialog");
  dialog.id = "revisions-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-label", "Revision sets");
  document.body.append(dialog);

  const activeSet = () => state.sets.find((s) => s.id === state.active) ?? null;

  function apply(next: RevisionState) {
    state = next;
    const set = activeSet();
    const view = getView();
    if (view) view.dispatch(view.state.tr.setMeta(revisionKey, { tagging: state.mode && set ? set.id : null, active: set?.id ?? null, mark: set?.mark || "*" }));
    paintSets(state.sets, state.active);
    statusEl.hidden = !set;
    statusEl.textContent = set ? `${state.mode ? "Revising" : "Revision set"}: ${set.label}${set.date ? ` (${set.date})` : ""}` : "";
    statusEl.className = state.mode ? "revising" : "";
    if (dialog.open) render();
  }

  async function command(action: string, args: Record<string, unknown> = {}) {
    try {
      apply(await invoke<RevisionState>("revision_command", { action, ...args }));
      onChange();
      return true;
    } catch (e) {
      announce(`${e}`, true);
      return false;
    }
  }

  function render() {
    dialog.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = "Revision sets";
    const note = document.createElement("p");
    note.className = "form-note";
    note.textContent = "Changes made in revision mode belong to the active set. Its pages print with the set's label and date at the top and its mark beside each changed line.";
    const table = document.createElement("table");
    table.className = "rev-table";
    table.innerHTML = "<thead><tr><th>Active</th><th>Label</th><th>Colour</th><th>Date</th><th>Mark</th><th>Marked</th><th></th></tr></thead>";
    const body = document.createElement("tbody");
    state.sets.forEach((s, i) => {
      const tr = document.createElement("tr");
      tr.dataset.id = s.id;
      const cell = (el: HTMLElement) => {
        const td = document.createElement("td");
        td.append(el);
        tr.append(td);
        return el;
      };
      const radio = cell(document.createElement("input")) as HTMLInputElement;
      radio.type = "radio";
      radio.name = "rev-active";
      radio.checked = s.id === state.active;
      radio.setAttribute("aria-label", `Make ${s.label} active`);
      radio.addEventListener("change", () => void command("activate", { id: s.id }));
      const text = (key: "label" | "date" | "mark", label: string, size: number) => {
        const input = cell(document.createElement("input")) as HTMLInputElement;
        input.type = "text";
        input.value = s[key];
        input.size = size;
        input.className = `rev-${key}`;
        input.setAttribute("aria-label", `${label} of ${s.label}`);
        input.addEventListener("change", () => void command("put", { set: { ...s, [key]: input.value } }));
      };
      text("label", "Label", 18);
      const colour = cell(document.createElement("select")) as HTMLSelectElement;
      colour.className = "rev-colour";
      colour.setAttribute("aria-label", `Colour of ${s.label}`);
      // An older project may have a white set (before tan replaced it).
      for (const c of s.colour === "white" ? [...COLOURS, "white"] : COLOURS) colour.add(new Option(c[0].toUpperCase() + c.slice(1), c, false, c === s.colour));
      colour.addEventListener("change", () => void command("put", { set: { ...s, colour: colour.value } }));
      text("date", "Date", 10);
      text("mark", "Mark", 2);
      const count = cell(document.createElement("span"));
      count.textContent = String(state.passages[i] ?? 0);
      count.title = "Passages of text marked with this set";
      const del = cell(document.createElement("button")) as HTMLButtonElement;
      del.type = "button";
      del.textContent = "Delete";
      del.className = "rev-delete";
      del.disabled = (state.passages[i] ?? 0) > 0;
      del.title = del.disabled ? "Clear this set's marks before deleting it" : "Delete this set";
      del.setAttribute("aria-label", `Delete ${s.label}`);
      del.addEventListener("click", () => void command("delete", { id: s.id }));
      body.append(tr);
    });
    table.append(body);
    const mode = document.createElement("label");
    mode.className = "toggle";
    const modeBox = document.createElement("input");
    modeBox.type = "checkbox";
    modeBox.id = "rev-mode";
    modeBox.checked = state.mode;
    modeBox.disabled = !state.active;
    modeBox.addEventListener("change", () => void command("mode", { on: modeBox.checked }));
    mode.append(modeBox, " Revision mode: mark changes with the active set");
    const add = document.createElement("button");
    add.type = "button";
    add.id = "rev-add";
    add.textContent = `Add ${state.next_label}`;
    add.addEventListener("click", () => void addNext());
    const close = document.createElement("button");
    close.type = "button";
    close.id = "rev-close";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    actions.append(add, close);
    dialog.append(h, note, table, mode, actions);
  }

  async function addNext() {
    const set: RevisionSet = { id: crypto.randomUUID(), label: state.next_label, colour: state.next_colour, date: today(), mark: "*", author: "" };
    if (await command("put", { set })) announce(`${set.label} added and active`);
  }

  return {
    get state() {
      return state;
    },
    /** Load this document's sets (after opening a project). */
    async refresh() {
      apply(await invoke<RevisionState>("revision_state"));
    },
    async open() {
      await this.refresh();
      render();
      if (!dialog.open) dialog.showModal();
      (dialog.querySelector("#rev-add") as HTMLElement | null)?.focus();
    },
    close: () => dialog.close(),
    addNext,
    async setMode(on: boolean) {
      if (on && !state.active) {
        // First use: start the next set rather than refuse.
        if (!(await command("put", { set: { id: crypto.randomUUID(), label: state.next_label, colour: state.next_colour, date: today(), mark: "*", author: "" } }))) return false;
      }
      const ok = await command("mode", { on });
      if (ok) announce(on ? `Revision mode on: changes go into ${activeSet()?.label}` : "Revision mode off");
      return ok;
    },
    /** Format > Revisions > Clear Marks of This Set…: asks first; undoable. */
    async clearActive() {
      const set = activeSet();
      const view = getView();
      if (!set || !view) {
        announce("No revision set is active.", true);
        return false;
      }
      if (!(await confirmDialog(`Clear ${set.label} marks?`, `The text stays as it is; it is no longer marked as changed in ${set.label}, so its pages no longer print as revised. You can undo this.`, "Clear Marks"))) return false;
      view.dispatch(clearTr(view.state, set.id).setMeta(revisionKey, {}));
      announce(`${set.label} marks cleared`);
      onChange();
      return true;
    },
  };
}
