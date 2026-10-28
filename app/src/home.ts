// Home: the project library shown at startup and after closing a project
// (modelled on a project manager page). Lists the projects in the app's
// library folder and recently opened files elsewhere, creates new ones,
// opens files through the system Open dialog, and opens the samples.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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
  openFreeWriting(): void;
  openAbout(): void;
  createProject(title: string): Promise<boolean>;
}

const SAMPLES = [
  { name: "unicode-marks", title: "Unicode and marks", about: "Accents, emoji, CJK and right-to-left text; bold, italic, underline." },
  { name: "page-boundaries", title: "Page boundary cases", about: "Long speeches, MORE and CONT'D, dual dialogue, forced breaks." },
  { name: "long-120", title: "The Tide Ledger", about: "A 127-page synthetic script for speed and pagination checks." },
];

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

  const samples = el("ul", { className: "home-samples" });
  for (const s of SAMPLES) {
    const b = el("button", { type: "button", className: "sample" }, el("strong", {}, s.title), el("span", {}, s.about));
    b.dataset.sample = s.name;
    b.addEventListener("click", () => void guard(() => actions.openSample(s.name)));
    samples.append(el("li", {}, b));
  }

  const openBtn = el("button", { type: "button", id: "open-file" }, "Open a project file…");
  openBtn.addEventListener("click", () =>
    void guard(async () => {
      const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Kolbítar project", extensions: ["cirth"] }] });
      return typeof path === "string" ? actions.openPath(path) : false;
    }),
  );
  const freeBtn = el("button", { type: "button", id: "open-free" }, "Free Writing");
  freeBtn.title = "Notes and brain dumps outside any project";
  freeBtn.addEventListener("click", () => actions.openFreeWriting());
  const aboutBtn = el("button", { type: "button", id: "open-about", className: "link" }, "About Kolbítar and licences");
  aboutBtn.addEventListener("click", () => actions.openAbout());
  const side = el("aside", { className: "home-side", ariaLabel: "New, open and samples" }, form, el("h2", {}, "Open"), openBtn, freeBtn, el("h2", {}, "Samples"), samples, el("p", { className: "home-note" }, "New projects are created in the app's library folder. Use Save As in the editor to keep a project anywhere else."), aboutBtn);
  const main = el("section", { className: "home-main", ariaLabel: "Projects" }, el("div", { className: "home-head" }, el("h2", {}, "Projects"), count), msg, grid);
  root.replaceChildren(el("header", { className: "home-brand" }, el("h1", {}, "Kolbítar"), el("span", {}, "Project library")), el("div", { className: "home-body" }, side, main));

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
    const title = p.title || p.name;
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
      el("div", { className: "thumb", ariaHidden: "true" }, el("span", {}, initials || "?")),
      el(
        "div",
        { className: "meta" },
        el("strong", {}, title),
        el("span", { className: "file", title: p.path }, p.location === "library" ? `${p.name}.cirth` : p.path),
        el("span", {}, p.error ? p.error : `${plural(p.scenes, "scene")} · ${plural(p.blocks, "block")}`),
        el("span", {}, `Modified ${when(p.modified_ms)}${p.backups ? ` · ${plural(p.backups, "backup")}` : ""}`),
        badges,
      ),
    );
    b.dataset.project = p.name;
    b.dataset.path = p.path;
    b.disabled = !!p.error || p.missing;
    b.addEventListener("click", () => void guard(() => actions.openPath(p.path)));
    const item = el("div", { role: "listitem", className: "project-item" }, b);
    if (p.backups && !p.missing) {
      const bk = el("button", { type: "button", className: "forget" }, `Backups (${p.backups})…`);
      bk.dataset.backups = p.name;
      bk.addEventListener("click", () => void showBackups(p));
      item.append(bk);
    }
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
    grid.replaceChildren(...(list.length ? list.map(card) : [el("p", { className: "home-empty" }, "No projects yet. Create one, or open a sample.")]));
    titleInput.focus();
    root.dataset.loaded = "1";
    return list;
  }

  return { refresh, message };
}
