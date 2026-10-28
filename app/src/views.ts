// Navigator and board: two more views of the same scenes. They read scenes
// through a ScriptView and change the script only through MoveScene
// transactions. Cards show the beat's logline and summary, which are
// separate authored text, never a copy of the scene.
//
// A ScriptView is the editor itself in the main window, or the event bridge
// in a pop-out panel window (ADR 0004), so the same code draws both.
//
// Keyboard: each list is one Tab stop (roving tabindex). Arrows choose an
// item, Alt+arrows move it, and moves are announced to screen readers.

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { moveScene, scenesOf, type SceneInfo } from "./scenes";
import { newId, type Beat } from "./schema";
import { announce } from "./a11y";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

/** Locked scene numbers (main.ts sets them after each pagination). */
let numbers = new Map<string, { number: string; omitted: boolean }>();
export function setSceneNumbers(n: Map<string, { number: string; omitted: boolean }>) {
  numbers = n;
}

const NAV_HINT = "Up and Down arrows choose a scene, Enter goes to it, Alt+Up and Alt+Down move it, L chooses its label.";
const BOARD_HINT = "Arrow keys choose a card, Enter edits its logline (Tab goes on to the summary) and Escape returns, Alt+arrows move it. Tab reaches the chosen card's buttons.";

/** What the navigator and board need from the script. */
export interface ScriptView {
  scenes(): SceneInfo[];
  /** The scene with the caret. */
  current(): string | undefined;
  reveal(sceneId: string): void;
  /** One MoveScene transaction in the script's history. */
  move(sceneId: string, beforeSceneId: string | null): void;
  /** Store a beat (new or changed). */
  putBeat(beat: Beat): Promise<void>;
  /** A pop-out (main window) or dock (panel window) button for a panel's header. */
  panelButton?(panel: "nav" | "board"): HTMLElement | null;
  /** Navigator data (M3 step 3) and its actions. */
  nav?(): NavInfo;
  redraw?(): void;
  setScope?(project: boolean): void;
  setLabel?(sceneId: string, label: string): void;
  renameLabels?(): void;
  /** Open another document of the project at one of its scenes. */
  openElsewhere?(documentId: string, sceneId: string): void;
  /** Delete an outline item (a planning step, undoable). */
  deleteItem?(id: string): void;
  /** After an outline move: reorder the script to match, when the board may (ADR 0003). */
  reorderFromOutline?(id: string): void;
  /** Run an outline change against the data as it is when its turn comes (a planning step). */
  planWith?(plan: (all: Beat[]) => Beat | string): Promise<Beat | string>;
}

/** The editor as a ScriptView (main window). */
export function editorScript(view: EditorView, putBeat: (beat: Beat) => Promise<void>, panelButton?: ScriptView["panelButton"]): ScriptView {
  return {
    scenes: () => scenesOf(view.state.doc),
    current: () => sceneAtCursor(view)?.sceneId,
    reveal: (id) => revealScene(view, id),
    move: (id, before) => {
      const tr = moveScene(view.state, id, before);
      if (tr) view.dispatch(tr);
    },
    putBeat,
    panelButton,
  };
}

/** Go to a scene: caret at the end of its heading (so Enter continues the
 *  scene instead of inserting a block above the heading), and the heading
 *  scrolled to the top of the script. WebKit did not reliably scroll for the
 *  selection alone (macOS pass, 2026-10-26), so the heading is scrolled
 *  explicitly after focusing. */
export function revealScene(view: EditorView, sceneId: string) {
  const s = scenesOf(view.state.doc).find((x) => x.sceneId === sceneId);
  if (!s) return;
  const heading = view.state.doc.nodeAt(s.from);
  const end = s.from + 1 + (heading?.content.size ?? 0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)).scrollIntoView());
  view.focus();
  (view.nodeDOM(s.from) as HTMLElement | null)?.scrollIntoView({ block: "start" });
}

export function sceneAtCursor(view: EditorView): SceneInfo | undefined {
  const pos = view.state.selection.from;
  return scenesOf(view.state.doc).find((s) => pos >= s.from && pos < s.to);
}

/** Move a scene one place up or down; the editor transaction is the only write. */
function moveSceneBy(script: ScriptView, sceneId: string, dir: -1 | 1) {
  const scenes = script.scenes();
  const i = scenes.findIndex((s) => s.sceneId === sceneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scenes.length) {
    announce(dir < 0 ? "Already the first scene" : "Already the last scene");
    return;
  }
  script.move(sceneId, dir < 0 ? scenes[j].sceneId : (scenes[j + 1]?.sceneId ?? null));
  announce(`Scene moved to position ${j + 1} of ${scenes.length}. Undo reverts it.`);
}

