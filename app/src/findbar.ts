// The find/replace bar above the script. Ctrl/Cmd+F opens it (prefilled with
// the selected text); Enter = next, Shift+Enter = previous, Escape = close and
// return to the script. Enter in the Replace field replaces the current match.

import type { EditorView } from "prosemirror-view";
import { KINDS, KIND_LABEL, type Kind } from "./schema";
import { findState, replaceAll, replaceCurrent, setQuery, step, type FindOptions } from "./find";

export function installFindBar(root: HTMLElement, getView: () => EditorView | undefined, notify: (msg: string) => void) {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const query = $<HTMLInputElement>("#find-query");
  const replacement = $<HTMLInputElement>("#find-replace");
  const matchCase = $<HTMLInputElement>("#find-case");
  const wholeWord = $<HTMLInputElement>("#find-word");
  const kind = $<HTMLSelectElement>("#find-kind");
  const count = $<HTMLElement>("#find-count");
  kind.replaceChildren(new Option("All block types", "all"), ...KINDS.map((k) => new Option(KIND_LABEL[k], k)));

  const opts = (): FindOptions => ({ query: query.value, matchCase: matchCase.checked, wholeWord: wholeWord.checked, kind: kind.value as Kind | "all" });

  function showCount() {
    const v = getView();
    if (!v || root.hidden) return;
    const fs = findState(v.state);
    count.textContent = !query.value ? "" : fs.matches.length ? `${fs.current >= 0 ? fs.current + 1 : "–"} of ${fs.matches.length}` : "No matches";
  }

  function update() {
    const v = getView();
    if (!v) return;
    v.dispatch(setQuery(v.state, opts()));
    showCount();
  }

  /** Scroll the script so the selected match sits below the bar. ProseMirror
   *  only scrolls to its selection when the editor holds the DOM selection,
   *  which it does not while you type in the find field. */
  function reveal(v: EditorView) {
    const scroller = v.dom.closest(".editor-wrap") as HTMLElement | null;
    if (!scroller) return;
    const c = v.coordsAtPos(v.state.selection.from);
    const box = scroller.getBoundingClientRect();
    const barBottom = root.hidden ? box.top : root.getBoundingClientRect().bottom;
    if (c.top < barBottom + 8 || c.bottom > box.bottom - 8) {
      scroller.scrollTop += c.top - box.top - scroller.clientHeight / 3;
    }
  }

  function go(dir: 1 | -1) {
    const v = getView();
    if (!v) return;
    const tr = step(v.state, dir);
    if (tr) {
      v.dispatch(tr);
      reveal(v);
    }
    showCount();
  }

  function replaceOne() {
    const v = getView();
    if (!v) return;
    // First press selects the nearest match; the next replaces it.
    const tr = replaceCurrent(v.state, replacement.value);
    if (tr) {
      v.dispatch(tr);
      reveal(v);
    } else go(1);
    showCount();
  }

  function replaceEvery() {
    const v = getView();
    if (!v) return;
    const r = replaceAll(v.state, replacement.value);
    if (!r) return;
    v.dispatch(r.tr);
    notify(`Replaced ${r.count} ${r.count === 1 ? "match" : "matches"}. One Undo restores them all.`);
    showCount();
  }

  function open() {
    const v = getView();
    root.hidden = false;
    if (v && !v.state.selection.empty) {
      const sel = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, " ");
      if (sel && !sel.includes("\n") && sel.length <= 200) query.value = sel;
    }
    query.focus();
    query.select();
    update();
  }

  function close() {
    root.hidden = true;
    const v = getView();
    if (!v) return;
    v.dispatch(setQuery(v.state, null));
    v.focus();
  }

  let timer: number | undefined;
  query.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 120);
  });
  for (const el of [matchCase, wholeWord, kind]) el.addEventListener("change", update);
  query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.clearTimeout(timer);
      update();
      go(e.shiftKey ? -1 : 1);
    }
  });
  replacement.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceOne();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  $("#find-prev").addEventListener("click", () => go(-1));
  $("#find-next").addEventListener("click", () => go(1));
  $("#find-replace-one").addEventListener("click", replaceOne);
  $("#find-replace-all").addEventListener("click", replaceEvery);
  $("#find-close").addEventListener("click", close);

  return { open, close, refreshCount: showCount, go, replaceOne, replaceEvery, update, opts };
}
