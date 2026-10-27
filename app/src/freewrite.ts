// Free Writing: plain-text pieces in folders, outside any project.
//
// Saving: half a second after typing stops, and when switching pieces,
// leaving the view or closing the window. Pieces are never deleted: Trash
// keeps them, Restore brings them back.
//
// Flow mode turns editing off so you keep writing forward: text can only be
// added at the end. Backspace, Delete, cut, undo/redo, select-all and caret
// movement are blocked; clicking puts the caret back at the end; paste
// appends. Spell underlines and the sidebar are hidden. IME composition
// still works. Escape (or the button) turns editing back on.
//
// Copy into project inserts the piece's paragraphs as action blocks at the
// script's cursor (an ordinary edit: one undo) and records it on both sides.
// Move does the same and then sends the piece to Trash.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

export interface Folder {
  id: string;
  name: string;
}
export interface PieceSummary {
  id: string;
  folder_id: string | null;
  title: string;
  preview: string;
  created: string;
  modified: string;
  trashed: boolean;
}
export interface Piece extends PieceSummary {
  body: string;
  provenance: string[];
}

interface Hooks {
  /** Leave Free Writing (to the open project, or Home). */
  back(): void;
  /** Is a project open in the editor? */
  projectOpen(): boolean;
  /** Insert paragraphs into the open script at its cursor; false if not possible. */
  insertIntoProject(paragraphs: string[]): Promise<boolean>;
  notify(msg: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Blank-line separated paragraphs; single line breaks inside one become spaces. */
export function paragraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}

const FLOW_BLOCKED_KEYS = new Set(["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function createFreeWriting(root: HTMLElement, hooks: Hooks) {
  // Scope: "all", a folder id, or "trash".
  let scope = "all";
  let current: Piece | null = null;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let timer: number | undefined;
  let flow = false;

  const search = el("input", { type: "search", placeholder: "Search all writing", id: "fw-search" });
  search.setAttribute("aria-label", "Search Free Writing");
  const back = el("button", { type: "button", id: "fw-back" }, "← Back");
  const header = el("header", { className: "fw-head" }, back, el("h1", {}, "Free Writing"), search);
  const newPiece = el("button", { type: "button", className: "primary", id: "fw-new" }, "New piece");
  const newFolder = el("button", { type: "button", id: "fw-new-folder" }, "New folder");
  const scopes = el("ul", { className: "fw-scopes", role: "list" });
  const list = el("ul", { className: "fw-list", role: "list", id: "fw-list" });
  const side = el("aside", { className: "fw-side", ariaLabel: "Free Writing list" }, el("div", { className: "fw-new" }, newPiece, newFolder), scopes, list);
  const title = el("input", { type: "text", id: "fw-title", placeholder: "Title" });
  title.setAttribute("aria-label", "Piece title");
  const body = el("textarea", { id: "fw-body", placeholder: "Start writing. Nothing here is part of a project until you copy it in." });
  body.setAttribute("aria-label", "Free writing text");
  const flowBtn = el("button", { type: "button", id: "fw-flow", title: "Turn editing off and keep writing forward (Esc to stop)" }, "Flow mode");
  flowBtn.setAttribute("aria-pressed", "false");
  const folderSel = el("select", { id: "fw-folder" });
  folderSel.setAttribute("aria-label", "Folder");
  const exportBtn = el("button", { type: "button", id: "fw-export" }, "Export .txt");
  const copyBtn = el("button", { type: "button", id: "fw-copy", title: "Insert this piece into the open script at its cursor" }, "Copy into project");
  const moveBtn = el("button", { type: "button", id: "fw-move", title: "Copy into the open script, then move this piece to Trash" }, "Move into project");
  const trashBtn = el("button", { type: "button", id: "fw-trash" }, "Trash");
  const status = el("span", { id: "fw-status" });
  // Not a live region: it changes on every keystroke. Failures are announced.
  status.setAttribute("aria-live", "off");
  const flowNote = el("p", { className: "fw-flow-note", hidden: true }, "Flow mode: editing is off. Keep writing; press Esc to edit again.");
  const msg = el("p", { className: "fw-msg", id: "fw-msg", role: "status", hidden: true });
  const say = (text: string) => {
    msg.textContent = text;
    msg.hidden = !text;
  };
  const prov = el("p", { className: "fw-prov", id: "fw-prov" });
  const tools = el("div", { className: "fw-tools" }, flowBtn, el("label", {}, "Folder ", folderSel), exportBtn, copyBtn, moveBtn, trashBtn, status);
  const empty = el("p", { className: "fw-empty" }, "Choose a piece, or start a new one.");
  const editor = el("section", { className: "fw-editor" }, tools, flowNote, title, body, prov);
  const mainMsg = msg;
  const main = el("section", { className: "fw-main", ariaLabel: "Piece" }, mainMsg, empty, editor);
  root.replaceChildren(header, el("div", { className: "fw-body" }, side, main));

  let folders: Folder[] = [];

  function showStatus(text: string) {
    status.textContent = text;
  }

  async function refreshList() {
    const q = search.value.trim();
    const r = await invoke<{ folders: Folder[]; pieces: PieceSummary[] }>("fw_list", { folder: scope === "all" || scope === "trash" ? null : scope, trash: scope === "trash", query: q || null });
    folders = r.folders;
    const scopeItem = (id: string, label: string) => {
      const b = el("button", { type: "button", className: scope === id && !q ? "current" : "" }, label);
      b.dataset.scope = id;
      b.addEventListener("click", async () => {
        search.value = "";
        scope = id;
        await refreshList();
      });
      return el("li", {}, b);
    };
    scopes.replaceChildren(scopeItem("all", "All writing"), ...folders.map((f) => scopeItem(f.id, f.name)), scopeItem("trash", "Trash"));
    list.replaceChildren(
      ...(r.pieces.length
        ? r.pieces.map((p) => {
            const b = el("button", { type: "button", className: current?.id === p.id ? "current" : "" }, el("strong", {}, p.title), el("span", {}, p.preview || "(empty)"), el("small", {}, when(p.modified)));
            b.dataset.piece = p.id;
            b.addEventListener("click", () => void openPiece(p.id));
            return el("li", {}, b);
          })
        : [el("li", { className: "fw-none" }, q ? "No matches." : scope === "trash" ? "Trash is empty." : "Nothing here yet.")]),
    );
    folderSel.replaceChildren(new Option("No folder", ""), ...folders.map((f) => new Option(f.name, f.id)));
    if (current) folderSel.value = current.folder_id ?? "";
    root.dataset.loaded = "1";
  }

  function render() {
    const has = !!current;
    empty.hidden = has;
    editor.hidden = !has;
    if (!current) return;
    title.value = current.title;
    body.value = current.body;
    folderSel.value = current.folder_id ?? "";
    trashBtn.textContent = current.trashed ? "Restore" : "Trash";
    const project = hooks.projectOpen();
    copyBtn.disabled = moveBtn.disabled = !project || current.trashed;
    copyBtn.title = project ? "Insert this piece into the open script at its cursor" : "Open a project first";
    prov.textContent = current.provenance.length ? `History: ${current.provenance.join("; ")}` : "";
    showStatus(`Saved ${when(current.modified)}`);
  }

  /** Write pending text now. */
  async function flush(): Promise<void> {
    window.clearTimeout(timer);
    while (saving) await saving;
    if (!current || !dirty) return;
    const piece = current;
    const t = title.value;
    const b = body.value;
    dirty = false;
    saving = (async () => {
      try {
        piece.modified = await invoke<string>("fw_save", { id: piece.id, title: t, body: b });
        piece.title = t.trim() || "Untitled";
        piece.body = b;
        showStatus(`Saved ${when(piece.modified)}`);
      } catch (e) {
        dirty = true;
        showStatus(`NOT SAVED: ${e}`);
        announce(`Free Writing not saved: ${e}`, true);
      }
    })();
    try {
      await saving;
    } finally {
      saving = null;
    }
  }

  function changed() {
    dirty = true;
    showStatus("Unsaved changes");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush().then(refreshList), 500);
  }

  async function openPiece(id: string) {
    await flush();
    setFlow(false);
    current = await invoke<Piece>("fw_get", { id });
    render();
    await refreshList();
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
  }

  async function create() {
    await flush();
    const folder = scope !== "all" && scope !== "trash" ? scope : null;
    current = await invoke<Piece>("fw_create", { folderId: folder, title: "" });
    if (scope === "trash") scope = "all";
    render();
    await refreshList();
    title.focus();
    title.select();
  }

  // --- Flow mode -------------------------------------------------------------------
  const toEnd = () => body.setSelectionRange(body.value.length, body.value.length);

  function setFlow(on: boolean) {
    flow = on && !!current && !current.trashed;
    root.dataset.flow = flow ? "on" : "off";
    flowBtn.setAttribute("aria-pressed", String(flow));
    flowBtn.textContent = flow ? "Editing off (Esc)" : "Flow mode";
    flowNote.hidden = !flow;
    body.spellcheck = !flow;
    title.readOnly = flow;
    if (flow) {
      body.focus();
      toEnd();
    }
  }

  body.addEventListener("keydown", (e) => {
    if (!flow) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setFlow(false);
      return;
    }
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (FLOW_BLOCKED_KEYS.has(e.key) || (mod && ["z", "y", "x", "a"].includes(e.key.toLowerCase()))) {
      e.preventDefault();
      return;
    }
    // Anything that types goes at the end.
    if (e.key.length === 1 || e.key === "Enter") toEnd();
  });
  body.addEventListener("beforeinput", (e) => {
    if (!flow) return;
    const t = (e as InputEvent).inputType;
    if (t.startsWith("delete") || t.startsWith("history") || t === "insertReplacementText" || t === "insertFromDrop") e.preventDefault();
  });
  body.addEventListener("paste", (e) => {
    if (!flow) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    body.setRangeText(text, body.value.length, body.value.length, "end");
    changed();
  });
  for (const ev of ["mousedown", "click", "select", "focus"]) {
    body.addEventListener(ev, (e) => {
      if (!flow) return;
      if (ev === "mousedown") {
        e.preventDefault();
        body.focus();
      }
      toEnd();
    });
  }

