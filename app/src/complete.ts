// Autocomplete for character cues, scene headings and transitions.
//
// Suggestions come from the script itself and the project bible: cue names
// already used (extensions like "(V.O.)" stripped, most frequent first),
// heading prefixes, known locations and times of day, and standard
// transitions. Shown only with the caret at the end of the block, never
// during IME composition.
//
// Keys while the list is open: Up/Down choose; Tab accepts; Escape closes.
// Enter accepts and then does what Enter does next: a cue goes on to
// dialogue, a transition to the next heading, a time of day ends the
// heading; a heading prefix or location stays in the heading (a location
// adds " - " and offers times).

import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

type Mode = "cue" | "extension" | "prefix" | "location" | "time" | "transition";

interface Suggest {
  mode: Mode;
  items: string[];
  index: number;
  from: number; // range replaced on accept
  to: number;
}

interface AcState {
  s: Suggest | null;
  dismissed: boolean;
}

export const acKey = new PluginKey<AcState>("cirth-complete");

const PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "EST. ", "I/E. "];
const TIMES = ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MORNING", "AFTERNOON", "EVENING", "DAWN", "DUSK", "MOMENTS LATER", "SAME TIME"];
const TRANSITIONS = ["CUT TO:", "DISSOLVE TO:", "SMASH CUT TO:", "MATCH CUT TO:", "JUMP CUT TO:", "FADE TO BLACK.", "FADE OUT.", "FADE IN:"];
const EXTENSIONS = ["V.O.)", "O.S.)", "O.C.)", "CONT'D)"];
const HEADING_RE = /^((?:INT\.\/EXT|INT\/EXT|INT|EXT|EST|I\/E)\.?\s+)(.*)$/i;

/** Cue name without extensions: "MARGIT (V.O.)" -> "MARGIT". */
const cueName = (t: string) => t.replace(/\s*\(.*$/, "").trim().toUpperCase();

interface Known {
  cues: Map<string, number>;
  locations: Map<string, number>;
  times: Map<string, number>;
}

/** Names from the project bible (M3 step 7), offered even before a script uses them. */
let bibleNames: { cues: string[]; locations: string[] } = { cues: [], locations: [] };
export function setBibleNames(n: { cues: string[]; locations: string[] }) {
  bibleNames = n;
}

function collect(doc: PMNode, skipPos: number): Known {
  const k: Known = { cues: new Map(), locations: new Map(), times: new Map() };
  const bump = (m: Map<string, number>, v: string) => v && m.set(v, (m.get(v) ?? 0) + 1);
  for (const n of bibleNames.cues) bump(k.cues, n);
  for (const n of bibleNames.locations) bump(k.locations, n);
  doc.forEach((n, pos) => {
    if (pos === skipPos) return;
    const t = n.textContent;
    if (n.attrs.kind === "character") bump(k.cues, cueName(t));
    else if (n.attrs.kind === "heading") {
      const m = HEADING_RE.exec(t);
      if (!m) return;
      const rest = m[2];
      const dash = rest.lastIndexOf(" - ");
      bump(k.locations, (dash >= 0 ? rest.slice(0, dash) : rest).trim().toUpperCase());
      if (dash >= 0) bump(k.times, rest.slice(dash + 3).trim().toUpperCase());
    }
  });
  return k;
}

/** Candidates starting with `partial` (case-insensitive), best first, not equal to it. */
function rank(pool: Iterable<[string, number]>, partial: string): string[] {
  const p = partial.toUpperCase();
  return [...pool]
    .filter(([v]) => v.startsWith(p) && v !== p)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v)
    .slice(0, 8);
}

const fixed = (list: string[]) => list.map((v, i) => [v, list.length - i] as [string, number]);