/** One tab stop per list: the chosen item is tabbable, the rest are not. */
function setRoving(items: HTMLElement[], active: HTMLElement | undefined, inner?: (item: HTMLElement, on: boolean) => void) {
  for (const it of items) {
    const on = it === active;
    it.tabIndex = on ? 0 : -1;
    inner?.(it, on);
  }
}

function arrowTarget<T>(list: T[], at: number, key: string, prev: string[], next: string[]): T | undefined {
  if (prev.includes(key)) return list[Math.max(0, at - 1)];
  if (next.includes(key)) return list[Math.min(list.length - 1, at + 1)];
  if (key === "Home") return list[0];
  if (key === "End") return list[list.length - 1];
  return undefined;
}

/** One speaking character, as the core counts them (cirth_core::navigator). */
export interface CharacterStat {
  name: string;
  speeches: number;
  words: number;
  scenes: { document_id: string; scene_id: string }[];
}

/** What the navigator shows besides the script's own scenes. */
export interface NavInfo {
  /** Page, length in eighths and speakers per scene of the open document. */
  stats: Map<string, { page: string; eighths: number; characters: string[] }>;
  /** Scene id -> label key. */
  labels: Map<string, string>;
  /** Label keys in palette order with the project's names for them. */
  labelNames: [string, string][];
  characters: CharacterStat[];
  /** Whole-project scope: every document's scenes. */
  projectScenes: { document_id: string; document_title: string; scene_id: string; heading: string }[];
  beats: Beat[];
  currentDocument: string | null;
}

/** The navigator's own choices (per window): tab, filter text, scope. */
export const navUi = { tab: "scenes" as "scenes" | "outline" | "characters", filter: "", project: false, chosen: null as string | null };

/** Page eighths as screenplay schedules write them: "1 2/8", "3/8", "2". */
export function eighths(n: number): string {
  const pages = Math.floor(n / 8);
  const rest = n % 8;
  return pages && rest ? `${pages} ${rest}/8` : pages ? String(pages) : `${rest}/8`;
}

/** The parts of a navigator that live across redraws (so typing in the filter keeps focus). */
const shells = new WeakMap<HTMLElement, { tabs: HTMLButtonElement[]; filter: HTMLInputElement; scope: HTMLSelectElement; names: HTMLButtonElement; body: HTMLElement; pop: HTMLElement | null }>();

function navShell(root: HTMLElement, script: ScriptView) {
  let sh = shells.get(root);
  if (sh && root.contains(sh.body)) return sh;
  const head = el("div", { className: "panel-head" });
  const tablist = el("div", { className: "nav-tabs" });
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Navigator");
  const tabs = (["scenes", "outline", "characters"] as const).map((t) => {
    const b = el("button", { type: "button", className: "nav-tab", id: `nav-tab-${t}` }, { scenes: "Scenes", outline: "Outline", characters: "Characters" }[t]);
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      navUi.tab = t;
      script.redraw?.();
    });
    return b;
  });
  // Left/Right move between the two tabs (WAI-ARIA tabs).
  tablist.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const order = ["scenes", "outline", "characters"] as const;
    navUi.tab = order[(order.indexOf(navUi.tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
    script.redraw?.();
    document.getElementById(`nav-tab-${navUi.tab}`)?.focus();
  });
  tablist.append(...tabs);
  head.append(tablist);
  const pop = script.panelButton?.("nav") ?? null;
  if (pop) head.append(pop);
  const filter = el("input", { type: "search", className: "nav-filter", id: "nav-filter", placeholder: "Filter" });
  filter.setAttribute("aria-label", "Filter scenes or characters");
  filter.addEventListener("input", () => {
    navUi.filter = filter.value;
    script.redraw?.();
  });
  const scope = el("select", { className: "nav-scope", id: "nav-scope" });
  scope.setAttribute("aria-label", "Scope");
  scope.append(new Option("This document", "doc"), new Option("Whole project", "project"));
  scope.addEventListener("change", () => {
    navUi.project = scope.value === "project";
    script.setScope?.(navUi.project);
  });
  const names = el("button", { type: "button", className: "nav-label-names", id: "nav-label-names", title: "Rename the colour labels for this project" }, "Labels…");
  names.addEventListener("click", () => script.renameLabels?.());
  const tools = el("div", { className: "nav-tools" }, filter, scope);
  if (script.renameLabels) tools.append(names);
  const body = el("div", { className: "nav-body" });
  root.replaceChildren(head, tools, el("p", { className: "sr-only", id: "nav-hint" }, NAV_HINT), body);
  sh = { tabs, filter, scope, names, body, pop };
  shells.set(root, sh);
  return sh;
}

const LABEL_SWATCH = (key: string) => `var(--label-${key})`;

