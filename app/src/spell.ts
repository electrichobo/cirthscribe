// Spell checking in the editor. Checking happens in Rust (cirth_core::spell,
// one implementation); this file draws the results and offers corrections.
//
// - Underlines are decorations: never part of the manuscript text.
// - The whole script is checked when a project opens and whenever the
//   language, a dictionary or the set of character names changes; otherwise
//   only blocks that changed, after a short pause in typing. A changed block
//   shows no underlines until its new result arrives (never stale positions).
// - Right-click on an underlined word, or Ctrl/Cmd+. with the caret in it,
//   opens a menu: suggestions, Ignore, Add to project dictionary, Add to my
//   dictionary. Arrow keys move, Enter chooses, Escape returns to the script.
// - A correction is an ordinary edit: one undo, synced like any other change.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";

type Ranges = [number, number][];

interface SpellData {
  /** Block id -> misspelled ranges (UTF-16 offsets in the block). */
  ranges: Map<string, Ranges>;
  /** Block id -> the node those ranges were computed for. */
  checked: Map<string, PMNode>;
}

const data: SpellData = { ranges: new Map(), checked: new Map() };
export const spellKey = new PluginKey<DecorationSet>("cirth-spell");

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    const r = data.ranges.get(node.attrs.id);
    // Only draw ranges computed for exactly this node.
    if (!r || !r.length || data.checked.get(node.attrs.id) !== node) return;
    for (const [a, b] of r) decos.push(Decoration.inline(pos + 1 + a, pos + 1 + b, { class: "misspelled" }));
  });
  return DecorationSet.create(doc, decos);
}

export function spellPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: spellKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, set, _old, state) => (tr.docChanged || tr.getMeta(spellKey) ? build(state.doc) : set),
    },
    props: { decorations: (state) => spellKey.getState(state) },
  });
}