  // --- Wiring ----------------------------------------------------------------------
  title.addEventListener("input", changed);
  body.addEventListener("input", changed);
  title.addEventListener("blur", () => void flush().then(refreshList));
  body.addEventListener("blur", () => void flush());
  newPiece.addEventListener("click", () => void create());
  newFolder.addEventListener("click", async () => {
    const f = await invoke<Folder>("fw_create_folder", { name: "New folder" });
    scope = f.id;
    await refreshList();
    say("Folder created. Double-click it to rename.");
  });
  scopes.addEventListener("dblclick", async (e) => {
    const b = (e.target as HTMLElement).closest("button[data-scope]") as HTMLButtonElement | null;
    const id = b?.dataset.scope;
    if (!id || id === "all" || id === "trash") return;
    const input = el("input", { type: "text", value: b.textContent ?? "" });
    input.setAttribute("aria-label", "Folder name");
    b.replaceWith(input);
    input.focus();
    input.select();
    const done = async () => {
      if (input.value.trim()) await invoke("fw_rename_folder", { id, name: input.value });
      await refreshList();
    };
    input.addEventListener("keydown", (k) => {
      if (k.key === "Enter") void done();
      if (k.key === "Escape") void refreshList();
    });
    input.addEventListener("blur", () => void done());
  });
  flowBtn.addEventListener("click", () => setFlow(!flow));
  folderSel.addEventListener("change", async () => {
    if (!current) return;
    await invoke("fw_move", { id: current.id, folderId: folderSel.value || null });
    current.folder_id = folderSel.value || null;
    await refreshList();
  });
  trashBtn.addEventListener("click", async () => {
    if (!current) return;
    await flush();
    await invoke("fw_trash", { id: current.id, trashed: !current.trashed });
    current.trashed = !current.trashed;
    say(current.trashed ? `"${current.title}" moved to Trash. Nothing is deleted; Restore brings it back.` : `"${current.title}" restored.`);
    render();
    await refreshList();
  });
  exportBtn.addEventListener("click", async () => {
    if (!current) return;
    await flush();
    const path = await saveDialog({ defaultPath: `${current.title}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] });
    if (path) await exportTo(path);
  });

  async function exportTo(path: string): Promise<string> {
    await flush();
    const written = await invoke<string>("fw_export", { id: current!.id, path });
    say(`Exported to ${written}.`);
    return written;
  }

  async function intoProject(moved: boolean): Promise<boolean> {
    if (!current || !hooks.projectOpen()) return false;
    await flush();
    const piece = current;
    const paras = paragraphs(piece.body);
    if (!paras.length) {
      say("This piece is empty.");
      return false;
    }
    hooks.back();
    if (!(await hooks.insertIntoProject(paras))) return false;
    await invoke("fw_note_copied", { id: piece.id, moved });
    hooks.notify(
      moved
        ? `Moved "${piece.title}" into the script at the cursor (${paras.length} paragraphs). The piece is in Free Writing's Trash; Undo removes the text from the script.`
        : `Copied "${piece.title}" into the script at the cursor (${paras.length} paragraphs). The piece stays in Free Writing; Undo removes the copy.`,
    );
    current = null;
    return true;
  }
  copyBtn.addEventListener("click", () => void intoProject(false));
  moveBtn.addEventListener("click", () => void intoProject(true));

  back.addEventListener("click", async () => {
    await flush();
    setFlow(false);
    hooks.back();
  });
  let searchTimer: number | undefined;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void refreshList(), 150);
  });

  /** Show the view (keeps the current piece). */
  async function show() {
    root.dataset.loaded = "";
    render();
    try {
      await refreshList();
    } catch (e) {
      say(`Free Writing could not open: ${e}`);
      root.dataset.loaded = "1";
    }
  }

  return {
    show,
    flush,
    create,
    openPiece,
    setFlow,
    exportTo,
    intoProject,
    refreshList,
    get current() {
      return current;
    },
    get flow() {
      return flow;
    },
  };
}