export function renderNavigator(root: HTMLElement, script: ScriptView, focusScene?: string | null) {
  const sh = navShell(root, script);
  const info = script.nav?.();
  for (const t of sh.tabs) {
    const on = t.id === `nav-tab-${navUi.tab}`;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  }
  if (sh.filter.value !== navUi.filter) sh.filter.value = navUi.filter;
  sh.scope.value = navUi.project ? "project" : "doc";
  sh.body.setAttribute("role", "tabpanel");
  sh.body.setAttribute("aria-labelledby", `nav-tab-${navUi.tab}`);
  const q = navUi.filter.trim().toLowerCase();
  if (navUi.tab === "characters") return renderCharacters(sh.body, script, info, q, focusScene);
  if (navUi.tab === "outline") return renderOutline(sh.body, script, info, q, focusScene);

  const scenes = script.scenes();
  const current = script.current();
  const names = new Map(info?.labelNames ?? []);
  const cards = new Map<string, Beat>();
  for (const b of info?.beats ?? []) if (b.scene_id && !cards.has(b.scene_id)) cards.set(b.scene_id, b);
  const list = el("ol", { className: "nav-list" });
  list.setAttribute("aria-label", "Scenes");
  list.setAttribute("aria-describedby", "nav-hint");
  const gos: HTMLButtonElement[] = [];
  let shown = 0;
  scenes.forEach((s, i) => {
    const n = numbers.get(s.sceneId);
    const stat = info?.stats.get(s.sceneId);
    const label = info?.labels.get(s.sceneId) ?? "";
    const card = cards.get(s.sceneId);
    const name = s.heading || "(empty heading)";
    const haystack = [s.heading, n?.number, label && names.get(label), ...(stat?.characters ?? []), card?.logline, card?.summary].join(" ").toLowerCase();
    if (q && !haystack.includes(q)) return;
    shown++;
    const item = el("li", { className: s.sceneId === current ? "current" : "" });
    item.dataset.sceneId = s.sceneId;
    item.dataset.item = s.sceneId;
    if (label) item.dataset.label = label;
    // Numbers appear once the writer locks scene numbers; order alone otherwise.
    const go = el("button", { type: "button", className: "nav-go", title: s.heading }, ...(n ? [el("span", { className: "num" }, n.number), " "] : []), n?.omitted ? "OMITTED" : name);
    if (n?.omitted) go.title = `${s.heading} (omitted)`;
    go.dataset.part = "go";
    go.dataset.roving = "";
    if (s.sceneId === current) go.setAttribute("aria-current", "location");
    go.addEventListener("click", () => script.reveal(s.sceneId));
    const up = el("button", { type: "button", className: "nav-move", disabled: i === 0, title: "Move scene up (Alt+Up)", tabIndex: -1 }, "↑");
    up.setAttribute("aria-label", `Move ${name} up`);
    up.dataset.part = "up";
    up.addEventListener("click", () => moveSceneBy(script, s.sceneId, -1));
    const down = el("button", { type: "button", className: "nav-move", disabled: i === scenes.length - 1, title: "Move scene down (Alt+Down)", tabIndex: -1 }, "↓");
    down.setAttribute("aria-label", `Move ${name} down`);
    down.dataset.part = "down";
    down.addEventListener("click", () => moveSceneBy(script, s.sceneId, 1));
    // Details: page, length (an estimate), label, speakers, the card's logline.
    const details = el("div", { className: "nav-details" });
    if (stat) details.append(el("span", { className: "nav-page", title: "Page the scene starts on" }, `p. ${stat.page}`), el("span", { className: "nav-len", title: "Length in eighths of a page (an estimate)" }, eighths(stat.eighths)));
    if (info) {
      const pick = el("select", { className: "nav-label", tabIndex: -1 });
      pick.dataset.part = "label";
      pick.setAttribute("aria-label", `Label of ${name}`);
      pick.append(new Option("No label", ""), ...(info.labelNames ?? []).map(([k, v]) => new Option(v, k)));
      pick.value = label;
      pick.style.setProperty("--swatch", label ? LABEL_SWATCH(label) : "transparent");
      pick.addEventListener("change", () => script.setLabel?.(s.sceneId, pick.value));
      details.append(pick);
    }
    if (stat?.characters.length) details.append(el("span", { className: "nav-chars", title: "Speaking in this scene" }, stat.characters.join(", ")));
    item.append(go, up, down, details);
    if (card?.logline || card?.summary) item.append(el("div", { className: "nav-card", title: card.summary }, card.logline || card.summary));
    list.append(item);
    gos.push(go);
  });
  const parts: HTMLElement[] = [];
  const multi = navUi.project && (info?.projectScenes.length ?? 0) > 0;
  if (multi) parts.push(el("h3", { className: "nav-doc" }, "This document"));
  parts.push(list);
  // Whole project: the other documents' scenes; choosing one opens its document.
  if (multi && info) {
    const others = info.projectScenes.filter((p) => p.document_id !== info.currentDocument);
    let doc = "";
    let ol: HTMLOListElement | null = null;
    for (const p of others) {
      if (q && !`${p.heading} ${p.document_title}`.toLowerCase().includes(q)) continue;
      if (p.document_id !== doc) {
        doc = p.document_id;
        parts.push(el("h3", { className: "nav-doc" }, p.document_title || "(untitled)"));
        ol = el("ol", { className: "nav-list other" });
        ol.setAttribute("aria-label", `Scenes of ${p.document_title}`);
        parts.push(ol);
      }
      const li = el("li", {});
      li.dataset.item = `${p.document_id}:${p.scene_id}`;
      const go = el("button", { type: "button", className: "nav-go", title: `Open ${p.document_title} at this scene` }, p.heading || "(empty heading)");
      go.dataset.part = "go";
      go.dataset.roving = "";
      go.addEventListener("click", () => script.openElsewhere?.(p.document_id, p.scene_id));
      li.append(go);
      ol!.append(li);
      gos.push(go);
      shown++;
    }
  }
  const want = focusScene ?? current;
  setRoving(gos, gos.find((g) => g.parentElement!.dataset.item === want) ?? gos[0]);
  for (const l of parts.filter((p) => p.tagName === "OL"))
    l.addEventListener("keydown", (e) => {
      const at = gos.indexOf(e.target as HTMLButtonElement);
      if (at < 0) return;
      const li = gos[at].parentElement!;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (li.dataset.sceneId) moveSceneBy(script, li.dataset.sceneId, e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === "l" || e.key === "L") && li.querySelector("select")) {
        // The scene's label: arrow keys choose, Escape or Tab comes back.
        e.preventDefault();
        li.querySelector<HTMLSelectElement>("select")!.focus();
        return;
      }
      const to = arrowTarget(gos, at, e.key, ["ArrowUp"], ["ArrowDown"]);
      if (to) {
        e.preventDefault();
        setRoving(gos, to);
        to.focus();
      }
    });
  const total = scenes.length;
  sh.body.replaceChildren(el("h2", {}, q ? `Scenes (${shown} of ${total + (multi ? (info?.projectScenes.length ?? 0) - total : 0)})` : `Scenes (${total})`), ...parts);
  if (!shown) sh.body.append(el("p", { className: "form-note" }, q ? "No scene matches the filter." : "No scenes yet."));
}


