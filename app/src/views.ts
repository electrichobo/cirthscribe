// Navigator and board: two more views of the same scenes. They read scene
// headings and excerpts from the editor document and change the script only
// through MoveScene transactions. Beat summaries are separate authored text.

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { moveScene, scenesOf, type SceneInfo } from "./scenes";
import { newId, type Beat } from "./schema";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export function revealScene(view: EditorView, sceneId: string) {
  const s = scenesOf(view.state.doc).find((x) => x.sceneId === sceneId);
  if (!s) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, s.from + 1)).scrollIntoView());
  view.focus();
}

export function sceneAtCursor(view: EditorView): SceneInfo | undefined {
  const pos = view.state.selection.from;
  return scenesOf(view.state.doc).find((s) => pos >= s.from && pos < s.to);
}

function doMove(view: EditorView, sceneId: string, beforeSceneId: string | null) {
  const tr = moveScene(view.state, sceneId, beforeSceneId);
  if (tr) view.dispatch(tr);
}

export function renderNavigator(root: HTMLElement, view: EditorView) {
  const scenes = scenesOf(view.state.doc);
  const current = sceneAtCursor(view)?.sceneId;
  const list = el("ol", { className: "nav-list" });
  scenes.forEach((s, i) => {
    const item = el("li", { className: s.sceneId === current ? "current" : "" });
    item.dataset.sceneId = s.sceneId;
    const go = el("button", { type: "button", className: "nav-go", title: s.heading }, el("span", { className: "num" }, String(s.index)), " ", s.heading || "(empty heading)");
    go.addEventListener("click", () => revealScene(view, s.sceneId));
    const up = el("button", { type: "button", className: "nav-move", disabled: i === 0, title: "Move scene up" }, "↑");
    up.setAttribute("aria-label", `Move scene ${s.index} up`);
    up.addEventListener("click", () => doMove(view, s.sceneId, scenes[i - 1].sceneId));
    const down = el("button", { type: "button", className: "nav-move", disabled: i === scenes.length - 1, title: "Move scene down" }, "↓");
    down.setAttribute("aria-label", `Move scene ${s.index} down`);
    down.addEventListener("click", () => doMove(view, s.sceneId, scenes[i + 2]?.sceneId ?? null));
    item.append(go, up, down);
    list.append(item);
  });
  root.replaceChildren(el("h2", {}, `Scenes (${scenes.length})`), list);
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

export function renderBoard(root: HTMLElement, view: EditorView, st: BoardState, rerender: () => void) {
  const scenes = scenesOf(view.state.doc);
  const byScene = new Map(scenes.map((s) => [s.sceneId, s]));
  const order = boardOrder(st.beats, scenes, st.structural);
  const header = el("div", { className: "board-head" }, el("h2", {}, `Board (${order.length})`));
  const badge = el("span", { className: `badge ${st.structural ? "live" : "planning"}` }, st.structural ? "Moves reorder the script" : "Planning only");
  const add = el("button", { type: "button" }, "New beat for current scene");
  add.addEventListener("click", async () => {
    const s = sceneAtCursor(view);
    const beat: Beat = { id: newId(), summary: "New beat", scene_id: s?.sceneId ?? null, pos: (order.at(-1)?.pos ?? 0) + 1 };
    await invoke("put_beat", { beat });
    st.beats.push(beat);
    rerender();
  });
  header.append(badge, add);
  const grid = el("div", { className: "cards" });
  order.forEach((b, i) => {
    const s = b.scene_id ? byScene.get(b.scene_id) : undefined;
    const card = el("article", { className: "card", draggable: true, tabIndex: 0 });
    card.dataset.beatId = b.id;
    card.setAttribute("aria-label", `Beat ${i + 1}${s ? `, linked to scene ${s.index}` : ""}`);
    const link = s
      ? el("button", { type: "button", className: "card-link", title: "Go to scene" }, `Scene ${s.index}: ${s.heading}`)
      : el("span", { className: "card-link missing" }, b.scene_id ? "Linked scene no longer exists" : "Not linked");
    if (s) link.addEventListener("click", () => revealScene(view, s.sceneId));
    const summary = el("textarea", { className: "summary", value: b.summary, rows: 2 });
    summary.setAttribute("aria-label", "Beat summary (planning text, never written into the script)");
    summary.addEventListener("change", async () => {
      b.summary = summary.value;
      await invoke("put_beat", { beat: b });
    });
    const excerpt = el("p", { className: "excerpt" }, s ? (s.excerpt.length > 160 ? s.excerpt.slice(0, 157) + "…" : s.excerpt) || "(no action yet)" : "");
    excerpt.title = "Live excerpt from the script (read-only)";
    const left = el("button", { type: "button", disabled: i === 0 }, "◀");
    left.setAttribute("aria-label", "Move card earlier");
    left.addEventListener("click", () => void moveCard(view, st, b.id, order[i - 1].id, rerender));
    const right = el("button", { type: "button", disabled: i === order.length - 1 }, "▶");
    right.setAttribute("aria-label", "Move card later");
    right.addEventListener("click", () => void moveCard(view, st, b.id, order[i + 2]?.id ?? null, rerender));
    card.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/x-beat", b.id));
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer?.getData("text/x-beat");
      if (from && from !== b.id) void moveCard(view, st, from, b.id, rerender);
    });
    card.append(link, summary, excerpt, el("div", { className: "card-moves" }, left, right));
    grid.append(card);
  });
  root.replaceChildren(header, grid);
}
