// View > Go To > Page… and Scene…: jump the caret to a printed page (its
// label as printed, so "12A" works once pages are locked) or to a scene (by
// locked number, position, or words from its heading). Pages come from the
// core's page map; the editor never measures them.

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { scenesOf } from "./scenes";
import { scalarToUtf16, type PageStart } from "./pagemarks";
import { revealScene } from "./views";
import { announce } from "./a11y";

export type GoToKind = "page" | "scene";

/** Where a page starts in the document, or null. Matches the printed label first, then the page's position. */
export function findPage(view: EditorView, starts: PageStart[], query: string): number | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const hit = starts.find((s) => (s.label ?? String(s.page)).toUpperCase() === q) ?? starts.find((s) => String(s.page) === q);
  if (!hit) return null;
  let at: number | null = null;
  view.state.doc.forEach((node, pos) => {
    if (at === null && node.attrs.id === hit.block_id) at = pos + 1 + scalarToUtf16(node.textContent, hit.offset);
  });
  return at;
}

/** The scene a query names: a locked number ("12A"), a position ("3"), or words from the heading. */
export function findScene(view: EditorView, numbers: Map<string, { number: string }>, query: string): string | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const scenes = scenesOf(view.state.doc);
  const byNumber = scenes.find((s) => numbers.get(s.sceneId)?.number.toUpperCase() === q);
  if (byNumber) return byNumber.sceneId;
  if (/^\d+$/.test(q) && !numbers.size) return scenes[Number(q) - 1]?.sceneId ?? null;
  return scenes.find((s) => s.heading.toUpperCase().includes(q))?.sceneId ?? null;
}

export function createGoToDialog(hooks: { view: () => EditorView | null; starts: () => PageStart[]; numbers: () => Map<string, { number: string }> }) {
  const dialog = document.createElement("dialog");
  dialog.id = "goto-dialog";
  dialog.className = "about form-dialog";
  const h = document.createElement("h2");
  h.id = "goto-title";
  dialog.setAttribute("aria-labelledby", "goto-title");
  const label = document.createElement("label");
  label.htmlFor = "goto-input";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "goto-input";
  input.autocomplete = "off";
  const err = document.createElement("p");
  err.className = "form-note";
  err.id = "goto-error";
  err.setAttribute("role", "status");
  input.setAttribute("aria-describedby", "goto-error");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.id = "goto-go";
  go.className = "primary";
  go.textContent = "Go";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, go);
  dialog.append(h, label, input, err, actions);
  document.body.append(dialog);
  let kind: GoToKind = "page";

  cancel.addEventListener("click", () => dialog.close());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go.click();
    }
  });
  go.addEventListener("click", () => {
    const view = hooks.view();
    if (!view) return;
    if (kind === "page") {
      const at = findPage(view, hooks.starts(), input.value);
      if (at === null) {
        err.textContent = `There is no page ${input.value.trim()}.`;
        return;
      }
      dialog.close();
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).scrollIntoView());
      view.focus();
      announce(`Page ${input.value.trim()}`);
    } else {
      const id = findScene(view, hooks.numbers(), input.value);
      if (!id) {
        err.textContent = `No scene matches "${input.value.trim()}".`;
        return;
      }
      dialog.close();
      revealScene(view, id);
      announce("Scene found");
    }
  });

  function open(k: GoToKind) {
    kind = k;
    h.textContent = k === "page" ? "Go to page" : "Go to scene";
    label.textContent = k === "page" ? "Page (as printed, e.g. 12 or 12A)" : "Scene number, position or words from its heading";
    err.textContent = "";
    input.value = "";
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  return { open, close: () => dialog.close() };
}