const KIND_LABEL: Record<string, string> = { act: "Act", sequence: "Sequence", beat: "Beat" };

/** The Outline tab (M3 step 4): acts, sequences and beats as one tree; the board shows the same beats. */
function renderOutline(body: HTMLElement, script: ScriptView, info: NavInfo | undefined, q: string, focusItem?: string | null) {
  const items = info?.beats ?? [];
  const scenes = script.scenes();
  const heading = new Map(scenes.map((s) => [s.sceneId, s.heading || "(empty heading)"]));
  const flat = outlineOrder(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const name = (b: Beat) => b.title || b.logline || (b.scene_id && heading.get(b.scene_id)) || `(untitled ${KIND_LABEL[b.kind ?? "beat"].toLowerCase()})`;
  if (!navUi.chosen || !byId.has(navUi.chosen)) navUi.chosen = flat[0]?.it.id ?? null;
  const chosen = navUi.chosen ? byId.get(navUi.chosen) : undefined;
  const siblingsIn = (all: Beat[], parent: string | null) => all.filter((b) => (b.parent ?? null) === parent).sort((a, b) => a.pos - b.pos);
  const siblings = (parent: string | null) => siblingsIn(items, parent);
  /** Plan a change from the outline as it is when its turn comes (moves pressed in quick succession all count). */
  type Plan = (all: Beat[]) => Beat | string;
  const apply = (plan: Plan, announcement: string) => {
    const run =
      script.planWith ??
      (async (f: Plan) => {
        const r = f(items);
        if (typeof r !== "string") await script.putBeat(r);
        return r;
      });
    void run(plan).then((r) => {
      if (typeof r === "string") return announce(r);
      announce(announcement);
      script.reorderFromOutline?.(r.id);
    });
  };
  const put = (b: Beat, announcement: string) => apply(() => b, announcement);
  /** A new item: inside the chosen act or sequence when it can hold it, else beside the chosen item. */
  const add = (kind: "act" | "sequence" | "beat") => {
    let parent: string | null = null;
    if (kind !== "act" && chosen) {
      if (chosen.kind === "act" || (chosen.kind === "sequence" && kind === "beat")) parent = chosen.id;
      else parent = chosen.parent ?? null;
      const p = parent ? byId.get(parent) : undefined;
      if (kind === "sequence" && p?.kind === "sequence") parent = p.parent ?? null;
    }
    const b: Beat = { id: newId(), kind, title: kind === "beat" ? "" : kind === "act" ? `Act ${items.filter((x) => x.kind === "act").length + 1}` : "New sequence", logline: "", summary: "", scene_id: null, parent, pos: Math.max(0, ...siblings(parent).map((x) => x.pos)) + 1 };
    navUi.chosen = b.id;
    put(b, `${KIND_LABEL[kind]} added`);
  };
  /** Up or down among its siblings. */
  const move = (id: string, dir: -1 | 1) =>
    apply((all) => {
      const b = all.find((x) => x.id === id)!;
      const sib = siblingsIn(all, b.parent ?? null);
      const j = sib.findIndex((x) => x.id === id) + dir;
      if (j < 0 || j >= sib.length) return dir < 0 ? "Already first in its place" : "Already last in its place";
      const far = sib[j + dir];
      return { ...b, pos: far ? (sib[j].pos + far.pos) / 2 : sib[j].pos + dir };
    }, `Moved ${dir < 0 ? "up" : "down"}`);
  /** Into the act or sequence above it (indent), or out to its parent's level after it (outdent). */
  const indent = (id: string) =>
    apply((all) => {
      const b = all.find((x) => x.id === id)!;
      const sib = siblingsIn(all, b.parent ?? null);
      const above = sib[sib.findIndex((x) => x.id === id) - 1];
      if (!above || above.kind === "beat" || b.kind === "act" || (b.kind === "sequence" && above.kind !== "act")) return "It cannot go inside the item above it";
      return { ...b, parent: above.id, pos: Math.max(0, ...siblingsIn(all, above.id).map((x) => x.pos)) + 1 };
    }, "Moved inside the item above");
  const outdent = (id: string) =>
    apply((all) => {
      const b = all.find((x) => x.id === id)!;
      const p = b.parent ? all.find((x) => x.id === b.parent) : undefined;
      if (!p) return "Already at the top of the outline";
      // Out to its parent's level, just after the parent.
      const up = p.parent ?? null;
      const sib = siblingsIn(all, up);
      const i = sib.findIndex((x) => x.id === p.id);
      return { ...b, parent: up, pos: sib[i + 1] ? (p.pos + sib[i + 1].pos) / 2 : p.pos + 1 };
    }, "Moved out of its act or sequence");

  const tools = el("div", { className: "outline-tools" });
  for (const k of ["act", "sequence", "beat"] as const) {
    const bt = el("button", { type: "button", id: `outline-add-${k}`, title: `Add ${k === "act" ? "an act" : `a ${k}`} (inside the chosen act or sequence when it can go there)` }, `+ ${KIND_LABEL[k]}`);
    bt.addEventListener("click", () => add(k));
    tools.append(bt);
  }
  const list = el("ul", { className: "outline-list" });
  list.setAttribute("aria-label", "Outline");
  list.setAttribute("aria-describedby", "outline-hint");
  const gos: HTMLButtonElement[] = [];
  for (const { it, depth } of flat) {
    const linked = it.scene_id ? heading.get(it.scene_id) : undefined;
    if (q && !`${it.title} ${it.logline} ${it.summary} ${linked ?? ""}`.toLowerCase().includes(q)) continue;
    const li = el("li", { className: `outline-row ${it.kind}` });
    li.dataset.item = it.id;
    li.style.paddingLeft = `${depth * 14}px`;
    const go = el("button", { type: "button", className: "outline-go" }, el("span", { className: "outline-kind" }, KIND_LABEL[it.kind] ?? "Beat"), " ", name(it));
    go.dataset.part = "go";
    go.dataset.roving = "";
    go.title = [it.summary, linked && `Scene: ${linked}`].filter(Boolean).join("\n");
    go.setAttribute("aria-label", `${KIND_LABEL[it.kind]}: ${name(it)}${linked ? `, scene ${linked}` : it.kind === "beat" ? ", not linked to a scene" : ""}`);
    if (it.id === navUi.chosen) go.setAttribute("aria-current", "true");
    go.addEventListener("click", () => {
      navUi.chosen = it.id;
      script.redraw?.();
      document.querySelector<HTMLElement>(`.outline-list li[data-item="${CSS.escape(it.id)}"] .outline-go`)?.focus();
    });
    li.append(go);
    if (linked) li.append(el("span", { className: "outline-scene" }, linked));
    list.append(li);
    gos.push(go);
  }
  setRoving(gos, gos.find((g) => g.parentElement!.dataset.item === (focusItem ?? navUi.chosen)) ?? gos[0]);
  list.addEventListener("keydown", (e) => {
    const at = gos.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    const b = byId.get(gos[at].parentElement!.dataset.item!)!;
    navUi.chosen = b.id;
    if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowUp" || e.key === "ArrowDown") move(b.id, e.key === "ArrowUp" ? -1 : 1);
      else if (e.key === "ArrowRight") indent(b.id);
      else outdent(b.id);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      script.redraw?.();
      document.getElementById("outline-title")?.focus();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      script.deleteItem?.(b.id);
      return;
    }
    const to = arrowTarget(gos, at, e.key, ["ArrowUp"], ["ArrowDown"]);
    if (to) {
      e.preventDefault();
      navUi.chosen = to.parentElement!.dataset.item!;
      setRoving(gos, to);
      to.focus();
      script.redraw?.();
      document.querySelector<HTMLElement>(`.outline-list li[data-item="${CSS.escape(navUi.chosen)}"] .outline-go`)?.focus();
    }
  });

  // The chosen item's fields. Changes are committed on Enter or leaving a field (one planning step each).
  const editor = el("div", { className: "outline-editor" });
  if (chosen) {
    const isBeat = chosen.kind === "beat";
    const title = el("input", { type: "text", id: "outline-title", value: isBeat ? chosen.logline : chosen.title, placeholder: isBeat ? "Logline: what happens, in one line" : "Title" });
    title.setAttribute("aria-label", isBeat ? "Logline of the chosen beat" : `Title of the chosen ${chosen.kind}`);
    const summary = el("textarea", { id: "outline-summary", value: chosen.summary, rows: 3, placeholder: "Summary (planning text, never written into the script)" });
    summary.setAttribute("aria-label", "Summary of the chosen item");
    const commit = () => {
      const next: Beat = { ...chosen, summary: summary.value, ...(isBeat ? { logline: title.value } : { title: title.value }) };
      if (next.summary !== chosen.summary || next.logline !== chosen.logline || next.title !== chosen.title) put(next, "Outline item saved");
    };
    for (const f of [title, summary] as HTMLElement[]) {
      f.addEventListener("change", commit);
      f.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          document.querySelector<HTMLElement>(`.outline-list li[data-item="${CSS.escape(chosen.id)}"] .outline-go`)?.focus();
        } else if (e.key === "Enter" && f === title) {
          e.preventDefault();
          summary.focus();
        }
      });
    }
    editor.append(el("h3", {}, `${KIND_LABEL[chosen.kind]}: ${name(chosen)}`), title, summary);
    if (isBeat) {
      const link = el("select", { id: "outline-link" });
      link.setAttribute("aria-label", "Scene this beat is linked to");
      link.append(new Option("Not linked to a scene", ""), ...scenes.map((s) => new Option(s.heading || "(empty heading)", s.sceneId)));
      link.value = chosen.scene_id ?? "";
      link.addEventListener("change", () => put({ ...chosen, scene_id: link.value || null }, link.value ? "Linked to the scene" : "Link removed"));
      editor.append(link);
    }
    const del = el("button", { type: "button", id: "outline-delete", title: "Delete the chosen item (Delete). Undo brings it back." }, "Delete");
    del.addEventListener("click", () => script.deleteItem?.(chosen.id));
    editor.append(del);
  }
  body.replaceChildren(
    el("h2", {}, `Outline (${flat.length})`),
    el("p", { className: "sr-only", id: "outline-hint" }, "Up and Down choose an item, Enter edits it, Alt+Up and Alt+Down move it, Alt+Right puts it inside the act or sequence above, Alt+Left takes it out, Delete removes it."),
    tools,
    list,
    editor,
  );
  if (!flat.length) list.append(el("li", { className: "form-note" }, "No outline yet. Add an act, a sequence or a beat."));
}