export function suggestFor(state: EditorState): Suggest | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $p = sel.$from;
  const block = $p.parent;
  if (block.type.name !== "block" || $p.parentOffset !== block.content.size) return null;
  const kind = block.attrs.kind as string;
  if (!["character", "heading", "transition"].includes(kind)) return null;
  const text = block.textContent;
  const start = $p.start();
  const end = $p.end();
  if (kind === "character") {
    const open = text.lastIndexOf("(");
    if (open >= 0) {
      const items = rank(fixed(EXTENSIONS), text.slice(open + 1));
      return items.length ? { mode: "extension", items, index: 0, from: start + open + 1, to: end } : null;
    }
    if (!text.trim()) return null;
    const items = rank(collect(state.doc, $p.before()).cues, text.trim());
    return items.length ? { mode: "cue", items, index: 0, from: start, to: end } : null;
  }
  if (kind === "transition") {
    if (!text.trim()) return null;
    const items = rank(fixed(TRANSITIONS), text.trim());
    return items.length ? { mode: "transition", items, index: 0, from: start, to: end } : null;
  }
  // Scene heading.
  if (!text.trim()) return null;
  const m = HEADING_RE.exec(text);
  if (!m) {
    const items = rank(fixed(PREFIXES), text);
    return items.length ? { mode: "prefix", items, index: 0, from: start, to: end } : null;
  }
  const rest = m[2];
  const dash = rest.lastIndexOf(" - ");
  const known = collect(state.doc, $p.before());
  if (dash >= 0) {
    const partial = rest.slice(dash + 3);
    const pool = new Map(known.times);
    for (const [v, n] of fixed(TIMES)) pool.set(v, (pool.get(v) ?? 0) + n / 100);
    const items = rank(pool, partial);
    return items.length ? { mode: "time", items, index: 0, from: start + m[1].length + dash + 3, to: end } : null;
  }
  if (!rest.trim()) return null;
  const items = rank(known.locations, rest);
  return items.length ? { mode: "location", items, index: 0, from: start + m[1].length, to: end } : null;
}

function accept(view: EditorView, s: Suggest): void {
  let insert = s.items[s.index];
  if (s.mode === "location") insert += " - ";
  const tr = view.state.tr.insertText(insert, s.from, s.to);
  tr.setSelection(TextSelection.create(tr.doc, s.from + insert.length));
  view.dispatch(tr.scrollIntoView());
}

export function completePlugin(): Plugin<AcState> {
  return new Plugin<AcState>({
    key: acKey,
    state: {
      init: () => ({ s: null, dismissed: false }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(acKey) as Partial<AcState> & { index?: number } | undefined;
        if (meta?.dismissed) return { s: null, dismissed: true };
        if (meta?.index !== undefined && prev.s) return { ...prev, s: { ...prev.s, index: meta.index } };
        if (!tr.docChanged && !tr.selectionSet) return prev;
        // Typing re-opens suggestions after Escape; moving the caret does not.
        const dismissed = prev.dismissed && !tr.docChanged;
        return { s: dismissed ? null : suggestFor(state), dismissed };
      },
    },
    props: {
      handleKeyDown(view, e) {
        const st = acKey.getState(view.state);
        const s = st?.s;
        if (!s || view.composing || e.isComposing) return false;
        const n = s.items.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const index = (s.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
          view.dispatch(view.state.tr.setMeta(acKey, { index }));
          return true;
        }
        if (e.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(acKey, { dismissed: true }));
          return true;
        }
        if (e.key === "Tab" && !e.shiftKey) {
          accept(view, s);
          return true;
        }
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          accept(view, s);
          // Prefix and location stay in the heading; others continue to Enter.
          return s.mode === "prefix" || s.mode === "location";
        }
        return false;
      },
    },
    view(editorView) {
      const menu = document.createElement("ul");
      menu.className = "ac-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", "Suggestions");
      menu.hidden = true;
      document.body.append(menu);
      const render = (view: EditorView) => {
        const s = acKey.getState(view.state)?.s;
        if (!s || !view.hasFocus()) {
          menu.hidden = true;
          return;
        }
        menu.replaceChildren(
          ...s.items.map((item, i) => {
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", String(i === s.index));
            li.textContent = item;
            li.addEventListener("mousedown", (e) => {
              e.preventDefault(); // keep focus in the editor
              accept(view, { ...s, index: i });
            });
            return li;
          }),
        );
        const c = view.coordsAtPos(s.from);
        menu.style.left = `${Math.round(Math.min(c.left, window.innerWidth - 240))}px`;
        menu.hidden = false;
        // Below the line, or above it when there is no room below.
        const h = menu.offsetHeight;
        const below = c.bottom + 4;
        menu.style.top = `${Math.round(below + h > window.innerHeight - 28 ? Math.max(4, c.top - h - 4) : below)}px`;
      };
      render(editorView);
      return { update: render, destroy: () => menu.remove() };
    },
  });
}

/** Test hook: the suggestion state for the current selection. */
export const suggestion = (state: EditorState) => acKey.getState(state)?.s ?? null;
