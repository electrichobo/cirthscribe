import "./styles.css";
import { EditorState, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { invoke } from "@tauri-apps/api/core";
import { schema, docFromBlocks, nodeToBlock, KIND_LABEL, type Beat, type Block, type Kind } from "./schema";
import { idsPlugin } from "./ids";
import { screenplayKeymap, setKeyConfig, getKeyConfig, defaultKeyConfig } from "./keys";
import { Syncer, diff, type SyncStatus } from "./sync";
import { clipboardTextParser, clipboardTextSerializer, handlePaste, parsePlainText } from "./paste";
import { pageMarksPlugin, pageKey, buildDecorations, type PageStart } from "./pagemarks";
import { renderBoard, renderNavigator, moveCard, type BoardState } from "./views";
import { scenesOf, moveScene } from "./scenes";
import { installPerf } from "./perf";
import { adoptDomSelection, selSync } from "./selsync";
import { createHome } from "./home";

interface Opened {
  name: string;
  doc: { title: string; version: number; blocks: Block[] };
  beats: Beat[];
  recovered: boolean;
  saved_version: number;
  work_path: string;
  package_path: string;
  open_ms: number;
}
interface Paginated {
  map: { doc_version: number; pages: unknown[]; page_starts: PageStart[]; warnings: string[]; profile: string };
  load_ms: number;
  layout_ms: number;
  missing_glyphs: string[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const infoEl = $("info");
const banner = $("banner");
const navEl = $("navigator");
const boardEl = $("board");
const editorEl = $("editor");

let view: EditorView;
let syncer: Syncer;
const board: BoardState = { beats: [], structural: false };
let lastPagination: Paginated | null = null;
let lastOpen: Opened | null = null;
const perf = installPerf(editorEl);

function showBanner(msg: string | null) {
  banner.hidden = !msg;
  banner.textContent = msg ?? "";
}

function setStatus(s: SyncStatus) {
  const text = {
    saved: `Stored v${s.version}${s.at ? " at " + s.at.toLocaleTimeString() : ""}`,
    pending: `Unsynced changes (last stored v${s.version})`,
    saving: `Storing… (v${s.version})`,
    error: `NOT STORED: ${s.message}`,
  }[s.state];
  statusEl.textContent = text;
  statusEl.dataset.state = s.state;
}

function blockKindAtCursor(): string {
  const p = view.state.selection.$from.parent;
  return p.type.name === "block" ? KIND_LABEL[p.attrs.kind as Kind] : "";
}

function updateInfo() {
  const sel = view.state.selection;
  const words = (t: string) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const selText = view.state.doc.textBetween(sel.from, sel.to, " ");
  const pages = lastPagination ? `${lastPagination.map.pages.length} pages (layout of v${lastPagination.map.doc_version}, ${lastPagination.layout_ms.toFixed(1)} ms)` : "not paginated";
  const missing = lastPagination?.missing_glyphs.length ? ` · Font lacks: ${lastPagination.missing_glyphs.join(" ")} (these break fixed pitch in PDF)` : "";
  infoEl.textContent = `${blockKindAtCursor()} · selection ${words(selText)} words · ${pages}${missing}`;
}

let navTimer: number | undefined;
let pageTimer: number | undefined;

function rerenderSide() {
  renderNavigator(navEl, view);
  if (!boardEl.contains(document.activeElement) || !(document.activeElement instanceof HTMLTextAreaElement)) {
    renderBoard(boardEl, view, board, rerenderSide);
  }
}

async function repaginate() {
  const profile = ($("profile") as HTMLSelectElement).value;
  const target = syncer.currentVersion;
  try {
    const p = await invoke<Paginated>("paginate", { profile });
    lastPagination = p;
    const stale = p.map.doc_version !== syncer.currentVersion || syncer.hasUnsynced;
    view.dispatch(view.state.tr.setMeta(pageKey, buildDecorations(view.state.doc, p.map.page_starts, stale)).setMeta("addToHistory", false));
    if (p.map.warnings.length) showBanner(`Layout warnings: ${p.map.warnings.join("; ")}`);
    if (stale && target !== syncer.currentVersion) schedulePaginate();
    updateInfo();
  } catch (e) {
    showBanner(`Pagination failed: ${e}`);
  }
}

function schedulePaginate(ms = 600) {
  window.clearTimeout(pageTimer);
  pageTimer = window.setTimeout(() => void repaginate(), ms);
}

function dispatch(tr: Transaction) {
  const next = view.state.apply(tr);
  view.updateState(next);
  if (tr.docChanged) {
    syncer.changed(next.doc);
    window.clearTimeout(navTimer);
    navTimer = window.setTimeout(rerenderSide, 150);
  } else if (tr.selectionSet) {
    window.clearTimeout(navTimer);
    navTimer = window.setTimeout(() => renderNavigator(navEl, view), 150);
  }
  updateInfo();
}

function makeState(blocks: Block[]) {
  return EditorState.create({
    schema,
    doc: docFromBlocks(blocks),
    plugins: [
      idsPlugin(),
      history(),
      screenplayKeymap(() => (navEl.querySelector("button") as HTMLButtonElement | null)?.focus()),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo, "Mod-b": toggleMark(schema.marks.strong), "Mod-i": toggleMark(schema.marks.em), "Mod-u": toggleMark(schema.marks.underline) }),
      keymap(baseKeymap),
      pageMarksPlugin(),
    ],
  });
}

/** Opens a sample fixture (seeding it the first time, or again with `reset`). */
const open = (name: string, reset: boolean) => openWith("open_fixture", { name, reset });

/** Every way into the editor: samples, library projects, new projects. */
async function openWith(command: string, args: Record<string, unknown>): Promise<boolean> {
  if (syncer?.hasUnsynced) await syncer.flush();
  const t0 = performance.now();
  let o: Opened;
  try {
    o = await invoke<Opened>(command, args);
  } catch (e) {
    const msg = `Could not open project: ${e}`;
    if (document.body.dataset.view === "home") home.message(msg);
    else showBanner(msg);
    statusEl.textContent = "No project open";
    return false;
  }
  const t1 = performance.now();
  setView("editor");
  $("project-title").textContent = o.doc.title || o.name;
  board.beats = o.beats;
  const state = makeState(o.doc.blocks);
  if (view) view.updateState(state);
  else
    view = new EditorView(editorEl, {
      state,
      dispatchTransaction: (tr) => dispatch(tr),
      // Runs before the keymaps: commands see the caret the user sees.
      handleKeyDown: (v) => {
        adoptDomSelection(v);
        return false;
      },
      handlePaste: (v, event) => handlePaste(v, event),
      clipboardTextParser: (text) => clipboardTextParser(text),
      clipboardTextSerializer: (slice) => clipboardTextSerializer(slice),
      attributes: { "aria-label": "Screenplay text", spellcheck: "false" },
    });
  // Ids may have been repaired on load (should not happen for store data).
  syncer = new Syncer(view.state.doc, o.doc.version);
  syncer.onStatus = setStatus;
  syncer.onAck = () => schedulePaginate();
  setStatus({ state: "saved", version: o.doc.version });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const t2 = performance.now();
  (window as any).__cirth.openTimings = { ipcAndStoreMs: t1 - t0, rustOpenMs: o.open_ms, buildAndFirstPaintMs: t2 - t1, totalMs: t2 - t0, blocks: o.doc.blocks.length };
  showBanner(o.recovered ? `Recovered unsaved work from the working store (v${o.doc.version}; package was saved at v${o.saved_version}).` : null);
  lastOpen = o; // set last: tests treat it as "open finished"
  rerenderSide();
  void repaginate();
  view.focus();
  return true;
}

function setView(v: "home" | "editor") {
  document.body.dataset.view = v;
}

/** Save and close the open project (if any), then show the project library. */
async function goHome() {
  if (lastOpen) {
    try {
      await syncer.flush();
      await invoke("save_package");
      await invoke("close_project");
    } catch (e) {
      // Do not leave the project if it could not be saved.
      showBanner(`Could not save before closing: ${e}. The project stays open.`);
      return;
    }
    lastOpen = null;
    window.clearTimeout(pageTimer);
  }
  setView("home");
  await home.refresh();
}

const home = createHome($("home"), {
  openProject: (name) => openWith("open_project", { name }),
  openSample: (name) => open(name, false),
  createProject: (title) => openWith("create_project", { title }),
});

$("go-home").addEventListener("click", () => void goHome());
$("profile").addEventListener("change", () => void repaginate());
$("save").addEventListener("click", async () => {
  await syncer.flush();
  try {
    const v = await invoke<number>("save_package");
    statusEl.textContent = `Package saved at v${v}`;
  } catch (e) {
    showBanner(`Save failed: ${e}`);
  }
});
$("pdf").addEventListener("click", async () => {
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; pages: number; doc_version: number; layout_ms: number; pdf_ms: number; missing_glyphs: string[] }>("export_pdf", { profileName: ($("profile") as HTMLSelectElement).value });
    showBanner(`PDF proof (not production-ready) written: ${r.path} · ${r.pages} pages from v${r.doc_version} · layout ${r.layout_ms.toFixed(1)} ms, PDF ${r.pdf_ms.toFixed(1)} ms${r.missing_glyphs.length ? ` · missing glyphs: ${r.missing_glyphs.join(" ")}` : ""}`);
  } catch (e) {
    showBanner(`PDF export failed: ${e}`);
  }
});
$("zoom").addEventListener("input", (e) => {
  editorEl.style.zoom = `${(e.target as HTMLInputElement).value}%`;
});
$("structural").addEventListener("change", (e) => {
  board.structural = (e.target as HTMLInputElement).checked;
  rerenderSide();
});
window.addEventListener("beforeunload", () => void syncer?.flush());

