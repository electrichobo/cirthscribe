// Navigator and board: two more views of the same scenes. They read scene
// headings from the editor document and change the script only through
// MoveScene transactions. Cards show the beat's logline and summary, which
// are separate authored text, never a copy of the scene.
//
// Keyboard: each list is one Tab stop (roving tabindex). Arrows choose an
// item, Alt+arrows move it, and moves are announced to screen readers.

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { moveScene, scenesOf, type SceneInfo } from "./scenes";
import { newId, type Beat } from "./schema";
import { announce } from "./a11y";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

const NAV_HINT = "Up and Down arrows choose a scene, Enter goes to it, Alt+Up and Alt+Down move it.";
const BOARD_HINT = "Arrow keys choose a card, Enter edits its logline (Tab goes on to the summary) and Escape returns, Alt+arrows move it. Tab reaches the chosen card's buttons.";

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

function doMove(view: EditorView, sceneId: string, beforeSceneId: string | null) {
  const tr = moveScene(view.state, sceneId, beforeSceneId);
  if (tr) view.dispatch(tr);
}

/** Move a scene one place up or down; the editor transaction is the only write. */
function moveSceneBy(view: EditorView, sceneId: string, dir: -1 | 1) {
  const scenes = scenesOf(view.state.doc);
  const i = scenes.findIndex((s) => s.sceneId === sceneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scenes.length) {
    announce(dir < 0 ? "Already the first scene" : "Already the last scene");
    return;
  }
  doMove(view, sceneId, dir < 0 ? scenes[j].sceneId : (scenes[j + 1]?.sceneId ?? null));
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

export function renderNavigator(root: HTMLElement, view: EditorView, focusScene?: string | null) {
  const scenes = scenesOf(view.state.doc);
  const current = sceneAtCursor(view)?.sceneId;
  const list = el("ol", { className: "nav-list" });
  list.setAttribute("aria-label", "Scenes");
  list.setAttribute("aria-describedby", "nav-hint");
  const gos: HTMLButtonElement[] = [];
  scenes.forEach((s, i) => {
    const item = el("li", { className: s.sceneId === current ? "current" : "" });
    item.dataset.sceneId = s.sceneId;
    item.dataset.item = s.sceneId;
    // No scene numbers: they are assigned when the writer locks scene
    // numbers (a production feature, not built yet); order alone is shown.
    const name = s.heading || "(empty heading)";
    const go = el("button", { type: "button", className: "nav-go", title: s.heading }, name);
    go.dataset.part = "go";
    go.dataset.roving = "";
    if (s.sceneId === current) go.setAttribute("aria-current", "location");
    go.addEventListener("click", () => revealScene(view, s.sceneId));
    const up = el("button", { type: "button", className: "nav-move", disabled: i === 0, title: "Move scene up (Alt+Up)", tabIndex: -1 }, "↑");
    up.setAttribute("aria-label", `Move ${name} up`);
    up.dataset.part = "up";
    up.addEventListener("click", () => moveSceneBy(view, s.sceneId, -1));
    const down = el("button", { type: "button", className: "nav-move", disabled: i === scenes.length - 1, title: "Move scene down (Alt+Down)", tabIndex: -1 }, "↓");
    down.setAttribute("aria-label", `Move ${name} down`);
    down.dataset.part = "down";
    down.addEventListener("click", () => moveSceneBy(view, s.sceneId, 1));
    item.append(go, up, down);
    list.append(item);
    gos.push(go);
  });
  const want = focusScene ?? current;
  setRoving(gos, gos.find((g) => g.parentElement!.dataset.item === want) ?? gos[0]);
  list.addEventListener("keydown", (e) => {
    const at = gos.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveSceneBy(view, gos[at].parentElement!.dataset.item!, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = arrowTarget(gos, at, e.key, ["ArrowUp"], ["ArrowDown"]);
    if (to) {
      e.preventDefault();
      setRoving(gos, to);
      to.focus();
    }
  });
  root.replaceChildren(el("h2", {}, `Scenes (${scenes.length})`), el("p", { className: "sr-only", id: "nav-hint" }, NAV_HINT), list);
}

export interface BoardState {
  beats: Beat[];
  structural: boolean;
}

export function boardOrder(beats: Beat[], scenes: SceneInfo[], structural: boolean): Beat[] {
  if (!structural) return [...beats].sort((a, b) => a.pos - b.pos);
  const idx = new Map(scenes.map((s) => [s.sceneId, s.index]));
  const key = (b: Beat) => (b.scene_id && idx.has(b.scene_id) ? idx.get(b.scene_id)! : Number.MAX_SAFE_INTEGER);
  return [...beats].sort((a, b) => key(a) - key(b) || a.pos - b.pos);
}

/** Move beat `id` to sit before beat `beforeId` (null = end). */
export async function moveCard(view: EditorView, st: BoardState, id: string, beforeId: string | null, rerender: () => void) {
  const scenes = scenesOf(view.state.doc);
  const order = boardOrder(st.beats, scenes, st.structural);
  const beat = order.find((b) => b.id === id)!;
  if (st.structural) {
    // Linked structural edit: canonical scene order changes once, via the editor.
    const target = beforeId ? order.find((b) => b.id === beforeId) : null;
    if (!beat.scene_id || (target && !target.scene_id)) return;
    doMove(view, beat.scene_id, target ? target.scene_id : null);
    return;
  }
  // Planning only: reorder beats; the script is untouched.
  const rest = order.filter((b) => b.id !== id);
  const at = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length;
  const lo = at > 0 ? rest[at - 1].pos : (rest[0]?.pos ?? 0) - 2;
  const hi = at < rest.length ? rest[at].pos : lo + 2;
  beat.pos = (lo + hi) / 2;
  await invoke("put_beat", { beat });
  rerender();
}

export function renderBoard(root: HTMLElement, view: EditorView, st: BoardState, rerender: () => void, focusBeat?: string | null) {
  const scenes = scenesOf(view.state.doc);
  const byScene = new Map(scenes.map((s) => [s.sceneId, s]));
  const order = boardOrder(st.beats, scenes, st.structural);
  const header = el("div", { className: "board-head" }, el("h2", {}, `Board (${order.length})`));
  const badge = el("span", { className: `badge ${st.structural ? "live" : "planning"}` }, st.structural ? "Moves reorder the script" : "Planning only");
  const add = el("button", { type: "button" }, "New beat for current scene");
  add.addEventListener("click", async () => {
    const s = sceneAtCursor(view);
    const beat: Beat = { id: newId(), logline: "", summary: "", scene_id: s?.sceneId ?? null, pos: (order.at(-1)?.pos ?? 0) + 1 };
    await invoke("put_beat", { beat });
    st.beats.push(beat);
    rerender();
    announce("New beat added at the end of the board");
  });
  header.append(badge, add);
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
    await moveCard(view, st, id, dir < 0 ? order[j].id : (order[j + 1]?.id ?? null), rerender);
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
    if (s) link.addEventListener("click", () => revealScene(view, s.sceneId));
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
        await invoke("put_beat", { beat: b });
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
      if (from && from !== b.id) void moveCard(view, st, from, b.id, rerender);
    });
    card.append(link, logline, summary, el("div", { className: "card-moves" }, left, right));
    grid.append(card);
    cards.push(card);
  });
  setRoving(cards, cards.find((c) => c.dataset.item === focusBeat) ?? cards[0], inner);
  root.replaceChildren(header, el("p", { className: "sr-only", id: "board-hint" }, BOARD_HINT), grid);
}