const cueName = (t: string) => t.replace(/\s*\(.*$/, "").trim();

function cueNames(doc: PMNode): string[] {
  const s = new Set<string>();
  doc.forEach((n) => {
    if (n.attrs.kind === "character") {
      const name = cueName(n.textContent);
      // Multi-word names: accept each word, in title case so that both
      // "Zoë" and "ZOË" pass (a dictionary word in capitals accepts only capitals).
      for (const w of name.split(/\s+/)) if (w) s.add(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
  });
  return [...s].sort();
}

/** The misspelled range around `pos`, as document positions. */
function rangeAt(view: EditorView, pos: number): { from: number; to: number; word: string } | null {
  const $p = view.state.doc.resolve(pos);
  const block = $p.parent;
  if (block.type.name !== "block" || data.checked.get(block.attrs.id) !== block) return null;
  const off = $p.parentOffset;
  for (const [a, b] of data.ranges.get(block.attrs.id) ?? []) {
    if (off >= a && off <= b) {
      const from = $p.start() + a;
      const to = $p.start() + b;
      return { from, to, word: view.state.doc.textBetween(from, to) };
    }
  }
  return null;
}

export function installSpell(getView: () => EditorView | undefined, notify: (msg: string) => void) {
  let lang = "en_US";
  let namesKey = "";
  let timer: number | undefined;
  let running: Promise<void> | null = null;
  let generation = 0;

  async function check(all: boolean): Promise<void> {
    const view = getView();
    if (!view) return;
    const gen = generation;
    const names = cueNames(view.state.doc);
    const nk = names.join("\u0001");
    if (nk !== namesKey) all = true; // a new name may clear words elsewhere
    const blocks: { id: string; text: string }[] = [];
    const nodes = new Map<string, PMNode>();
    view.state.doc.forEach((n) => {
      if (all || data.checked.get(n.attrs.id) !== n) {
        blocks.push({ id: n.attrs.id, text: n.textContent });
        nodes.set(n.attrs.id, n);
      }
    });
    if (!blocks.length) return;
    let res: { id: string; ranges: Ranges }[];
    try {
      res = await invoke("spell_check", { blocks, names });
    } catch {
      return; // no project open, or closing: nothing to draw
    }
    if (gen !== generation) return; // language or dictionaries changed meanwhile
    namesKey = nk;
    for (const r of res) {
      data.ranges.set(r.id, r.ranges);
      data.checked.set(r.id, nodes.get(r.id)!);
    }
    const v = getView();
    if (v) v.dispatch(v.state.tr.setMeta(spellKey, true).setMeta("addToHistory", false));
  }

  /** Run a check now (or after the one in progress). Resolves when drawn. */
  async function run(all: boolean): Promise<void> {
    while (running) await running;
    running = check(all).finally(() => (running = null));
    return running;
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(false), 400);
  }

  /** New project or new language/dictionary: forget everything, check all. */
  async function reset(): Promise<void> {
    generation++;
    data.ranges.clear();
    data.checked.clear();
    namesKey = "";
    const v = getView();
    if (v) v.dispatch(v.state.tr.setMeta(spellKey, true).setMeta("addToHistory", false));
    await run(true);
  }

  async function onOpen(select: HTMLSelectElement) {
    try {
      lang = (await invoke<{ lang: string }>("spell_settings")).lang;
    } catch {
      lang = "en_US";
    }
    select.value = lang;
    await reset();
  }

  async function setLang(next: string) {
    lang = await invoke<string>("set_spelling", { lang: next });
    await reset();
  }

  // --- Correction menu ---------------------------------------------------------
  const menu = document.createElement("div");
  menu.className = "spell-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Spelling");
  menu.hidden = true;
  document.body.append(menu);
  let openFor: { from: number; to: number; word: string } | null = null;

  function closeMenu(refocus = true) {
    menu.hidden = true;
    openFor = null;
    const v = getView();
    if (refocus && v) v.focus();
  }

  function replace(view: EditorView, from: number, to: number, text: string) {
    const marks = view.state.doc.resolve(from + 1).marks();
    view.dispatch(view.state.tr.replaceWith(from, to, view.state.schema.text(text, marks)).scrollIntoView());
  }

  async function openMenu(view: EditorView, r: { from: number; to: number; word: string }, x: number, y: number) {
    openFor = r;
    let suggestions: string[] = [];
    try {
      suggestions = await invoke<string[]>("spell_suggest", { word: r.word });
    } catch {
      // no suggestions
    }
    const item = (label: string, act: () => void | Promise<void>, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.className = cls;
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", async () => {
        closeMenu();
        await act();
      });
      return b;
    };
    const items: HTMLElement[] = suggestions.length
      ? suggestions.map((s) => item(s, () => replace(view, r.from, r.to, s), "suggestion"))
      : [Object.assign(document.createElement("div"), { className: "none", textContent: "No suggestions" })];
    const sep = () => Object.assign(document.createElement("hr"), {});
    items.push(
      sep(),
      item(`Ignore "${r.word}"`, async () => {
        await invoke("spell_ignore", { word: r.word });
        await run(true);
      }),
      item("Add to project dictionary", async () => {
        await invoke("spell_add", { word: r.word, scope: "project" });
        notify(`"${r.word}" added to this project's dictionary.`);
        await run(true);
      }),
      item("Add to my dictionary", async () => {
        await invoke("spell_add", { word: r.word, scope: "user" });
        notify(`"${r.word}" added to your dictionary (all projects).`);
        await run(true);
      }),
    );
    menu.replaceChildren(...items);
    menu.hidden = false;
    menu.style.left = `${Math.round(Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.round(y + menu.offsetHeight > window.innerHeight - 8 ? Math.max(4, y - menu.offsetHeight) : y)}px`;
    (menu.querySelector("button") as HTMLButtonElement | null)?.focus();
  }

  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll("button")] as HTMLButtonElement[];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = buttons.length;
      buttons[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu(false);
  });

  /** Right-click on an underlined word. */
  function onContextMenu(view: EditorView, e: MouseEvent): boolean {
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    const r = hit && rangeAt(view, hit.pos);
    if (!r) return false;
    e.preventDefault();
    // Below the word's line, so the menu never covers the word itself.
    void openMenu(view, r, e.clientX, view.coordsAtPos(r.from).bottom + 4);
    return true;
  }

  /** Ctrl/Cmd+. : the menu for the word at the caret. */
  function menuAtCaret(): boolean {
    const view = getView();
    if (!view) return false;
    const r = rangeAt(view, view.state.selection.from);
    if (!r) {
      notify("No spelling issue at the cursor.");
      return false;
    }
    const c = view.coordsAtPos(r.to);
    void openMenu(view, r, c.left, c.bottom + 4);
    return true;
  }

  return {
    onOpen,
    setLang,
    schedule,
    run,
    reset,
    onContextMenu,
    menuAtCaret,
    get lang() {
      return lang;
    },
    /** Test hooks. */
    misspelledWords: () => {
      const v = getView();
      if (!v) return [];
      const out: string[] = [];
      spellKey.getState(v.state)?.find().forEach((d) => out.push(v.state.doc.textBetween(d.from, d.to)));
      return out;
    },
    menuItems: () => (menu.hidden ? null : [...menu.querySelectorAll("button, .none")].map((b) => b.textContent)),
    openFor: () => openFor,
  };
}