// Test and measurement hooks (used by app/tests via the WebView DevTools protocol).
(window as any).__cirth = {
  get view() {
    return view;
  },
  get syncer() {
    return syncer;
  },
  get lastOpen() {
    return lastOpen;
  },
  get pagination() {
    return lastPagination;
  },
  board,
  perf,
  selSync,
  blocks: () => {
    const out: Block[] = [];
    view.state.doc.forEach((n) => out.push(nodeToBlock(n)));
    return out;
  },
  scenes: () => scenesOf(view.state.doc),
  moveScene: (id: string, before: string | null) => {
    const tr = moveScene(view.state, id, before);
    if (tr) view.dispatch(tr);
    return !!tr;
  },
  moveCard: (id: string, before: string | null) => moveCard(view, board, id, before, rerenderSide),
  setStructural: (on: boolean) => {
    ($("structural") as HTMLInputElement).checked = on;
    board.structural = on;
    rerenderSide();
  },
  open,
  goHome,
  home,
  flush: () => syncer.flush(),
  repaginate,
  loadStored: () => invoke<{ version: number; blocks: Block[] }>("load_document"),
  pid: () => invoke<number>("process_id"),
  diff,
  parsePlainText,
  keyConfig: { get: getKeyConfig, set: setKeyConfig, defaults: defaultKeyConfig },
};

// The app starts on Home (project library), like a project manager.
void goHome();
