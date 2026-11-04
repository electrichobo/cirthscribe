// Pop-out panels, main-window side (ADR 0004). The main window stays the
// authority for the open project: a panel window draws a snapshot sent from
// here and sends every change back as a command, which runs through the same
// functions as the panels in this window.

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { announce } from "./a11y";
import type { Beat, Storyline } from "./schema";
import type { SceneInfo } from "./scenes";
import type { NavInfo, StorylineOp } from "./views";
import type { ExportableReport, ReportFormat, ReportScope } from "./storyscry";

/** NavInfo as JSON (maps as entry lists). */
export interface NavWire {
  stats: [string, { page: string; eighths: number; position: number; characters: string[] }][];
  labels: [string, string][];
  labelNames: [string, string][];
  characters: NavInfo["characters"];
  projectScenes: NavInfo["projectScenes"];
  currentDocument: string | null;
  project: boolean;
}

export type PopPanel = "nav" | "board" | "notes" | "storyscry" | "feedback";
export const POP_LABEL: Record<PopPanel, string> = { nav: "Scene list", board: "Notecard view", notes: "Thoughts", storyscry: "StoryScry", feedback: "Feedback" };

/** What a panel window draws. */
export interface PanelState {
  panel: PopPanel;
  scenes: { sceneId: string; index: number; heading: string }[];
  current: string | null;
  numbers: [string, { number: string; omitted: boolean }][];
  beats: Beat[];
  structural: boolean;
  /** The project's storylines (Notecard View colours). */
  storylines?: Storyline[];
  /** The navigator's data (scene list window). */
  nav?: NavWire;
  /** Sent once, when the window opens (it then owns the typing). */
  notes?: string;
  /** Feedback window: the open document (it reads the feedback from the core). */
  documentId?: string | null;
  /** StoryScry window: versions, so an open report can tell it is out of date. */
  versions?: { scriptVersion: number; hasUnsynced: boolean; planningVersion: number };
}

export type PanelCommand =
  | { panel: PopPanel; cmd: "hello" }
  | { panel: PopPanel; cmd: "reveal"; sceneId: string }
  | { panel: PopPanel; cmd: "move"; sceneId: string; before: string | null }
  | { panel: PopPanel; cmd: "putBeat"; beat: Beat }
  | { panel: PopPanel; cmd: "storylineOp"; op: StorylineOp }
  | { panel: PopPanel; cmd: "structural"; on: boolean }
  | { panel: PopPanel; cmd: "notes"; text: string }
  | { panel: PopPanel; cmd: "label"; sceneId: string; label: string }
  | { panel: PopPanel; cmd: "deleteItem"; id: string }
  | { panel: PopPanel; cmd: "scope"; project: boolean }
  | { panel: PopPanel; cmd: "openElsewhere"; documentId: string; sceneId: string }
  | { panel: PopPanel; cmd: "exportReport"; scope: ReportScope; report: ExportableReport; format: ReportFormat }
  | { panel: PopPanel; cmd: "feedbackWrite"; command: string; args: Record<string, unknown> }
  | { panel: PopPanel; cmd: "jumpBlock"; blockId: string }
  | { panel: PopPanel; cmd: "undo" | "redo" | "dock" }
  | { panel: PopPanel; cmd: "rendered"; items: number; first: string };

function wire(n: NavInfo, project: boolean): NavWire {
  return { stats: [...n.stats], labels: [...n.labels], labelNames: n.labelNames, characters: n.characters, projectScenes: n.projectScenes, currentDocument: n.currentDocument, project };
}

