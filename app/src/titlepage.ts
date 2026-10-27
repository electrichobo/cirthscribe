// File > Title Page…: the document's title page fields. Stored in the
// project (Rust: cirth_core::title), printed before page 1 in PDF and plain
// text exports when it has a title; never part of the script text.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface TitlePage {
  title: string;
  credit: string;
  authors: string;
  source: string;
  draft_label: string;
  draft_date: string;
  contact: string;
  wga: string;
  notes: string;
}

const FIELDS: { key: keyof TitlePage; label: string; hint?: string; lines?: number }[] = [
  { key: "title", label: "Title", hint: "Printed only when there is a title" },
  { key: "credit", label: "Credit", hint: "e.g. Written by" },
  { key: "authors", label: "Authors", hint: "One per line", lines: 2 },
  { key: "source", label: "Source", hint: "e.g. Based on the novel by …", lines: 2 },
  { key: "draft_label", label: "Draft or revision", hint: "e.g. Second Draft" },
  { key: "draft_date", label: "Draft date" },
  { key: "wga", label: "WGA registration" },
  { key: "contact", label: "Contact", hint: "Bottom left: one item per line", lines: 3 },
  { key: "notes", label: "Notes", hint: "Bottom right, under the date", lines: 2 },
];

export function createTitlePageDialog(afterSave: () => Promise<void>) {
  const dialog = document.createElement("dialog");
  dialog.id = "title-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-label", "Title page");
  document.body.append(dialog);
  const inputs = new Map<keyof TitlePage, HTMLInputElement | HTMLTextAreaElement>();

  const h = document.createElement("h2");
  h.textContent = "Title page";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "Printed before page 1 in PDF and text exports. It is not counted as a page.";
  const grid = document.createElement("div");
  grid.className = "form-grid";
  for (const f of FIELDS) {
    const id = `tp-${f.key}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = f.label;
    const input = f.lines ? document.createElement("textarea") : document.createElement("input");
    input.id = id;
    if (input instanceof HTMLTextAreaElement) input.rows = f.lines!;
    else input.type = "text";
    if (f.hint) input.placeholder = f.hint;
    inputs.set(f.key, input);
    grid.append(label, input);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.id = "tp-save";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "tp-cancel";
  cancel.textContent = "Cancel";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, save);
  dialog.append(h, note, grid, actions);

  cancel.addEventListener("click", () => dialog.close());
  save.addEventListener("click", async () => {
    const page = Object.fromEntries([...inputs].map(([k, el]) => [k, el.value])) as unknown as TitlePage;
    try {
      await invoke("set_title_page", { page });
      await afterSave();
      dialog.close();
      announce(page.title.trim() ? "Title page saved" : "Title page saved; it has no title, so it is not printed");
    } catch (e) {
      announce(`Could not save the title page: ${e}`, true);
    }
  });

  async function open() {
    const tp = await invoke<TitlePage>("title_page");
    for (const [k, el] of inputs) el.value = tp[k] ?? "";
    if (!dialog.open) dialog.showModal();
    inputs.get("title")!.focus();
  }

  return { open, close: () => dialog.close() };
}
