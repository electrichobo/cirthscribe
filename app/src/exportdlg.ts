// File > Export…: one dialog listing every export, each with a line on what
// it keeps. Choosing one runs that format's own export (save dialog, then a
// report of what the format could not carry). Reports, sides and
// stripboards join the list when M4 builds them.

import { announce } from "./a11y";

export type ExportFormat = "pdf" | "pdf_changed" | "txt" | "fountain" | "fdx" | "docx" | "rtf" | "html" | "reports" | "stripboard" | "sides";

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: "pdf", label: "PDF", note: "The printed script: title page, scene numbers, headers and footers, revision marks." },
  { id: "pdf_changed", label: "PDF, changed pages only", note: "Only the pages with the active revision set's changes, for distribution." },
  { id: "txt", label: "Plain text", note: "The same pages and line breaks as the PDF, without bold, italic or colour." },
  { id: "fountain", label: "Fountain", note: "Plain-text screenplay format read by many writing apps." },
  { id: "fdx", label: "Final Draft (.fdx)", note: "Elements, emphasis, dual dialogue, title page and scene numbers." },
  { id: "docx", label: "Word (.docx)", note: "For Word, Google Docs and LibreOffice. Dual dialogue is printed one speech after the other." },
  { id: "rtf", label: "Rich Text (.rtf)", note: "For older word processors and TextEdit." },
  { id: "html", label: "Web page (.html)", note: "One standalone page to read in a browser." },
  { id: "reports", label: "Reports (StoryScry)…", note: "Scenes, characters, locations, action vs dialogue, INT/EXT, day/night and revisions in XLSX, CSV, TSV, PDF, HTML or RTF." },
  { id: "stripboard", label: "Stripboard & schedule…", note: "Scene strips, day breaks, banners and notes in PDF, HTML, XLSX, CSV or TSV." },
  { id: "sides", label: "Character sides…", note: "Pages for actors: their scenes only or full pages struck through, keeping dual dialogue intact." },
];

export function createExportDialog(hooks: { hasActiveRevision: () => boolean; run: (format: ExportFormat) => Promise<unknown> }) {
  const dialog = document.createElement("dialog");
  dialog.id = "export-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-labelledby", "export-title");
  const h = document.createElement("h2");
  h.id = "export-title";
  h.textContent = "Export";
  const list = document.createElement("div");
  list.className = "export-list";
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-labelledby", "export-title");
  const radios = new Map<ExportFormat, HTMLInputElement>();
  for (const f of FORMATS) {
    const row = document.createElement("label");
    row.className = "export-row";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "export-format";
    r.value = f.id;
    r.id = `export-${f.id}`;
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = f.label;
    const note = document.createElement("span");
    note.className = "form-note";
    note.textContent = f.note;
    text.append(name, note);
    row.append(r, text);
    list.append(row);
    radios.set(f.id, r);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "export-cancel";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.id = "export-go";
  go.className = "primary";
  go.textContent = "Export…";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(cancel, go);
  dialog.append(h, list, actions);
  document.body.append(dialog);

  const chosen = () => [...radios.values()].find((r) => r.checked)?.value as ExportFormat | undefined;
  cancel.addEventListener("click", () => dialog.close());
  go.addEventListener("click", () => {
    const f = chosen();
    if (!f) return;
    dialog.close();
    void hooks.run(f);
  });
  list.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".export-row")) go.click();
  });

  function open() {
    // Changed pages need an active revision set.
    const changed = radios.get("pdf_changed")!;
    changed.disabled = !hooks.hasActiveRevision();
    changed.closest("label")!.title = changed.disabled ? "Choose a revision set first (Format > Revisions)" : "";
    if (!chosen() || chosen() === "pdf_changed") radios.get("pdf")!.checked = true;
    if (!dialog.open) dialog.showModal();
    [...radios.values()].find((r) => r.checked)!.focus();
    announce("Export: choose a format");
  }

  return { open, close: () => dialog.close(), formats: FORMATS.map((f) => f.id) };
}
