// Home: the project library shown at startup and after closing a project
// (modelled on a project manager page). Lists the projects in the app's
// library folder, creates new ones, and opens the samples.

import { invoke } from "@tauri-apps/api/core";

export interface ProjectEntry {
  name: string;
  title: string;
  sample: boolean;
  modified_ms: number;
  blocks: number;
  scenes: number;
  saved_version: number;
  recoverable: boolean;
  open: boolean;
  error: string | null;
}

interface Actions {
  openProject(name: string): Promise<boolean>;
  openSample(name: string): Promise<boolean>;
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

  const side = el("aside", { className: "home-side" }, form, el("h2", {}, "Samples"), samples, el("p", { className: "home-note" }, "Opening files from elsewhere on disk is not available yet; projects live in the app's library folder."));
  const main = el("section", { className: "home-main" }, el("div", { className: "home-head" }, el("h2", {}, "Projects"), count), msg, grid);
  root.replaceChildren(el("header", { className: "home-brand" }, el("h1", {}, "CirthScribe"), el("span", {}, "Project library")), el("div", { className: "home-body" }, side, main));

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
    if (p.open) badges.append(el("span", { className: "tag" }, "Open"));
    if (p.error) badges.append(el("span", { className: "tag bad" }, "Cannot read"));
    const b = el(
      "button",
      { type: "button", className: "project", title: p.error ?? `Open ${title}` },
      el("div", { className: "thumb", ariaHidden: "true" }, el("span", {}, initials || "?")),
      el(
        "div",
        { className: "meta" },
        el("strong", {}, title),
        el("span", { className: "file" }, `${p.name}.cirth`),
        el("span", {}, p.error ? p.error : `${plural(p.scenes, "scene")} · ${plural(p.blocks, "block")}`),
        el("span", {}, `Modified ${when(p.modified_ms)}`),
        badges,
      ),
    );
    b.dataset.project = p.name;
    b.disabled = !!p.error;
    b.addEventListener("click", () => void guard(() => actions.openProject(p.name)));
    return el("div", { role: "listitem" }, b);
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