export function createPanelHost(hooks: {
  open: () => boolean;
  scenes: () => SceneInfo[];
  current: () => string | undefined;
  numbers: () => Map<string, { number: string; omitted: boolean }>;
  beats: () => Beat[];
  structural: () => boolean;
  storylines: () => Storyline[];
  /** A storyline change from the board window (a planning step here). */
  storylineOp: (op: StorylineOp) => Promise<void>;
  setStructural: (on: boolean) => void;
  reveal: (sceneId: string) => void;
  move: (sceneId: string, before: string | null, panel: PopPanel) => void;
  putBeat: (beat: Beat, panel: PopPanel) => Promise<void>;
  deleteItem: (id: string) => void;
  notesText: () => string;
  setNotes: (text: string) => void;
  nav: () => NavInfo;
  project: () => boolean;
  setLabel: (sceneId: string, label: string) => void;
  setScope: (project: boolean) => void;
  openElsewhere: (documentId: string, sceneId: string) => void;
  undo: (redo: boolean, panel: PopPanel) => void;
  versions: () => { scriptVersion: number; hasUnsynced: boolean; planningVersion: number };
  exportReport: (scope: ReportScope, report: ExportableReport, format: ReportFormat) => void;
  /** Feedback in its own window: a change, run here (the main window stays the authority). */
  feedbackWrite: (command: string, args: Record<string, unknown>) => Promise<void>;
  jumpBlock: (blockId: string) => void;
  documentId: () => string | null;
  /** The main window's layout changed (a panel left or came back). */
  changed: () => void;
}) {
  const popped = new Set<PopPanel>();
  /** What each panel window last reported drawing (tests read it). */
  const rendered: Partial<Record<PopPanel, { items: number; first: string }>> = {};

  function state(panel: PopPanel, withNotes = false): PanelState {
    return {
      panel,
      scenes: hooks.scenes().map((s) => ({ sceneId: s.sceneId, index: s.index, heading: s.heading })),
      current: hooks.current() ?? null,
      numbers: [...hooks.numbers()].map(([id, n]) => [id, { number: n.number, omitted: n.omitted }]),
      beats: hooks.beats(),
      structural: hooks.structural(),
      storylines: hooks.storylines(),
      ...(panel === "nav" || panel === "board" ? { nav: wire(hooks.nav(), hooks.project()) } : {}),
      ...(panel === "storyscry" ? { versions: hooks.versions() } : {}),
      ...(panel === "feedback" ? { documentId: hooks.documentId() } : {}),
      ...(withNotes ? { notes: hooks.notesText() } : {}),
    };
  }

  function send(panel: PopPanel, withNotes = false) {
    void emitTo(`panel-${panel}`, "panel-state", state(panel, withNotes)).catch(() => undefined);
  }

  /** After any change to scenes, numbers or beats: every open panel window redraws. */
  function broadcast() {
    for (const p of popped) if (p !== "notes") send(p);
  }

  function mark(panel: PopPanel, on: boolean) {
    if (on) popped.add(panel);
    else popped.delete(panel);
    document.body.toggleAttribute(`data-popped-${panel}`, on);
    hooks.changed();
  }

  async function popOut(panel: PopPanel) {
    if (!hooks.open()) return;
    try {
      await invoke("pop_out_panel", { panel, title: POP_LABEL[panel] });
      mark(panel, true);
      announce(`${POP_LABEL[panel]} opened in its own window`);
    } catch (e) {
      announce(`Could not open the ${POP_LABEL[panel].toLowerCase()} window: ${e}`, true);
    }
  }

  /** Back into the main window (the panel window closes). */
  async function dock(panel: PopPanel) {
    if (!popped.has(panel)) return;
    mark(panel, false);
    await invoke("close_panel_window", { panel }).catch(() => undefined);
    announce(`${POP_LABEL[panel]} is back in the main window`);
  }

  async function dockAll() {
    for (const p of [...popped]) await dock(p);
  }

  void listen<PanelCommand>("panel-command", (e) => {
    const c = e.payload;
    if (!popped.has(c.panel) && c.cmd !== "dock") return;
    switch (c.cmd) {
      case "hello":
        send(c.panel, true);
        break;
      case "reveal":
        hooks.reveal(c.sceneId);
        break;
      case "move":
        hooks.move(c.sceneId, c.before, c.panel);
        break;
      case "storylineOp":
        void hooks.storylineOp(c.op);
        break;
      case "putBeat":
        void hooks.putBeat(c.beat, c.panel);
        break;
      case "structural":
        hooks.setStructural(c.on);
        break;
      case "notes":
        hooks.setNotes(c.text);
        break;
      case "deleteItem":
        hooks.deleteItem(c.id);
        break;
      case "label":
        hooks.setLabel(c.sceneId, c.label);
        break;
      case "scope":
        hooks.setScope(c.project);
        break;
      case "openElsewhere":
        hooks.openElsewhere(c.documentId, c.sceneId);
        break;
      case "undo":
      case "redo":
        hooks.undo(c.cmd === "redo", c.panel);
        break;
      case "exportReport":
        hooks.exportReport(c.scope, c.report, c.format);
        break;
      case "feedbackWrite":
        void hooks.feedbackWrite(c.command, c.args);
        break;
      case "jumpBlock":
        hooks.jumpBlock(c.blockId);
        break;
      case "dock":
        void dock(c.panel);
        break;
      case "rendered":
        rendered[c.panel] = { items: c.items, first: c.first };
        break;
    }
  });
  // The window was closed with its own close button: the panel comes back.
  void listen<string>("panel-closed", (e) => {
    const p = e.payload as PopPanel;
    if (popped.has(p)) {
      mark(p, false);
      announce(`${POP_LABEL[p]} is back in the main window`);
    }
  });

  return { popOut, dock, dockAll, broadcast, isPopped: (p: PopPanel) => popped.has(p), rendered, popped };
}
