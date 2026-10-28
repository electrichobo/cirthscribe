// File > Headers and Footers…: text printed on every page from page 2 in PDF
// and text exports (the header left of the page number, the footer centred
// at the bottom). {title}, {draft} and {date} come from the title page.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export function createFurnitureDialog(afterSave: () => Promise<void>) {
  const dialog = document.createElement("dialog");
  dialog.id = "furniture-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-label", "Headers and footers");
  const h = document.createElement("h2");
  h.textContent = "Headers and footers";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "Printed from page 2, like page numbers. {title}, {draft} and {date} are filled in from the title page.";
  const grid = document.createElement("div");
  grid.className = "form-grid";
  const field = (id: string, label: string, placeholder: string) => {
    const l = document.createElement("label");
    l.htmlFor = id;
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.placeholder = placeholder;
    grid.append(l, input);
    return input;
  };
  const header = field("pf-header", "Header (top left)", "e.g. {title} - {draft}");
  const footer = field("pf-footer", "Footer (bottom centre)", "e.g. Confidential");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "pf-cancel";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.type = "button";
  save.id = "pf-save";
  save.textContent = "Save";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, save);
  dialog.append(h, note, grid, actions);
  document.body.append(dialog);

  cancel.addEventListener("click", () => dialog.close());
  save.addEventListener("click", async () => {
    try {
      await invoke("set_page_furniture", { header: header.value, footer: footer.value });
      await afterSave();
      dialog.close();
      announce("Headers and footers saved");
    } catch (e) {
      announce(`Could not save headers and footers: ${e}`, true);
    }
  });

  async function open() {
    const f = await invoke<{ header: string; footer: string }>("page_furniture");
    header.value = f.header;
    footer.value = f.footer;
    if (!dialog.open) dialog.showModal();
    header.focus();
  }

  return { open, close: () => dialog.close() };
}
