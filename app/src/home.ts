// Home: the project library shown at startup and after closing a project
// (modelled on a project manager page). Lists the projects in the app's
// library folder and recently opened files elsewhere, creates new ones,
// opens files through the system Open dialog, and opens the samples.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { announce } from "./a11y";

export interface ProjectEntry {
  name: string;
  path: string;
  location: "library" | "elsewhere";
  missing: boolean;
  title: string;
  sample: boolean;
  modified_ms: number;
  blocks: number;
  scenes: number;
  saved_version: number;
  recoverable: boolean;
  backups: number;
  schema: number;
  older_format: boolean;
  open: boolean;
  error: string | null;
  created_ms: number;
  /** The name on the card, if the writer gave the project one (not the script's title). */
  home_title: string | null;
  /** The card's picture (a data URL), if chosen. */
  cover: string | null;
}

interface BackupItem {
  path: string;
  kind: "backup" | "pre-upgrade";
  created_s: number;
  saved_version: number;
  title: string;
  blocks: number;
}

interface Actions {
  openPath(path: string): Promise<boolean>;
  restoreBackup(path: string): Promise<boolean>;
  openSample(name: string): Promise<boolean>;
  /** Open the project and its Export dialog. */
  exportProject(path: string): Promise<boolean>;
  /** File > Import…: a Fountain, Final Draft or plain-text script becomes a new project. */
  importScript(): Promise<boolean>;
  openFreeWriting(): void;
  openAbout(): void;
  createProject(title: string): Promise<boolean>;
}

// Samples shown on Home. The other fixtures (unicode-marks, page-boundaries,
// long-120) stay for tests but are not offered to users.
const SAMPLES = [{ name: "high-council", title: "The Obsidian Seal", about: "Untitled Fantasy Feature" }];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

