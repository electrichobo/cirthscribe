// View > Tools > Overview… (M3 step 6): a zoomed-out, read-only map of the
// script or of every script in the project. Each scene is a block whose
// width is its length (eighths of a page, an estimate), coloured by its
// label or by the act its card sits in. Choosing a block goes to that scene,
// opening another episode if need be. The list view shows the same data as
// text (number, heading, page, length, label, act).
//
// Keyboard: arrow keys move between blocks (one Tab stop), Enter goes there,
// Escape closes.

import { announce } from "./a11y";
import { eighths } from "./views";

export interface OverviewScene {
  sceneId: string;
  heading: string;
  number?: string;
  page: string;
  eighths: number;
  label: string;
  act: { id: string; title: string; index: number } | null;
}
export interface OverviewDoc {
  id: string;
  title: string;
  current: boolean;
  scenes: OverviewScene[];
}
export interface OverviewData {
  docs: OverviewDoc[];
  labelNames: [string, string][];
  currentScene: string | null;
}

/** Pixels per eighth of a page: a page is 64 px wide. */
const UNIT = 8;

export function createOverview(hooks: { data: (project: boolean) => Promise<OverviewData>; go: (documentId: string, sceneId: string) => void }) {
  const dialog = document.createElement("dialog");
  dialog.id = "overview-dialog";
  dialog.className = "about overview";
  dialog.setAttribute("aria-labelledby", "overview-title");
  const h = document.createElement("h2");
  h.id = "overview-title";
  h.textContent = "Overview";
  const tools = document.createElement("div");
  tools.className = "overview-tools";
  const scope = document.createElement("select");
  scope.id = "overview-scope";
  scope.setAttribute("aria-label", "Scope");
  scope.append(new Option("This script", "doc"), new Option("Project", "project"));
  const colour = document.createElement("select");
  colour.id = "overview-colour";
  colour.setAttribute("aria-label", "Colour blocks by");
  colour.append(new Option("Colour by label", "label"), new Option("Colour by act", "act"), new Option("No colour", "none"));
  const asList = document.createElement("button");
  asList.type = "button";
  asList.id = "overview-list-toggle";
  asList.setAttribute("aria-pressed", "false");
  asList.textContent = "Show as list";
  const note = document.createElement("span");
  note.className = "form-note overview-note";
  note.textContent = "Widths are lengths in eighths of a page (an estimate).";
  tools.append(scope, colour, asList, note);
  const body = document.createElement("div");
  body.className = "overview-body";
  const close = document.createElement("button");
  close.type = "button";
  close.id = "overview-close";
  close.textContent = "Close";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(close);
  dialog.append(h, tools, body, actions);
  document.body.append(dialog);
  let data: OverviewData | null = null;
  let list = false;

  const go = (doc: string, scene: string) => {
    dialog.close();
    hooks.go(doc, scene);
  };

  function draw() {
    if (!data) return;
    const names = new Map(data.labelNames);
    const by = colour.value;
    body.replaceChildren();
    const blocks: HTMLButtonElement[] = [];
    for (const d of data.docs) {
      const total = d.scenes.reduce((n, s) => n + s.eighths, 0);
      const head = document.createElement("h3");
      head.className = "overview-doc";
      head.textContent = `${d.title || "(untitled)"} · ${d.scenes.length} scene${d.scenes.length === 1 ? "" : "s"} · scenes add up to ≈ ${eighths(total)} pages (not counting space left at page breaks)`;
      body.append(head);
      if (list) {
        const table = document.createElement("table");
        table.className = "overview-table";
        const hr = table.createTHead().insertRow();
        for (const t of ["#", "Scene", "Page", "Length", "Label", "Act"]) hr.append(Object.assign(document.createElement("th"), { textContent: t, scope: "col" }));
        const tb = table.createTBody();
        d.scenes.forEach((s, i) => {
          const tr = tb.insertRow();
          tr.insertCell().textContent = s.number ?? String(i + 1);
          const b = document.createElement("button");
          b.type = "button";
          b.className = "overview-go";
          b.textContent = s.heading || "(empty heading)";
          b.addEventListener("click", () => go(d.id, s.sceneId));
          tr.insertCell().append(b);
          tr.insertCell().textContent = s.page;
          tr.insertCell().textContent = eighths(s.eighths);
          tr.insertCell().textContent = s.label ? (names.get(s.label) ?? s.label) : "";
          tr.insertCell().textContent = s.act?.title ?? "";
        });
        body.append(table);
        continue;
      }
      const row = document.createElement("div");
      row.className = "overview-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", d.title || "Script");
      d.scenes.forEach((s, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "overview-block";
        b.dataset.scene = s.sceneId;
        b.dataset.doc = d.id;
        b.style.width = `${Math.max(UNIT, s.eighths * UNIT)}px`;
        const tint = by === "label" && s.label ? `var(--label-${s.label})` : by === "act" && s.act ? `var(--act-${s.act.index % 6})` : "";
        if (tint) b.style.setProperty("--tint", tint);
        if (s.sceneId === data!.currentScene && d.current) b.classList.add("current");
        b.textContent = s.number ? `${s.number} ${s.heading}` : s.heading;
        const label = s.label ? names.get(s.label) ?? s.label : "";
        b.title = [s.heading || "(empty heading)", `page ${s.page}, ${eighths(s.eighths)} (estimate)`, label && `label ${label}`, s.act && s.act.title].filter(Boolean).join(" · ");
        b.setAttribute("aria-label", `Scene ${s.number ?? i + 1}: ${b.title}`);
        b.tabIndex = -1;
        b.addEventListener("click", () => go(d.id, s.sceneId));
        row.append(b);
        blocks.push(b);
      });
      body.append(row);
    }
    // One Tab stop: the current scene's block (or the first).
    const start = blocks.find((b) => b.classList.contains("current")) ?? blocks[0];
    if (start) start.tabIndex = 0;
    body.onkeydown = (e) => {
      const at = blocks.indexOf(e.target as HTMLButtonElement);
      if (at < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      const to = blocks[Math.max(0, Math.min(blocks.length - 1, at + step))] ?? blocks[at];
      blocks[at].tabIndex = -1;
      to.tabIndex = 0;
      to.focus();
    };
  }

  async function load() {
    data = await hooks.data(scope.value === "project");
    draw();
  }

  scope.addEventListener("change", () => void load());
  colour.addEventListener("change", draw);
  asList.addEventListener("click", () => {
    list = !list;
    asList.setAttribute("aria-pressed", String(list));
    asList.textContent = list ? "Show as map" : "Show as list";
    draw();
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open() {
      await load();
      if (!dialog.open) dialog.showModal();
      (body.querySelector<HTMLElement>('.overview-block[tabindex="0"]') ?? body.querySelector<HTMLElement>("button") ?? close).focus();
      announce("Overview: arrow keys move between scenes, Enter goes there");
    },
    close: () => dialog.close(),
  };
}
