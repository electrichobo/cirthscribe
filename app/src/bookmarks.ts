// View > Go To > Bookmarks… and Add Bookmark Here… (M3 step 9): named
// places in the scripts, on a block by its stable id, so a bookmark follows
// its text when scenes move. Choosing one opens its script there.

import { announce } from "./a11y";

export interface Bookmark {
  id: string;
  name: string;
  document_id: string;
  block_id: string;
}
export type BookmarkOp = { PutBookmark: Bookmark } | { DeleteBookmark: string };

export function createBookmarks(hooks: {
  list: () => Promise<{ bookmarks: Bookmark[]; titles: Record<string, string> }>;
  here: () => { document_id: string; block_id: string; text: string } | null;
  apply: (op: BookmarkOp) => Promise<boolean>;
  go: (b: Bookmark) => void;
  newId: () => string;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "bookmarks-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-labelledby", "bookmarks-title");
  const h = document.createElement("h2");
  h.id = "bookmarks-title";
  h.textContent = "Bookmarks";
  const form = document.createElement("form");
  form.className = "tree-rename";
  const name = document.createElement("input");
  name.type = "text";
  name.id = "bookmark-name";
  name.placeholder = "Name for a bookmark at the caret";
  name.setAttribute("aria-label", "Bookmark name");
  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.textContent = "Add here";
  form.append(name, addBtn);
  const list = document.createElement("ul");
  list.id = "bookmarks-list";
  list.className = "bible-evidence";
  const status = document.createElement("p");
  status.className = "form-note";
  status.setAttribute("role", "status");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(close);
  dialog.append(h, form, list, status, actions);
  document.body.append(dialog);

  async function draw() {
    const { bookmarks, titles } = await hooks.list();
    list.replaceChildren();
    for (const b of bookmarks) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "bible-go";
      go.textContent = `${b.name} · ${titles[b.document_id] ?? "a script"}`;
      go.addEventListener("click", () => {
        dialog.close();
        hooks.go(b);
      });
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "timeline-unlink";
      rm.textContent = "Remove";
      rm.setAttribute("aria-label", `Remove bookmark ${b.name}`);
      rm.addEventListener("click", async () => {
        if (await hooks.apply({ DeleteBookmark: b.id })) await draw();
      });
      const li = document.createElement("li");
      li.append(go, " ", rm);
      list.append(li);
    }
    if (!bookmarks.length) list.append(Object.assign(document.createElement("li"), { className: "form-note", textContent: "No bookmarks yet." }));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const at = hooks.here();
    if (!at) return void (status.textContent = "Put the caret in the script first.");
    const n = name.value.trim() || at.text.slice(0, 40) || "Bookmark";
    if (await hooks.apply({ PutBookmark: { id: hooks.newId(), name: n, document_id: at.document_id, block_id: at.block_id } })) {
      name.value = "";
      status.textContent = `Bookmark "${n}" added`;
      announce(status.textContent);
      await draw();
    }
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open(adding = false) {
      status.textContent = "";
      await draw();
      if (!dialog.open) dialog.showModal();
      (adding ? name : (list.querySelector<HTMLElement>("button") ?? name)).focus();
    },
    close: () => dialog.close(),
  };
}
