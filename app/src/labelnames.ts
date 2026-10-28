// Scene list > Labels…: the project's names for the colour labels (M3
// decision C: a fixed palette whose names the writer can rename, for
// example "Act One" or "Rewrite"). The colour stays; a label is always
// shown with its name, never by colour alone. An empty name restores the
// colour's own name.

import { announce } from "./a11y";

export function createLabelNamesDialog(current: () => [string, string][], save: (changes: [string, string][]) => Promise<void>) {
  const dialog = document.createElement("dialog");
  dialog.id = "labels-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-labelledby", "labels-title");
  const h = document.createElement("h2");
  h.id = "labels-title";
  h.textContent = "Label names";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "Names for this project's scene labels. Leave one empty to use the colour's own name.";
  const grid = document.createElement("div");
  grid.className = "form-grid";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.id = "labels-save";
  ok.className = "primary";
  ok.textContent = "Save";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, ok);
  dialog.append(h, note, grid, actions);
  document.body.append(dialog);
  let inputs: [string, string, HTMLInputElement][] = [];

  cancel.addEventListener("click", () => dialog.close());
  ok.addEventListener("click", async () => {
    const changes = inputs.filter(([, before, i]) => i.value.trim() !== before).map(([k, , i]) => [k, i.value.trim()] as [string, string]);
    dialog.close();
    if (changes.length) {
      await save(changes);
      announce("Label names saved");
    }
  });

  return {
    open() {
      grid.replaceChildren();
      inputs = current().map(([key, name]) => {
        const l = document.createElement("label");
        l.htmlFor = `label-name-${key}`;
        l.className = "label-key";
        l.style.setProperty("--swatch", `var(--label-${key})`);
        l.textContent = key[0].toUpperCase() + key.slice(1);
        const i = document.createElement("input");
        i.type = "text";
        i.id = `label-name-${key}`;
        i.maxLength = 40;
        const own = key[0].toUpperCase() + key.slice(1);
        i.value = name === own ? "" : name;
        i.placeholder = own;
        grid.append(l, i);
        return [key, i.value, i];
      });
      if (!dialog.open) dialog.showModal();
      inputs[0]?.[2].focus();
    },
    close: () => dialog.close(),
  };
}