function renderCharacters(body: HTMLElement, script: ScriptView, info: NavInfo | undefined, q: string, focusItem?: string | null) {
  const chars = (info?.characters ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const headings = new Map<string, string>();
  for (const s of script.scenes()) headings.set(s.sceneId, s.heading);
  for (const p of info?.projectScenes ?? []) headings.set(p.scene_id, p.document_id === info?.currentDocument ? p.heading : `${p.heading} (${p.document_title})`);
  const list = el("ul", { className: "char-list" });
  list.setAttribute("aria-label", "Characters");
  const gos: HTMLButtonElement[] = [];
  for (const c of chars) {
    const li = el("li", {});
    li.dataset.item = `char:${c.name}`;
    const first = c.scenes[0];
    const go = el("button", { type: "button", className: "char-go" }, el("strong", {}, c.name));
    go.dataset.part = "go";
    go.dataset.roving = "";
    go.title = first ? `First appearance: ${headings.get(first.scene_id) ?? "a scene"}` : "";
    go.setAttribute("aria-label", `${c.name}: ${c.speeches} speeches, ${c.words} words of dialogue, ${c.scenes.length} scenes. Enter goes to the first appearance.`);
    go.addEventListener("click", () => {
      if (!first) return;
      if (!info?.currentDocument || first.document_id === info.currentDocument) script.reveal(first.scene_id);
      else script.openElsewhere?.(first.document_id, first.scene_id);
    });
    const meta = el("span", { className: "char-meta" }, `${c.speeches} speech${c.speeches === 1 ? "" : "es"} · ${c.words} words · ${c.scenes.length} scene${c.scenes.length === 1 ? "" : "s"}`);
    const firstLine = el("span", { className: "char-first" }, first ? `First: ${headings.get(first.scene_id) ?? ""}` : "");
    li.append(go, meta, firstLine);
    list.append(li);
    gos.push(go);
  }
  setRoving(gos, gos.find((g) => g.parentElement!.dataset.item === focusItem) ?? gos[0]);
  list.addEventListener("keydown", (e) => {
    const at = gos.indexOf(e.target as HTMLButtonElement);
    if (at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = arrowTarget(gos, at, e.key, ["ArrowUp"], ["ArrowDown"]);
    if (to) {
      e.preventDefault();
      setRoving(gos, to);
      to.focus();
    }
  });
  body.replaceChildren(el("h2", {}, `Characters (${chars.length})`), el("p", { className: "form-note" }, "Speeches and words count dialogue; scenes count where they speak. Presence without lines and screen time are not counted here."), list);
  if (!chars.length) body.append(el("p", { className: "form-note" }, q ? "No character matches the filter." : "No one speaks yet."));
}

export interface BoardState {
  beats: Beat[];
  structural: boolean;
}

/** Outline items in reading order: each item, then what it holds (by position among siblings). */
export function outlineOrder(items: Beat[]): { it: Beat; depth: number }[] {
  const kids = new Map<string | null, Beat[]>();
  const ids = new Set(items.map((i) => i.id));
  for (const it of items) {
    const p = it.parent && ids.has(it.parent) ? it.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(it);
  }
  const out: { it: Beat; depth: number }[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const it of (kids.get(p) ?? []).sort((a, b) => a.pos - b.pos)) {
      out.push({ it, depth });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The board's cards: the outline's beats (acts and sequences are not cards). */
export function boardOrder(items: Beat[], scenes: SceneInfo[], structural: boolean): Beat[] {
  const flat = outlineOrder(items).map((x) => x.it);
  const beats = flat.filter((b) => (b.kind ?? "beat") === "beat");
  if (!structural) return beats;
  const idx = new Map(scenes.map((s) => [s.sceneId, s.index]));
  const key = (b: Beat) => (b.scene_id && idx.has(b.scene_id) ? idx.get(b.scene_id)! : Number.MAX_SAFE_INTEGER);
  return [...beats].sort((a, b) => key(a) - key(b) || a.pos - b.pos);
}

/** Move beat `id` to sit before beat `beforeId` (null = end). */
export async function moveCard(script: ScriptView, st: BoardState, id: string, beforeId: string | null, rerender: () => void) {
  const scenes = script.scenes();
  const order = boardOrder(st.beats, scenes, st.structural);
  const beat = order.find((b) => b.id === id)!;
  if (st.structural) {
    // Linked structural edit: canonical scene order changes once, via the editor.
    const target = beforeId ? order.find((b) => b.id === beforeId) : null;
    if (!beat.scene_id || (target && !target.scene_id)) return;
    script.move(beat.scene_id, target ? target.scene_id : null);
    return;
  }
  // Planning only: the card joins the outline beside its new neighbour (in
  // that neighbour's act or sequence); the script is untouched.
  const rest = order.filter((b) => b.id !== id);
  const at = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length;
  const anchor = at < rest.length ? rest[at] : rest[rest.length - 1];
  const parent = anchor?.parent ?? null;
  const siblings = st.beats.filter((b) => (b.parent ?? null) === parent && b.id !== id).sort((a, b) => a.pos - b.pos);
  if (at < rest.length) {
    const i = siblings.findIndex((b) => b.id === anchor.id);
    const lo = i > 0 ? siblings[i - 1].pos : anchor.pos - 2;
    beat.pos = (lo + anchor.pos) / 2;
  } else beat.pos = (siblings.at(-1)?.pos ?? 0) + 1;
  beat.parent = parent;
  await script.putBeat(beat);
  rerender();
}

export function renderBoard(root: HTMLElement, script: ScriptView, st: BoardState, rerender: () => void, focusBeat?: string | null) {
  const scenes = script.scenes();
  const byScene = new Map(scenes.map((s) => [s.sceneId, s]));
  const order = boardOrder(st.beats, scenes, st.structural);
  const header = el("div", { className: "board-head" }, el("h2", {}, `Board (${order.length})`));
  const badge = el("span", { className: `badge ${st.structural ? "live" : "planning"}` }, st.structural ? "Moves reorder the script" : "Planning only");
  const add = el("button", { type: "button" }, "New beat for current scene");
  add.addEventListener("click", async () => {
    const top = st.beats.filter((b) => !b.parent);
    const beat: Beat = { id: newId(), logline: "", summary: "", scene_id: script.current() ?? null, pos: Math.max(0, ...top.map((b) => b.pos)) + 1, kind: "beat", title: "", parent: null };
    await script.putBeat(beat);
    rerender();
    announce("New beat added at the end of the board");
  });
  header.append(badge, add);
  const pb = script.panelButton?.("board");
  if (pb) header.append(pb);
  const grid = el("div", { className: "cards", role: "list" });
  grid.setAttribute("aria-label", "Beat cards");
  grid.setAttribute("aria-describedby", "board-hint");
  const cards: HTMLElement[] = [];
  // Only the chosen card's own controls are in the Tab order.
  const inner = (card: HTMLElement, on: boolean) => card.querySelectorAll<HTMLElement>("button, textarea, input").forEach((c) => (c.tabIndex = on ? 0 : -1));
  const move = async (id: string, dir: -1 | 1) => {
    const i = order.findIndex((b) => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= order.length) {
      announce(dir < 0 ? "Already the first card" : "Already the last card");
      return;
    }
    await moveCard(script, st, id, dir < 0 ? order[j].id : (order[j + 1]?.id ?? null), rerender);
    announce(st.structural ? `Card moved to position ${j + 1}; the scene order in the script changed. Undo reverts it.` : `Card moved to position ${j + 1} of ${order.length}. The script is unchanged.`);
  };
  order.forEach((b, i) => {
    const s = b.scene_id ? byScene.get(b.scene_id) : undefined;
    const card = el("article", { className: "card", draggable: true, tabIndex: -1 });
    card.setAttribute("role", "listitem");
    card.dataset.beatId = b.id;
    card.dataset.item = b.id;
    card.dataset.roving = "";
    card.setAttribute("aria-label", `Beat ${i + 1} of ${order.length}${s ? `, linked to ${s.heading || "an empty heading"}` : ""}: ${b.summary}`);
    const link = s
      ? el("button", { type: "button", className: "card-link", title: "Go to scene" }, s.heading || "(empty heading)")
      : el("span", { className: "card-link missing" }, b.scene_id ? "Linked scene no longer exists" : "Not linked");
    link.dataset.part = "link";
    if (s) link.addEventListener("click", () => script.reveal(s.sceneId));
    // A planning card: the writer's logline and summary, never a copy of
    // the scene's script text. Both are authored and stored with the beat.
    const logline = el("input", { type: "text", className: "logline", value: b.logline, placeholder: "Logline: what this scene is about, in one line" });
    logline.dataset.part = "logline";
    logline.setAttribute("aria-label", "Logline (one line, planning text, never written into the script)");
    const summary = el("textarea", { className: "summary", value: b.summary, rows: 3, placeholder: "Summary: what happens" });
    summary.dataset.part = "summary";
    summary.setAttribute("aria-label", "Beat summary (planning text, never written into the script)");
    for (const [field, input] of [["logline", logline], ["summary", summary]] as const) {
      input.addEventListener("change", async () => {
        b[field] = input.value;
        await script.putBeat(b);
      });
      (input as HTMLElement).addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          card.focus();
        } else if (e.key === "Enter" && input === logline) {
          // One line: Enter moves on to the summary.
          e.preventDefault();
          summary.focus();
        }
      });
    }
    const left = el("button", { type: "button", disabled: i === 0 }, "◀");
    left.setAttribute("aria-label", "Move card earlier (Alt+Left)");
    left.dataset.part = "left";
    left.addEventListener("click", () => void move(b.id, -1));
    const right = el("button", { type: "button", disabled: i === order.length - 1 }, "▶");
    right.setAttribute("aria-label", "Move card later (Alt+Right)");
    right.dataset.part = "right";
    right.addEventListener("click", () => void move(b.id, 1));
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return;
      if (e.altKey && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        void move(b.id, e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        logline.focus();
        return;
      }
      const to = arrowTarget(cards, i, e.key, ["ArrowLeft", "ArrowUp"], ["ArrowRight", "ArrowDown"]);
      if (to) {
        e.preventDefault();
        setRoving(cards, to, inner);
        to.focus();
      }
    });
    card.addEventListener("focus", () => setRoving(cards, card, inner));
    card.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/x-beat", b.id));
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer?.getData("text/x-beat");
      if (from && from !== b.id) void moveCard(script, st, from, b.id, rerender);
    });
    card.append(link, logline, summary, el("div", { className: "card-moves" }, left, right));
    grid.append(card);
    cards.push(card);
  });
  setRoving(cards, cards.find((c) => c.dataset.item === focusBeat) ?? cards[0], inner);
  root.replaceChildren(header, el("p", { className: "sr-only", id: "board-hint" }, BOARD_HINT), grid);
}
