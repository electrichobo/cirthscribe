// File > Episodes and Documents… (M3 step 2): the project's tree of folders
// (a series, a season) and documents (episodes). Choose a row, then open,
// rename or move it, or add an episode or a folder. The open document is
// marked; opening another saves first and the editor, scene list, board and
// exports follow it. Ids never change: titles are labels.
//
// Keyboard: Up/Down choose a row (one Tab stop), Enter opens a document,
// F2 renames, Alt+Up/Down move it among its siblings.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface TreeItem {
  id: string;
  kind: string;
  title: string;
  parent: string | null;
  pos: number;
  scenes: number;
}

export function createProjectTree(hooks: { current: () => string | null; openDocument: (id: string) => Promise<boolean>; changed: () => void }) {
  const dialog = document.createElement("dialog");
  dialog.id = "tree-dialog";
  dialog.className = "about";
  dialog.setAttribute("aria-labelledby", "tree-title");
  const h = document.createElement("h2");
  h.id = "tree-title";
  h.textContent = "Episodes and documents";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "Folders hold episodes or other folders (a series, a season). Opening another document saves this one first.";
  const list = document.createElement("ul");
  list.id = "tree-list";
  list.className = "tree-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", "tree-title");
  const status = document.createElement("p");
  status.id = "tree-status";
  status.className = "form-note";
  status.setAttribute("role", "status");
  const bar = document.createElement("div");
  bar.className = "dialog-actions tree-actions";
  const btn = (id: string, text: string, title: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.textContent = text;
    b.title = title;
    bar.append(b);
    return b;
  };
  const openBtn = btn("tree-open", "Open", "Open the chosen document (Enter)");
  const renameBtn = btn("tree-rename", "Rename…", "Rename the chosen item (F2)");
  const upBtn = btn("tree-up", "Move up", "Move up among its neighbours (Alt+Up)");
  const downBtn = btn("tree-down", "Move down", "Move down among its neighbours (Alt+Down)");
  const into = document.createElement("select");
  into.id = "tree-into";
  into.setAttribute("aria-label", "Move the chosen item into a folder");
  bar.append(into);
  const newEp = btn("tree-new-episode", "New episode", "A new episode in the chosen folder (or beside the chosen document)");
  const newFolder = btn("tree-new-folder", "New folder", "A new folder (a series or a season) in the chosen folder");
  const close = btn("tree-close", "Close", "");
  const rename = document.createElement("form");
  rename.className = "tree-rename";
  rename.hidden = true;
  const renameInput = document.createElement("input");
  renameInput.type = "text";
  renameInput.id = "tree-rename-input";
  renameInput.setAttribute("aria-label", "New title");
  const renameSave = document.createElement("button");
  renameSave.type = "submit";
  renameSave.textContent = "Save title";
  rename.append(renameInput, renameSave);
  dialog.append(h, note, list, rename, status, bar);
  document.body.append(dialog);

  let items: TreeItem[] = [];
  let chosen: string | null = null;
  let renaming: { id: string; kind: "rename" | "episode" | "folder"; parent: string | null } | null = null;

  const children = (parent: string | null) => items.filter((i) => i.parent === parent).sort((a, b) => a.pos - b.pos);
  const item = (id: string | null) => items.find((i) => i.id === id);
  /** Rows in reading order with their depth. */
  function rows(): { it: TreeItem; depth: number }[] {
    const out: { it: TreeItem; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const it of children(parent)) {
        out.push({ it, depth });
        if (it.kind === "folder") walk(it.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }
  /** The folder a new item goes into: the chosen folder, or the chosen document's folder. */
  const targetFolder = () => {
    const c = item(chosen);
    return c ? (c.kind === "folder" ? c.id : c.parent) : null;
  };

  async function load() {
    items = await invoke<TreeItem[]>("project_tree");
    if (!item(chosen)) chosen = hooks.current();
    draw();
  }

  function draw() {
    const current = hooks.current();
    list.replaceChildren();
    for (const { it, depth } of rows()) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.id = it.id;
      li.className = `tree-row ${it.kind === "folder" ? "folder" : "doc"}`;
      li.style.paddingLeft = `${8 + depth * 18}px`;
      li.tabIndex = it.id === chosen ? 0 : -1;
      li.setAttribute("aria-selected", String(it.id === chosen));
      const label = it.kind === "folder" ? `▸ ${it.title}` : it.title;
      const meta = it.kind === "folder" ? `${children(it.id).length} item${children(it.id).length === 1 ? "" : "s"}` : `${it.scenes} scene${it.scenes === 1 ? "" : "s"}${it.id === current ? " · open" : ""}`;
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = label;
      const m = document.createElement("span");
      m.className = "tree-meta";
      m.textContent = meta;
      li.append(name, m);
      li.setAttribute("aria-label", `${it.kind === "folder" ? "Folder" : "Document"} ${it.title}, ${meta}`);
      li.addEventListener("click", () => choose(it.id));
      li.addEventListener("dblclick", () => it.kind !== "folder" && void openChosen());
      list.append(li);
    }
    const c = item(chosen);
    openBtn.disabled = !c || c.kind === "folder" || c.id === current;
    renameBtn.disabled = upBtn.disabled = downBtn.disabled = into.disabled = !c;
    if (c) {
      const sib = children(c.parent);
      const at = sib.findIndex((x) => x.id === c.id);
      upBtn.disabled = at <= 0;
      downBtn.disabled = at >= sib.length - 1;
    }
    // Folders a chosen item can move into (never itself or its own folders).
    const inside = (folder: string): boolean => {
      for (let p: string | null = folder; p; p = item(p)?.parent ?? null) if (p === chosen) return true;
      return false;
    };
    into.replaceChildren(new Option("Move into…", ""), new Option("Top level", "__top"));
    for (const { it, depth } of rows()) if (it.kind === "folder" && !inside(it.id)) into.add(new Option(`${"  ".repeat(depth)}${it.title}`, it.id));
  }

  function choose(id: string, focus = true) {
    chosen = id;
    draw();
    if (focus) list.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  async function act(f: () => Promise<unknown>, done: string) {
    try {
      await f();
      status.textContent = done;
      announce(done);
      hooks.changed();
      await load();
    } catch (e) {
      status.textContent = `Not done: ${e}`;
      announce(status.textContent, true);
    }
  }

  async function openChosen() {
    const c = item(chosen);
    if (!c || c.kind === "folder" || c.id === hooks.current()) return;
    dialog.close();
    if (await hooks.openDocument(c.id)) announce(`Opened ${c.title}`);
  }

  async function moveBy(dir: -1 | 1) {
    const c = item(chosen);
    if (!c) return;
    const sib = children(c.parent);
    const at = sib.findIndex((x) => x.id === c.id) + dir;
    if (at < 0 || at >= sib.length) return;
    await act(() => invoke("move_item", { id: c.id, parent: c.parent, index: at }), `${c.title} moved ${dir < 0 ? "up" : "down"}`);
    choose(c.id);
  }

  function startRename(kind: "rename" | "episode" | "folder") {
    const c = item(chosen);
    if (kind === "rename" && !c) return;
    renaming = { id: c?.id ?? "", kind, parent: targetFolder() };
    renameInput.value = kind === "rename" ? c!.title : kind === "episode" ? `Episode ${items.filter((i) => i.kind !== "folder").length + 1}` : "Season 1";
    renameSave.textContent = kind === "rename" ? "Save title" : kind === "episode" ? "Add episode" : "Add folder";
    rename.hidden = false;
    renameInput.focus();
    renameInput.select();
  }

  rename.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = renaming;
    if (!r) return;
    const title = renameInput.value.trim();
    if (!title) {
      status.textContent = "A title cannot be empty.";
      return;
    }
    rename.hidden = true;
    renaming = null;
    if (r.kind === "rename") void act(() => invoke("rename_item", { id: r.id, title }), `Renamed to ${title}`).then(() => choose(r.id));
    else if (r.kind === "folder")
      void act(async () => (chosen = await invoke<string>("create_folder", { title, parent: r.parent })), `Folder ${title} added`).then(() => chosen && choose(chosen));
    else void act(async () => (chosen = await invoke<string>("create_episode", { title, folder: r.parent })), `Episode ${title} added. Open it to write.`).then(() => chosen && choose(chosen));
  });
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      rename.hidden = true;
      renaming = null;
      if (chosen) choose(chosen);
    }
  });

  list.addEventListener("keydown", (e) => {
    const r = rows();
    const at = r.findIndex((x) => x.it.id === chosen);
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      void moveBy(e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = r[Math.max(0, Math.min(r.length - 1, at + (e.key === "ArrowUp" ? -1 : 1)))];
      if (next) choose(next.it.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void openChosen();
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename("rename");
    }
  });
  openBtn.addEventListener("click", () => void openChosen());
  renameBtn.addEventListener("click", () => startRename("rename"));
  upBtn.addEventListener("click", () => void moveBy(-1));
  downBtn.addEventListener("click", () => void moveBy(1));
  newEp.addEventListener("click", () => startRename("episode"));
  newFolder.addEventListener("click", () => startRename("folder"));
  into.addEventListener("change", () => {
    const c = item(chosen);
    const v = into.value;
    if (!c || !v) return;
    const parent = v === "__top" ? null : v;
    const dest = parent ? item(parent)?.title : "the top level";
    void act(() => invoke("move_item", { id: c.id, parent, index: children(parent).length }), `${c.title} moved into ${dest}`).then(() => choose(c.id));
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open() {
      chosen = hooks.current();
      rename.hidden = true;
      status.textContent = "";
      await load();
      if (!dialog.open) dialog.showModal();
      if (chosen) choose(chosen);
    },
    close: () => dialog.close(),
    load,
  };
}
