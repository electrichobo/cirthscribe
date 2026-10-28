// A pop-out panel window (ADR 0004): draws one panel from the main window's
// snapshot and sends every change back to it as a command. It never changes
// the project itself.

import "./styles.css";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { renderBoard, renderNavigator, setSceneNumbers, type BoardState, type ScriptView } from "./views";
import { installLiveRegions, focusKey, restoreFocus, applyTheme, type UiPrefs } from "./a11y";
import type { PanelCommand, PanelState, PopPanel } from "./panels";
import type { SceneInfo } from "./scenes";

const panel = (new URLSearchParams(location.search).get("panel") ?? "nav") as PopPanel;
const root = document.getElementById("panel-root")!;
document.body.dataset.panel = panel;
installLiveRegions();
/** A command without its panel field (Omit applied to each member of the union). */
type Cmd = PanelCommand extends infer C ? (C extends PanelCommand ? Omit<C, "panel"> : never) : never;
const send = (c: Cmd) => void emitTo("main", "panel-command", { panel, ...c } as PanelCommand);

// Theme and contrast follow the app preference (read when the window opens).
void invoke<UiPrefs>("ui_prefs")
  .then((p) => {
    if (p.contrast === "high") document.documentElement.dataset.contrast = "high";
    applyTheme(p.theme ?? "system");
  })
  .catch(() => undefined);

let last: PanelState | null = null;
const board: BoardState = { beats: [], structural: false };

const dockButton = () => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "panel-dock";
  b.id = "panel-dock";
  b.textContent = "Dock";
  b.title = "Put this panel back in the main window";
  b.addEventListener("click", () => send({ cmd: "dock" }));
  return b;
};

const script: ScriptView = {
  scenes: () => (last?.scenes ?? []).map((s): SceneInfo => ({ ...s, from: 0, to: 0 })),
  current: () => last?.current ?? undefined,
  reveal: (sceneId) => send({ cmd: "reveal", sceneId }),
  move: (sceneId, before) => send({ cmd: "move", sceneId, before }),
  putBeat: async (beat) => send({ cmd: "putBeat", beat }),
  panelButton: () => dockButton(),
};

function draw() {
  if (!last) return;
  setSceneNumbers(new Map(last.numbers));
  const key = focusKey(root);
  if (panel === "nav") {
    renderNavigator(root, script, key?.split("|")[0]);
    send({ cmd: "rendered", items: last.scenes.length, first: last.scenes[0]?.heading ?? "" });
  } else if (panel === "board") {
    // Never rebuild a card while its text is being typed in.
    const a = document.activeElement;
    if (root.contains(a) && (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === "text"))) return;
    board.beats = last.beats;
    board.structural = last.structural;
    const body = document.createElement("div");
    const toggle = document.createElement("label");
    toggle.className = "toggle board-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "structural";
    box.checked = last.structural;
    box.addEventListener("change", () => send({ cmd: "structural", on: box.checked }));
    toggle.append(box, " Board may reorder script");
    renderBoard(body, script, board, () => undefined, key?.split("|")[0]);
    root.replaceChildren(toggle, ...body.childNodes);
    send({ cmd: "rendered", items: last.beats.length, first: last.beats[0]?.logline ?? "" });
  }
  restoreFocus(root, key);
}

function drawNotes(text: string) {
  const head = document.createElement("div");
  head.className = "panel-head";
  const h = document.createElement("h2");
  h.textContent = "Notes";
  head.append(h, dockButton());
  const area = document.createElement("textarea");
  area.id = "notes-text";
  area.setAttribute("aria-label", "Project notes");
  area.value = text;
  let timer = 0;
  const flush = () => {
    window.clearTimeout(timer);
    send({ cmd: "notes", text: area.value });
  };
  area.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 400);
  });
  area.addEventListener("blur", flush);
  window.addEventListener("beforeunload", flush);
  root.replaceChildren(head, area);
  area.focus();
  send({ cmd: "rendered", items: text ? 1 : 0, first: text.split("\n")[0] });
}

void listen<PanelState>("panel-state", (e) => {
  if (e.payload.panel !== panel) return;
  if (panel === "notes") {
    if (e.payload.notes !== undefined && !root.querySelector("#notes-text")) drawNotes(e.payload.notes);
    return;
  }
  last = e.payload;
  draw();
});

// Undo outside a text field is the script's (scene moves are script edits).
window.addEventListener("keydown", (e) => {
  const mod = navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
  const t = e.target as HTMLElement;
  if (!mod || e.altKey || t.matches("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "z" || k === "y") {
    e.preventDefault();
    send({ cmd: k === "y" || e.shiftKey ? "redo" : "undo" });
  }
});

send({ cmd: "hello" });