function when(ms: number): string {
  if (!ms) return "unknown date";
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 1 && d.getDate() === new Date().getDate()) return `Today, ${time}`;
  if (days < 2) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export function createHome(root: HTMLElement, actions: Actions) {
  const msg = el("p", { className: "home-message", role: "alert", hidden: true });
  const grid = el("div", { className: "home-grid", role: "list" });
  const count = el("span", { className: "home-count" });
  const titleInput = el("input", { type: "text", placeholder: "Project title", maxLength: 120, id: "new-title" });
  titleInput.setAttribute("aria-label", "New project title");
  const create = el("button", { type: "submit", className: "primary" }, "Create project");
  const form = el("form", { className: "home-new" }, el("h2", {}, "New project"), titleInput, create);
  let busy = false;
  const guard = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    busy = true;
    message(null);
    try {
      await fn();
    } finally {
      busy = false;
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void guard(async () => {
      const ok = await actions.createProject(titleInput.value);
      if (ok) titleInput.value = "";
      return ok;
    });
  });

  /** A sample not yet in the library, as a card in the Projects grid. Opening it
   *  copies it into the library, where its own card (with a Sample badge) replaces this one. */
  function sampleCard(smp: (typeof SAMPLES)[number]): HTMLElement {
    const initials = smp.title.split(/\s+/).filter((w) => !/^the$/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
    const b = el(
      "button",
      { type: "button", className: "project", title: `Open the sample ${smp.title}` },
      el("div", { className: "thumb", ariaHidden: "true" }, el("span", {}, initials)),
      el("div", { className: "meta" }, el("strong", {}, smp.title), el("span", {}, smp.about), el("div", { className: "badges" }, el("span", { className: "tag" }, "Sample"))),
    );
    b.dataset.sample = smp.name;
    b.addEventListener("click", () => void guard(() => actions.openSample(smp.name)));
    return el("div", { role: "listitem", className: "project-item" }, b);
  }

  const openBtn = el("button", { type: "button", id: "open-file" }, "Open a project file…");
  openBtn.addEventListener("click", () =>
    void guard(async () => {
      const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Kolbítar project", extensions: ["cirth"] }] });
      return typeof path === "string" ? actions.openPath(path) : false;
    }),
  );
  const importBtn = el("button", { type: "button", id: "import-file", title: "Fountain, Final Draft (.fdx) or plain text: it becomes a new project" }, "Import a script…");
  importBtn.addEventListener("click", () => void guard(() => actions.importScript()));
  const freeBtn = el("button", { type: "button", id: "open-free" }, "Free Writing");
  freeBtn.title = "Notes and brain dumps outside any project";
  freeBtn.addEventListener("click", () => actions.openFreeWriting());
  const aboutBtn = el("button", { type: "button", id: "open-about", className: "link" }, "About Kolbítar and licences");
  aboutBtn.addEventListener("click", () => actions.openAbout());
  const side = el("aside", { className: "home-side", ariaLabel: "New and open" }, form, el("h2", {}, "Open"), openBtn, importBtn, freeBtn, el("p", { className: "home-note" }, "New projects are created in the app's library folder. Use Save As in the editor to keep a project anywhere else."), aboutBtn);
  // Sorting, remembered per user (a convenience).
  const SORT_KEY = "cirth.homeSort";
  const sort = el("select", { id: "home-sort", className: "home-sort" });
  sort.setAttribute("aria-label", "Sort projects");
  for (const [v, label] of [
    ["modified-desc", "Last modified, newest first"],
    ["modified-asc", "Last modified, oldest first"],
    ["created-desc", "Created, newest first"],
    ["created-asc", "Created, oldest first"],
    ["name-asc", "Name, A to Z"],
    ["name-desc", "Name, Z to A"],
  ])
    sort.append(new Option(label, v));
  try {
    sort.value = localStorage.getItem(SORT_KEY) ?? "modified-desc";
  } catch {
    sort.value = "modified-desc";
  }
  if (!sort.value) sort.value = "modified-desc";
  sort.addEventListener("change", () => {
    try {
      localStorage.setItem(SORT_KEY, sort.value);
    } catch {
      // this session only
    }
    void refresh();
  });
  const shownTitle = (p: ProjectEntry) => p.home_title || p.title || p.name;
  function sorted(list: ProjectEntry[]): ProjectEntry[] {
    const [by, dir] = sort.value.split("-");
    const sign = dir === "asc" ? 1 : -1;
    const key = (p: ProjectEntry): number | string => (by === "name" ? shownTitle(p).toLocaleLowerCase() : by === "created" ? p.created_ms : p.modified_ms);
    return [...list].sort((a, b) => {
      const ka = key(a), kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * sign;
    });
  }

  // A project's menu: right-click its card, the context-menu key, or its ⋯ button.
  const menu = el("ul", { id: "project-menu", className: "project-menu" });
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  function closeMenu(focusBack?: HTMLElement) {
    menu.hidden = true;
    focusBack?.focus();
  }
  function openMenu(p: ProjectEntry, at: { x: number; y: number }, from: HTMLElement) {
    const items: [string, string, () => void | Promise<unknown>][] = [];
    if (!p.missing && !p.error) items.push(["open", "Open", () => guard(() => actions.openPath(p.path))]);
    items.push(["rename", "Rename…", () => rename(p)]);
    items.push(["cover", "Change Picture…", () => chooseCover(p)]);
    if (p.cover) items.push(["cover-remove", "Remove Picture", () => setCover(p, null)]);
    if (!p.missing && !p.error) items.push(["export", "Export…", () => guard(() => actions.exportProject(p.path))]);
    if (p.backups && !p.missing) items.push(["backups", `Backups (${p.backups})…`, () => showBackups(p)]);
    if (p.location === "elsewhere") items.push(["forget", "Remove from List", async () => (await invoke("forget_recent", { path: p.path }), refresh())]);
    menu.replaceChildren(
      ...items.map(([id, label, run]) => {
        const li = el("li", { tabIndex: -1, className: "project-menu-item" }, label);
        li.setAttribute("role", "menuitem");
        li.dataset.menu = id;
        if (id === "backups") li.dataset.backups = p.name;
        li.addEventListener("click", () => {
          closeMenu();
          void run();
        });
        return li;
      }),
    );
    menu.hidden = false;
    const host = root.getBoundingClientRect();
    menu.style.left = `${Math.min(at.x - host.left, host.width - 220)}px`;
    menu.style.top = `${at.y - host.top}px`;
    (menu.firstElementChild as HTMLElement | null)?.focus();
    menu.onkeydown = (e) => {
      const lis = [...menu.querySelectorAll<HTMLElement>("li")];
      const i = lis.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        lis[(i + (e.key === "ArrowDown" ? 1 : lis.length - 1)) % lis.length]?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        (document.activeElement as HTMLElement).click();
      } else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        closeMenu(from);
      }
    };
  }
  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
  });

  // Rename: a small dialog with the name field (empty goes back to the script's title).
  const renameDialog = el("dialog", { className: "about form-dialog", id: "rename-dialog" });
  renameDialog.setAttribute("aria-label", "Rename project");
  async function rename(p: ProjectEntry) {
    const input = el("input", { type: "text", id: "rename-input", value: p.home_title ?? "", placeholder: p.title || p.name });
    input.setAttribute("aria-label", "Project name on Home");
    const save = el("button", { type: "submit", id: "rename-save", className: "primary" }, "Rename");
    const cancel = el("button", { type: "button", id: "rename-cancel" }, "Cancel");
    const form = el(
      "form",
      { method: "dialog" },
      el("h2", { id: "rename-title" }, "Rename project"),
      el("p", { className: "form-note" }, `The name on its card. It need not be the script's title ("${p.title || p.name}"); leave it empty to use that again.`),
      input,
      el("div", { className: "dialog-actions" }, cancel, save),
    );
    cancel.addEventListener("click", () => renameDialog.close());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await invoke("set_home_title", { path: p.path, title: input.value.trim() || null });
        renameDialog.close();
        await refresh();
        announce(`Renamed to ${input.value.trim() || p.title}`);
      } catch (err) {
        message(`Could not rename: ${err}`);
      }
    });
    renameDialog.replaceChildren(form);
    renameDialog.showModal();
    input.select();
  }
  async function setCover(p: ProjectEntry, source: string | null) {
    try {
      await invoke("set_home_cover", { path: p.path, source });
      await refresh();
      announce(source ? "Picture changed" : "Picture removed");
    } catch (e) {
      message(`Could not change the picture: ${e}`);
    }
  }
  async function chooseCover(p: ProjectEntry) {
    const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Picture", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    if (typeof path === "string") await setCover(p, path);
  }

  const main = el("section", { className: "home-main", ariaLabel: "Projects" }, el("div", { className: "home-head" }, el("h2", {}, "Projects"), count, sort), msg, grid, menu, renameDialog);
  root.replaceChildren(el("header", { className: "home-brand" }, el("h1", {}, el("span", { className: "wordmark" }, "Kolbítar")), el("span", {}, "Project library")), el("div", { className: "home-body" }, side, main));

  // Backups dialog: lists one project's backups; each can be restored as a copy.
  const backupsDialog = el("dialog", { className: "backups", id: "backups-dialog" });
  backupsDialog.setAttribute("aria-label", "Backups");
  root.append(backupsDialog);

  async function showBackups(p: ProjectEntry) {
    let items: BackupItem[] = [];
    try {
      items = await invoke<BackupItem[]>("list_backups", { name: p.name });
    } catch (e) {
      message(`Could not list backups: ${e}`);
      return;
    }
    const close = el("button", { type: "button" }, "Close");
    close.addEventListener("click", () => backupsDialog.close());
    const rows = items.map((b) => {
      const restore = el("button", { type: "button" }, "Restore as a copy");
      restore.dataset.restore = b.path;
      restore.addEventListener("click", () =>
        void guard(async () => {
          backupsDialog.close();
          return actions.restoreBackup(b.path);
        }),
      );
      const when = b.created_s ? new Date(b.created_s * 1000).toLocaleString() : "unknown time";
      const what = b.kind === "pre-upgrade" ? "Original before a format upgrade" : `Saved version ${b.saved_version}`;
      return el("li", {}, el("div", {}, el("strong", {}, when), el("span", {}, ` · ${what} · ${plural(b.blocks, "block")}`)), restore);
    });
    backupsDialog.replaceChildren(
      el("h2", {}, `Backups of ${p.title || p.name}`),
      el("p", { className: "home-note" }, "Restoring opens the backup as a new project in the library. The current project and the backup are not changed."),
      items.length ? el("ul", { className: "backup-list" }, ...rows) : el("p", {}, "No backups yet."),
      el("div", { className: "dialog-actions" }, close),
    );
    backupsDialog.showModal();
  }

  function message(text: string | null) {
    msg.hidden = !text;
    msg.textContent = text ?? "";
  }

  function card(p: ProjectEntry): HTMLElement {
    const title = shownTitle(p);
    const initials = title.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
    const badges = el("div", { className: "badges" });
    if (p.sample) badges.append(el("span", { className: "tag" }, "Sample"));
    if (p.recoverable) badges.append(el("span", { className: "tag warn" }, "Unsaved work will be recovered"));
    if (p.older_format) badges.append(el("span", { className: "tag", title: "Upgraded when opened; the original file is kept as a backup" }, `Older format (v${p.schema})`));
    if (p.open) badges.append(el("span", { className: "tag" }, "Open"));
    if (p.location === "elsewhere") badges.append(el("span", { className: "tag" }, "Outside library"));
    if (p.missing) badges.append(el("span", { className: "tag bad" }, "File not found"));
    if (p.error) badges.append(el("span", { className: "tag bad" }, "Cannot read"));
    const b = el(
      "button",
      { type: "button", className: "project", title: p.error ?? `Open ${title}` },
      p.cover ? el("div", { className: "thumb has-cover", ariaHidden: "true", style: `background-image: url("${p.cover}")` }) : el("div", { className: "thumb", ariaHidden: "true" }, el("span", {}, initials || "?")),
      el(
        "div",
        { className: "meta" },
        el("strong", {}, title),
        ...(p.home_title && p.title && p.home_title !== p.title ? [el("span", { className: "script-title" }, `Script: ${p.title}`)] : []),
        el("span", { className: "file", title: p.path }, p.location === "library" ? `${p.name}.cirth` : p.path),
        el("span", {}, p.error ? p.error : `${plural(p.scenes, "scene")} · ${plural(p.blocks, "block")}`),
        el("span", {}, `Modified ${when(p.modified_ms)}${p.backups ? ` · ${plural(p.backups, "backup")}` : ""}`),
        badges,
      ),
    );
    b.dataset.project = p.name;
    b.dataset.path = p.path;
    // An opened sample keeps its sample name, so it is found the same way before and after.
    if (p.sample && p.location === "library") b.dataset.sample = p.name;
    b.disabled = !!p.error || p.missing;
    b.addEventListener("click", () => void guard(() => actions.openPath(p.path)));
    const more = el("button", { type: "button", className: "project-more", title: "Rename, picture, export, backups" }, "⋯");
    more.setAttribute("aria-label", `More for ${title}`);
    more.setAttribute("aria-haspopup", "menu");
    more.dataset.more = p.name;
    more.addEventListener("click", () => {
      const r = more.getBoundingClientRect();
      openMenu(p, { x: r.left, y: r.bottom + 4 }, more);
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(p, { x: e.clientX, y: e.clientY }, b);
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const r = b.getBoundingClientRect();
        openMenu(p, { x: r.left + 12, y: r.top + 24 }, b);
      }
    });
    const item = el("div", { role: "listitem", className: "project-item" }, b, more);
    if (p.missing) {
      // A remembered file that is gone: offer to drop it from the list.
      const forget = el("button", { type: "button", className: "forget" }, "Remove from list");
      forget.dataset.forget = p.path;
      forget.addEventListener("click", async () => {
        await invoke("forget_recent", { path: p.path });
        await refresh();
      });
      item.append(forget);
    }
    return item;
  }

  async function refresh(): Promise<ProjectEntry[]> {
    root.dataset.loaded = "";
    let list: ProjectEntry[] = [];
    try {
      list = await invoke<ProjectEntry[]>("list_projects");
    } catch (e) {
      message(`Could not read the project library: ${e}`);
    }
    count.textContent = list.length ? plural(list.length, "project") : "";
    const items = [...sorted(list).map(card), ...SAMPLES.filter((smp) => !list.some((p) => p.location === "library" && p.name === smp.name)).map(sampleCard)];
    grid.replaceChildren(...(items.length ? items : [el("p", { className: "home-empty" }, "No projects yet. Create one to start.")]));
    titleInput.focus();
    root.dataset.loaded = "1";
    return list;
  }

  return { refresh, message };
}
