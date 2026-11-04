// A pop-out panel window (ADR 0004): draws one panel from the main window's
// snapshot and sends every change back to it as a command. It never changes
// the project itself.

import "./styles.css";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { renderBoard, renderNavigator, setSceneNumbers, navUi, type BoardState, type ScriptView, type SeasonDoc } from "./views";
import { installLiveRegions, focusKey, restoreFocus, applyTheme, type UiPrefs } from "./a11y";
import type { PanelCommand, PanelState, PopPanel } from "./panels";
import type { SceneInfo } from "./scenes";
import { createStoryScry, type ReportBundle, type ReportScope } from "./storyscry";
import { createThoughtsEditor } from "./thoughts";
import { createCommentsDialog } from "./comments";

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
  nav: () => {
    const n = last?.nav;
    return {
      stats: new Map(n?.stats ?? []),
      labels: new Map(n?.labels ?? []),
      labelNames: n?.labelNames ?? [],
      characters: n?.characters ?? [],
      projectScenes: n?.projectScenes ?? [],
      beats: last?.beats ?? [],
      currentDocument: n?.currentDocument ?? null,
    };
  },
  redraw: () => draw(),
  setScope: (project) => send({ cmd: "scope", project }),
  setLabel: (sceneId, label) => send({ cmd: "label", sceneId, label }),
  deleteItem: (id) => send({ cmd: "deleteItem", id }),
  openElsewhere: (documentId, sceneId) => send({ cmd: "openElsewhere", documentId, sceneId }),
  storylineOp: async (op) => send({ cmd: "storylineOp", op }),
  season: () => invoke<SeasonDoc[]>("project_outline"),
};

function draw() {
  if (!last) return;
  setSceneNumbers(new Map(last.numbers));
  const key = focusKey(root);
  if (panel === "nav") {
    navUi.project = last.nav?.project ?? false;
    renderNavigator(root, script, key?.split("|")[0]);
    send({ cmd: "rendered", items: last.scenes.length, first: last.scenes[0]?.heading ?? "" });
  } else if (panel === "board") {
    // Never rebuild a card while its text is being typed in.
    const a = document.activeElement;
    if (root.contains(a) && (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === "text"))) return;
    board.beats = last.beats;
    board.structural = last.structural;
    board.storylines = last.storylines ?? [];
    const body = document.createElement("div");
    const toggle = document.createElement("label");
    toggle.className = "toggle board-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "structural";
    box.checked = last.structural;
    box.addEventListener("change", () => send({ cmd: "structural", on: box.checked }));
    toggle.append(box, " Notecard view may reorder script");
    renderBoard(body, script, board, () => draw(), key?.split("|")[0]);
    root.replaceChildren(toggle, ...body.childNodes);
    send({ cmd: "rendered", items: last.beats.length, first: last.beats[0]?.logline ?? "" });
  }
  restoreFocus(root, key);
}

function drawNotes(text: string) {
  const head = document.createElement("div");
  head.className = "panel-head";
  const h = document.createElement("h2");
  h.textContent = "Thoughts";
  head.append(h, dockButton());
  const box = document.createElement("div");
  box.className = "thoughts";
  root.replaceChildren(head, box);
  let timer = 0;
  const flush = () => {
    window.clearTimeout(timer);
    send({ cmd: "notes", text: editor.value });
  };
  const editor = createThoughtsEditor(box, () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 400);
  });
  editor.set(text);
  editor.dom.addEventListener("blur", flush);
  window.addEventListener("beforeunload", flush);
  editor.focus();
  send({ cmd: "rendered", items: text ? 1 : 0, first: text.split("\n")[0] });
}

// StoryScry in a window of its own: it reads the reports from the core
// directly (read-only, ADR 0004); going to a scene and exporting go through
// the main window. Closing it puts StoryScry back.
let scry: ReturnType<typeof createStoryScry> | null = null;
function drawStoryScry(state: PanelState) {
  if (!scry) {
    scry = createStoryScry({
      fetch: (scope: ReportScope) => invoke<ReportBundle>("storyscry_reports", { scope }),
      versions: () => last?.versions ?? { scriptVersion: 0, hasUnsynced: false, planningVersion: 0 },
      go: (documentId, sceneId) => send({ cmd: "openElsewhere", documentId, sceneId }),
      exportReport: async (scope, report, format) => {
        send({ cmd: "exportReport", scope, report, format });
        return null;
      },
      onClose: () => send({ cmd: "dock" }),
    });
    last = state;
    void scry.open().then(() => send({ cmd: "rendered", items: 1, first: "StoryScry" }));
  } else {
    last = state;
    scry.notifyChanged();
  }
}

// Feedback in a window of its own: it reads the feedback from the core
// directly; every change and going to the text are done by the main window
// (ADR 0004), which then sends a fresh state and the list redraws.
let feedback: ReturnType<typeof createCommentsDialog> | null = null;
let feedbackDoc: string | null = null;
function drawFeedback(state: PanelState) {
  feedbackDoc = state.documentId ?? null;
  if (!feedback) {
    feedback = createCommentsDialog({
      getView: () => null,
      getDocumentId: () => feedbackDoc,
      jumpToBlock: (blockId) => send({ cmd: "jumpBlock", blockId }),
      write: async (command, args) => send({ cmd: "feedbackWrite", command, args }),
      onClose: () => send({ cmd: "dock" }),
    });
    void feedback.open().then(() => send({ cmd: "rendered", items: document.querySelectorAll(".cirth-comment-card").length, first: "Feedback" }));
  } else void feedback.refresh().then(() => send({ cmd: "rendered", items: document.querySelectorAll(".cirth-comment-card").length, first: "Feedback" }));
}

void listen<PanelState>("panel-state", (e) => {
  if (e.payload.panel !== panel) return;
  if (panel === "feedback") return drawFeedback(e.payload);
  if (panel === "storyscry") return drawStoryScry(e.payload);
  if (panel === "notes") {
    if (e.payload.notes !== undefined && !root.querySelector(".thoughts")) drawNotes(e.payload.notes);
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
