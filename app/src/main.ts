import "./styles.css";
import { EditorState, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { schema, docFromBlocks, nodeToBlock, KIND_LABEL, type Beat, type Block, type Kind } from "./schema";
import { idsPlugin } from "./ids";
import { screenplayKeymap, setKind, setKeyConfig, getKeyConfig, defaultKeyConfig } from "./keys";
import { Syncer, diff, type SyncStatus } from "./sync";
import { clipboardTextParser, clipboardTextSerializer, handlePaste, insertBlocks, parsePlainText } from "./paste";
import { pageMarksPlugin, pageKey, buildDecorations, type PageStart } from "./pagemarks";
import { sceneNumbersPlugin, sceneNumbersKey, buildSceneNumberDecorations, type SceneNumber } from "./scenenums";
import { confirmDialog } from "./confirm";
import { renderBoard, renderNavigator, moveCard, type BoardState, setSceneNumbers, sceneAtCursor } from "./views";
import { scenesOf, moveScene } from "./scenes";
import { installPerf } from "./perf";
import { adoptDomSelection, selSync } from "./selsync";
import { createHome } from "./home";
import { findPlugin, findState, matchesIn } from "./find";
import { installFindBar } from "./findbar";
import { completePlugin, suggestion } from "./complete";
import { installSpell, spellPlugin } from "./spell";
import { dualPlugin, toggleDual, togglePageBreak } from "./format";
import { createFreeWriting } from "./freewrite";
import { createAbout } from "./about";
import { createLatency } from "./latency";
import { createFocusMode } from "./focus";
import { createViewMenu } from "./viewmenu";
import { createFormatBar } from "./formatbar";
import { icon, iconButton, iconSelect } from "./icons";
import { createLayoutMode } from "./layout-mode";
import { createTitlePageDialog } from "./titlepage";
import { createFurnitureDialog } from "./furniture";
import { createExportDialog, type ExportFormat } from "./exportdlg";
import { createGoToDialog } from "./goto";
import { createShortcutsDialog } from "./shortcuts";
import { createRevisions, revisionsPlugin } from "./revisions";
import { usedPointer, announce, installLiveRegions, loadPrefs, stepScale, toggleContrast, togglePanel, toggleTypewriter, setScreenFont, setScreenSize, stepScreenSize, onPanelsChanged, SCREEN_FONTS, type ScreenFont, cycleRegions, focusRegion, focusKey, restoreFocus, currentPrefs } from "./a11y";

interface Opened {
  name: string;
  doc: { title: string; version: number; blocks: Block[] };
  beats: Beat[];
  recovered: boolean;
  migrated_from: number | null;
  pre_migration_backup: string | null;
  saved_version: number;
  work_path: string;
  package_path: string;
  open_ms: number;
  /** What an import changed or could not keep. */
  import_notes: string[];
}
interface Paginated {
  map: { doc_version: number; pages: unknown[]; page_starts: PageStart[]; warnings: string[]; profile: string };
  load_ms: number;
  layout_ms: number;
  scene_numbers: SceneNumber[];
  scene_numbers_locked: boolean;
  /** Laid out against a locked page baseline (labels such as 12A, 11-12). */
  pages_locked: boolean;
  missing_glyphs: string[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const infoEl = $("info");
const banner = $("banner");
const navEl = $("navigator");
const boardEl = $("board");
const boardBody = $("board-body");
const editorEl = $("editor");

let view: EditorView;
let syncer: Syncer;
const board: BoardState = { beats: [], structural: false };
let lastPagination: Paginated | null = null;
let sceneNumbers = new Map<string, SceneNumber>();
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
  // The status line is not a live region (it changes on every keystroke);
  // only a failure is announced, once.
  if (s.state === "error" && statusEl.dataset.state !== "error") announce(text, true);
  statusEl.textContent = text;
  statusEl.dataset.state = s.state;
}

function blockKindAtCursor(): string {
  const p = view.state.selection.$from.parent;
  return p.type.name === "block" ? KIND_LABEL[p.attrs.kind as Kind] : "";
}

// Word counts use one rule, in Rust (cirth_core::words): the same numbers
// in the footer and in reports. Block and selection are counted from the
// editor's text; the script total from the store (as of the last sync).
interface DocCounts {
  total: number;
  by_kind: Record<string, number>;
  doc_version: number;
}
let liveCounts = { block: 0, selection: 0 };
let countedBlockStart = -1; // block the live count belongs to
let docCounts: DocCounts | null = null;
let countTimer: number | undefined;

function scheduleCounts(withDocument = false) {
  window.clearTimeout(countTimer);
  countTimer = window.setTimeout(async () => {
    if (!view || !lastOpen) return;
    const sel = view.state.selection;
    const blockText = sel.$from.parent.type.name === "block" ? sel.$from.parent.textContent : "";
    const selText = sel.empty ? "" : view.state.doc.textBetween(sel.from, sel.to, " ");
    try {
      const start = sel.$from.start();
      const [block, selection] = await invoke<number[]>("count_words", { texts: [blockText, selText] });
      liveCounts = { block, selection };
      countedBlockStart = start;
      if (withDocument) docCounts = await invoke<DocCounts>("word_counts");
    } catch {
      // Counting is informational; never interrupt writing for it.
    }
    updateInfo();
  }, 150);
}

function updateInfo() {
  const sel = view.state.selection;
  const n = (v: number) => v.toLocaleString();
  // Until the count for the block under the caret arrives, show "…" rather
  // than the previous block's number.
  const fresh = sel.$from.start() === countedBlockStart;
  const counts = [`block ${fresh ? n(liveCounts.block) : "…"} words`];
  if (!sel.empty) counts.push(`selection ${n(liveCounts.selection)}`);
  if (docCounts) {
    const k = docCounts.by_kind;
    counts.push(`script ${n(docCounts.total)} (dialogue ${n(k.dialogue ?? 0)}, action ${n(k.action ?? 0)})`);
  }
  const locked = lastPagination?.pages_locked ? ", pages locked" : "";
  const pages = lastPagination ? `${lastPagination.map.pages.length} pages (layout of v${lastPagination.map.doc_version}, ${lastPagination.layout_ms.toFixed(1)} ms${locked})` : "not paginated";
  const missing = lastPagination?.missing_glyphs.length ? ` · Font lacks: ${lastPagination.missing_glyphs.join(" ")} (these break fixed pitch in PDF)` : "";
  infoEl.textContent = `${blockKindAtCursor()} · ${counts.join(" · ")} · ${pages}${missing}`;
}

let navTimer: number | undefined;
let pageTimer: number | undefined;

function rerenderSide() {
  renderNav();
  // Never rebuild a card while its logline or summary is being typed in:
  // the unsaved text would be replaced by the stored value.
  const a = document.activeElement;
  const typing = a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === "text");
  if (!boardEl.contains(a) || !typing) {
    const key = focusKey(boardEl);
    renderBoard(boardBody, view, board, rerenderSide, key?.split("|")[0]);
    restoreFocus(boardEl, key);
  }
}

/** Re-render the navigator, keeping keyboard focus on the same scene. */
function renderNav() {
  const key = focusKey(navEl);
  renderNavigator(navEl, view, key?.split("|")[0]);
  restoreFocus(navEl, key);
}

async function repaginate() {
  const profile = ($("profile") as HTMLSelectElement).value;
  const target = syncer.currentVersion;
  try {
    const p = await invoke<Paginated>("paginate", { profile });
    lastPagination = p;
    const stale = p.map.doc_version !== syncer.currentVersion || syncer.hasUnsynced;
    const changed = JSON.stringify([...sceneNumbers.values()]) !== JSON.stringify(p.scene_numbers.slice().sort((a, b) => a.scene_id.localeCompare(b.scene_id)));
    sceneNumbers = new Map(p.scene_numbers.slice().sort((a, b) => a.scene_id.localeCompare(b.scene_id)).map((n) => [n.scene_id, n]));
    setSceneNumbers(sceneNumbers);
    view.dispatch(
      view.state.tr
        .setMeta(pageKey, buildDecorations(view.state.doc, p.map.page_starts, stale))
        .setMeta(sceneNumbersKey, buildSceneNumberDecorations(view.state.doc, sceneNumbers))
        .setMeta("addToHistory", false),
    );
    if (changed) rerenderSide();
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
  const before = view.state.selection.$from.parent;
  const next = view.state.apply(tr);
  view.updateState(next);
  formatBar.update(next);
  if (!tr.getMeta("pointer") && (tr.docChanged || tr.selectionSet)) centreTypingLine();
  const after = next.selection.$from.parent;
  if (after.type.name === "block" && before.type.name === "block" && after.attrs.id === before.attrs.id && after.attrs.kind !== before.attrs.kind) {
    announce(KIND_LABEL[after.attrs.kind as Kind]);
  }
  if (tr.docChanged) {
    syncer.changed(next.doc);
    findBar.refreshCount();
    spell.schedule();
    window.clearTimeout(navTimer);
    navTimer = window.setTimeout(rerenderSide, 150);
  } else if (tr.selectionSet) {
    window.clearTimeout(navTimer);
    navTimer = window.setTimeout(renderNav, 150);
  }
  if (tr.docChanged || tr.selectionSet) scheduleCounts();
  updateInfo();
}

function makeState(blocks: Block[]) {
  return EditorState.create({
    schema,
    doc: docFromBlocks(blocks),
    plugins: [
      idsPlugin(),
      history(),
      // Before the screenplay keymap: Tab/Enter accept a suggestion when one is open.
      completePlugin(),
      // Escape: leave focus mode, else go to the scene list (or the board if the list is hidden).
      screenplayKeymap(() => void (focusMode.on ? focusMode.leave() : focusRegion(navEl) || focusRegion(boardEl))),
      keymap({ "Mod-d": toggleDual(showBanner), "Mod-Enter": togglePageBreak }),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo, "Mod-b": toggleMark(schema.marks.strong), "Mod-i": toggleMark(schema.marks.em), "Mod-u": toggleMark(schema.marks.underline) }),
      keymap(baseKeymap),
      pageMarksPlugin(),
      sceneNumbersPlugin(),
      findPlugin(),
      spellPlugin(),
      dualPlugin(),
      revisionsPlugin(),
    ],
  });
}

/** Opens a sample fixture (seeding it the first time, or again with `reset`). */
const open = (name: string, reset: boolean) => openWith("open_fixture", { name, reset });

/** Every way into the editor: samples, library projects, new projects. */
async function openWith(command: string, args: Record<string, unknown>): Promise<boolean> {
  // Switching projects: write the current one's file first, as going Home does.
  if (lastOpen) {
    try {
      await saveFile(false);
    } catch (e) {
      showBanner(`Could not save this project before opening another: ${e}. It stays open.`);
      return false;
    }
  }
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
  $("find-bar").hidden = true; // a new editor state has no search
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
      handleDOMEvents: { contextmenu: (v, e) => spell.onContextMenu(v, e as MouseEvent) },
      clipboardTextParser: (text) => clipboardTextParser(text),
      clipboardTextSerializer: (slice) => clipboardTextSerializer(slice),
      attributes: { "aria-label": "Screenplay text", "aria-multiline": "true", "aria-describedby": "editor-hint", spellcheck: "false" },
    });
  // Ids may have been repaired on load (should not happen for store data).
  syncer = new Syncer(view.state.doc, o.doc.version);
  syncer.onStatus = setStatus;
  await revisions.refresh().catch(() => undefined);
  syncer.onAck = () => {
    schedulePaginate();
    scheduleCounts(true);
  };
  docCounts = null;
  scheduleCounts(true);
  void spell.onOpen($("spelling") as HTMLSelectElement).then(syncMenuChecks);
  // Page size is stored per document; pagination, PDF and text use it.
  ($("profile") as HTMLSelectElement).value = await invoke<string>("document_profile").catch(() => "letter");
  syncMenuChecks();
  setStatus({ state: "saved", version: o.doc.version });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const t2 = performance.now();
  (window as any).__cirth.openTimings = { ipcAndStoreMs: t1 - t0, rustOpenMs: o.open_ms, buildAndFirstPaintMs: t2 - t1, totalMs: t2 - t0, blocks: o.doc.blocks.length };
  const notes: string[] = [];
  if (o.recovered) notes.push(`Recovered unsaved work from the working store (v${o.doc.version}; the file was saved at v${o.saved_version}).`);
  if (o.import_notes?.length) notes.push(`Imported. ${o.import_notes.join(" ")}`);
  if (o.migrated_from) notes.push(`Upgraded this project from file format ${o.migrated_from} to the current format. The original file is kept unchanged at ${o.pre_migration_backup ?? "(no copy kept)"}; the project file is written in the new format at the next save.`);
  showBanner(notes.length ? notes.join(" ") : null);
  fileSavedVersion = o.saved_version;
  fileSavedAt = null;
  scheduleAutosave();
  lastOpen = o; // set last: tests treat it as "open finished"
  showFileStatus();
  rerenderSide();
  void repaginate();
  view.focus();
  return true;
}

function setView(v: "home" | "editor" | "free") {
  document.body.dataset.view = v;
}

async function openFreeWriting() {
  await focusMode.leave();
  setView("free");
  await free.show();
}

// --- Saving the project file -------------------------------------------------
// Every edit is durable in the working store once acknowledged. The project
// file (.cirth) is written from it: on Save, on Home, on window close, and by
// autosave when the store has moved past the last file save.

let fileSavedVersion = 0;
let fileSavedAt: Date | null = null;
let saving: Promise<void> | null = null;
let autosaveMs = 60_000;
let autosaveTimer: number | undefined;
const fileStatusEl = $("file-status");

function showFileStatus() {
  fileStatusEl.textContent = !lastOpen
    ? ""
    : fileSavedAt
      ? `File saved v${fileSavedVersion} at ${fileSavedAt.toLocaleTimeString()}`
      : `File at v${fileSavedVersion}`;
}

interface Saved {
  version: number;
  backups: number;
  path: string;
  name: string;
  conflict: string | null;
  other: string | null;
  recreated: boolean;
}

/** After any file write: track where the project lives and report surprises. */
function afterWrite(r: Saved) {
  fileSavedVersion = r.version;
  fileSavedAt = new Date();
  outsideWarned = false;
  if (lastOpen) {
    lastOpen.name = r.name;
    lastOpen.package_path = r.path;
  }
  showFileStatus();
  if (r.conflict) {
    showBanner(`This project's file was changed outside Kolbítar since you opened it. To keep both, your version was saved as ${r.conflict}, and the other version is unchanged at ${r.other}. You are now editing ${r.conflict}.`);
  } else if (r.recreated) {
    showBanner(`The project file was missing (moved or deleted outside Kolbítar), so it was written again at ${r.path}.`);
  }
}

/** Flush pending edits, then write the project file. Throws on failure. */
async function saveFile(explicit: boolean): Promise<void> {
  while (saving) await saving;
  saving = (async () => {
    await syncer.flush();
    afterWrite(await invoke<Saved>("save_package", { explicit }));
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
}

/** Write the project to another file and continue there. */
async function saveAs(path?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const target =
    path ??
    (await saveDialog({ defaultPath: lastOpen.package_path, filters: [{ name: "Kolbítar project", extensions: ["cirth"] }] }));
  if (!target) return false;
  while (saving) await saving;
  saving = (async () => {
    await syncer.flush();
    afterWrite(await invoke<Saved>("save_as", { path: target }));
  })();
  try {
    await saving;
    showBanner(`Saved as ${lastOpen.package_path}. The previous file keeps its last saved state.`);
    return true;
  } catch (e) {
    showBanner(`Save As failed: ${e}. Nothing changed; your edits are kept in the recovery store.`);
    return false;
  } finally {
    saving = null;
  }
}

// Outside changes: warn as soon as we notice (window focus, autosave tick),
// before any save turns it into a conflict copy.
let outsideWarned = false;
async function checkOutside(): Promise<{ changed: boolean; missing: boolean; path: string } | null> {
  if (!lastOpen) return null;
  try {
    const c = await invoke<{ changed: boolean; missing: boolean; path: string }>("check_outside_change");
    if ((c.changed || c.missing) && !outsideWarned) {
      outsideWarned = true;
      showBanner(
        c.missing
          ? `The project file is no longer at ${c.path} (moved or deleted outside Kolbítar). Your edits are safe; the next save writes it again.`
          : `The project file ${c.path} was changed outside Kolbítar. It will not be overwritten: your next save goes to a separate "(conflict …)" copy beside it.`,
      );
    }
    return c;
  } catch {
    return null;
  }
}
window.addEventListener("focus", () => void checkOutside());

function scheduleAutosave() {
  window.clearInterval(autosaveTimer);
  autosaveTimer = window.setInterval(() => {
    if (!lastOpen || saving) return;
    void checkOutside();
    if (syncer.currentVersion <= fileSavedVersion) return;
    saveFile(false).catch((e) => showBanner(`Autosave of the project file failed: ${e}. Your edits are still kept in the recovery store.`));
  }, autosaveMs);
}

// Closing the window: save the file first. If that fails, keep the window
// open once and say so; a second close quits (edits stay recoverable).
let closeFailedOnce = false;
void getCurrentWindow().onCloseRequested(async (event) => {
  await free.flush().catch(() => {});
  if (!lastOpen || closeFailedOnce) return;
  try {
    await saveFile(false);
  } catch (e) {
    event.preventDefault();
    closeFailedOnce = true;
    showBanner(`Could not save the project file before closing: ${e}. Your edits are kept in the recovery store. Close again to quit anyway.`);
  }
});

/** Save and close the open project (if any), then show the project library. */
async function goHome() {
  await focusMode.leave();
  if (lastOpen) {
    try {
      await saveFile(false);
      await invoke("close_project");
    } catch (e) {
      // Do not leave the project if it could not be saved.
      showBanner(`Could not save before closing: ${e}. The project stays open.`);
      return;
    }
    lastOpen = null;
    window.clearTimeout(pageTimer);
    window.clearInterval(autosaveTimer);
    showFileStatus();
  }
  setView("home");
  await home.refresh();
}

const findBar = installFindBar($("find-bar"), () => view, showBanner);
const spell = installSpell(() => view, showBanner);
$("spelling").addEventListener("change", (e) => void spell.setLang((e.target as HTMLSelectElement).value).finally(syncMenuChecks));

/** The native menu's check marks for this document's page size and spelling. */
function syncMenuChecks() {
  const page = ($("profile") as HTMLSelectElement).value;
  const lang = ($("spelling") as HTMLSelectElement).value;
  void invoke("set_menu_checks", {
    checks: { revision_mode: revisions.state.mode, page_letter: page === "letter", page_a4: page === "a4", spell_en_US: lang === "en_US", spell_en_GB: lang === "en_GB", spell_off: lang === "off" },
  }).catch(() => undefined);
}

/** Choose a value in one of the toolbar's dropdowns as if the user had. */
function chooseOption(id: string, value: string) {
  const sel = $(id) as HTMLSelectElement;
  if (sel.value !== value) {
    sel.value = value;
    sel.dispatchEvent(new Event("change"));
  } else syncMenuChecks();
}

// View mode is a personal display preference (not stored in projects).
function setViewMode(mode: string) {
  document.body.dataset.pageview = mode === "pages" ? "pages" : "continuous";
  ($("view-mode") as HTMLSelectElement).value = document.body.dataset.pageview;
  const pages = mode === "pages";
  void invoke("set_menu_checks", { checks: { mode_normal: !pages, mode_page: pages } }).catch(() => undefined);
  try {
    localStorage.setItem("cirth.viewMode", document.body.dataset.pageview);
  } catch {
    // storage unavailable: the choice lasts for this session
  }
}
$("view-mode").addEventListener("change", (e) => setViewMode((e.target as HTMLSelectElement).value));
try {
  setViewMode(localStorage.getItem("cirth.viewMode") ?? "continuous");
} catch {
  setViewMode("continuous");
}

const free = createFreeWriting($("freewrite"), {
  back: () => {
    if (lastOpen) {
      setView("editor");
      view.focus();
    } else {
      setView("home");
      void home.refresh();
    }
  },
  projectOpen: () => !!lastOpen,
  insertIntoProject: async (paras) => {
    if (!view || !lastOpen) return false;
    view.focus();
    const nodes = paras.map((p) => schema.nodes.block.create({ kind: "action" }, schema.text(p)));
    return insertBlocks(view, nodes);
  },
  notify: (m) => showBanner(m),
});
$("go-free").addEventListener("click", () => void openFreeWriting());
$("open-title-page").addEventListener("click", () => void runMenu("title_page"));

const about = createAbout();
// Title page fields are settings, not versioned edits, so write the file now
// (as a page-size change does) instead of waiting for autosave.
const titlePage = createTitlePageDialog(() => saveFile(false));
const furniture = createFurnitureDialog(() => saveFile(false));
const exportDialog = createExportDialog({ hasActiveRevision: () => !!revisions.state.active, run: (f) => exportAs(f) });
const goTo = createGoToDialog({ view: () => (view && lastOpen ? view : null), starts: () => lastPagination?.map.page_starts ?? [], numbers: () => sceneNumbers });
const shortcuts = createShortcutsDialog();
const revisions = createRevisions(() => view ?? null, () => {
  syncMenuChecks();
  void repaginate();
  void saveFile(false).catch(() => undefined);
});
const formatBar = createFormatBar($("format-island"), () => view, /Mac/i.test(navigator.userAgent));
// Screen font and size: on screen only (pages and exports keep Courier Prime 12 pt).
{
  const island = $("format-island");
  const font = document.createElement("select");
  font.id = "screen-font";
  font.setAttribute("aria-label", "Screen font");
  font.title = "Font of the script on screen only. Pages, PDF and exports always use Courier Prime 12 pt; Pages view shows that too.";
  for (const [k, f] of Object.entries(SCREEN_FONTS)) font.append(new Option(f.label, k));
  font.addEventListener("change", () => void setScreenFont(font.value as ScreenFont));
  const size = document.createElement("select");
  size.id = "screen-size";
  size.setAttribute("aria-label", "Screen text size");
  size.title = "Size of the script text on screen only";
  for (let pt = 10; pt <= 20; pt++) size.append(new Option(`${pt} pt`, String(pt)));
  size.addEventListener("change", () => void setScreenSize(Number(size.value)));
  const fontWrap = iconSelect("font", font);
  island.append(fontWrap, size);
  const show = () => {
    const p = currentPrefs();
    font.value = p.editor_font;
    fontWrap.dataset.value = p.editor_font;
    size.value = String(p.editor_size);
  };
  onPanelsChanged(show);
  show();
}
const focusMode = createFocusMode(() => view?.focus());
createViewMenu($("view-menu-btn") as HTMLButtonElement, () => void focusMode.toggle(), () => void toggleTypewriter().then(centreTypingLine), $("more-settings"));
// Narrow windows: side panels shrink, then float over the script (layout-mode.ts).
let showPanelButtons = () => {};
const layoutMode = createLayoutMode({
  zoom: () => Number(($("zoom") as HTMLInputElement).value) / 100,
  panes: document.querySelector<HTMLElement>(".panes")!,
  panels: { nav: navEl, board: boardEl },
  onChange: () => showPanelButtons(),
  focusScript: () => view?.focus(),
});
// The island's own buttons: Home, undo/redo, panel toggles, find, focus mode.
{
  const mod = /Mac/i.test(navigator.userAgent) ? "Cmd" : "Ctrl";
  // Buttons that act on the script must not take focus from it.
  const keepFocus = (b: HTMLButtonElement) => (b.addEventListener("mousedown", (e) => e.preventDefault()), b);
  const homeBtn = iconButton("go-home", "home", "Home", "Save, close this project and return to the project library");
  homeBtn.addEventListener("click", () => void goHome());
  const undoBtn = keepFocus(iconButton("tool-undo", "undo", "Undo", `Undo (${mod}+Z)`));
  undoBtn.addEventListener("click", () => {
    if (!view) return;
    undo(view.state, view.dispatch);
    if (usedPointer()) view.focus();
  });
  const redoBtn = keepFocus(iconButton("tool-redo", "redo", "Redo", `Redo (${mod}+Shift+Z)`));
  redoBtn.addEventListener("click", () => {
    if (!view) return;
    redo(view.state, view.dispatch);
    if (usedPointer()) view.focus();
  });
  $("island-nav").append(homeBtn, undoBtn, redoBtn);
  const navBtn = iconButton("toggle-nav", "scenes", "Scene list", "Show or hide the scene list");
  // In the floating layout these open the panel over the script instead.
  navBtn.addEventListener("click", () => (layoutMode.mode === "overlay" && currentPrefs().panels.nav ? layoutMode.toggleFloat("nav") : void togglePanel("nav")));
  const boardBtn = iconButton("toggle-board", "board", "Board", "Show or hide the board");
  boardBtn.addEventListener("click", () => (layoutMode.mode === "overlay" && currentPrefs().panels.board ? layoutMode.toggleFloat("board") : void togglePanel("board")));
  const findBtn = iconButton("tool-find", "find", "Find and replace", `Find and replace (${mod}+F)`);
  findBtn.addEventListener("click", () => {
    if (lastOpen) findBar.open();
  });
  const focusBtn = iconButton("tool-focus", "focus", "Focus mode", `Focus mode: only the script, full screen (${mod}+Shift+F)`);
  focusBtn.addEventListener("click", () => void focusMode.toggle());
  // Comments come with M5 (anchored threads). Until then the button only says
  // so (owner, 2026-10-28): it changes nothing.
  const commentBtn = iconButton("tool-comments", "comment", "Comments (not available yet)", "Comments: coming in a later version");
  commentBtn.setAttribute("aria-disabled", "true");
  commentBtn.classList.add("placeholder");
  commentBtn.addEventListener("click", () => showBanner("Comments are not built yet: they come in a later version (milestone 5). Nothing was changed."));
  $("island-panels").append(navBtn, boardBtn, findBtn, commentBtn, focusBtn);
  ($("view-menu-btn") as HTMLButtonElement).append(icon("more"));
  const showPressed = () => {
    const overlay = layoutMode.mode === "overlay";
    navBtn.setAttribute("aria-pressed", String(overlay ? layoutMode.isFloating("nav") : currentPrefs().panels.nav));
    boardBtn.setAttribute("aria-pressed", String(overlay ? layoutMode.isFloating("board") : currentPrefs().panels.board));
  };
  showPanelButtons = showPressed;
  onPanelsChanged(showPressed);
  showPressed();
  // Toolbar keys (WAI-ARIA toolbar pattern): Left/Right/Home/End move along
  // the island. On a dropdown they move too instead of changing its value;
  // Up/Down (or Space) still open it.
  const island = $("island");
  island.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const stops = [...island.querySelectorAll<HTMLElement>("button, select")].filter((c) => c.getClientRects().length && !(c as HTMLButtonElement).disabled);
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const n = stops.length;
    const to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (at + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
    stops[to].focus();
  });
}
// Escape leaves focus mode wherever focus is (the editor's own Escape key
// handles it first and marks the event handled).
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && focusMode.on && !e.defaultPrevented && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    void focusMode.leave();
  }
});
const latency = createLatency(
  perf,
  () => (window as any).__cirth.openTimings,
  () => (lastOpen ? `"${lastOpen.doc.title || lastOpen.name}", ${view.state.doc.childCount} blocks, ${lastPagination ? `${lastPagination.map.pages.length} pages` : "not paginated"}` : "no project open"),
);
const home = createHome($("home"), {
  openPath: (path) => openWith("open_path", { path }),
  restoreBackup: (path) => openWith("restore_backup", { path }),
  openSample: (name) => open(name, false),
  openFreeWriting: () => void openFreeWriting(),
  openAbout: () => void about.open(),
  createProject: (title) => openWith("create_project", { title }),
});

$("profile").addEventListener("change", async (e) => {
  const sel = e.target as HTMLSelectElement;
  try {
    sel.value = await invoke<string>("set_document_profile", { profile: sel.value });
    await saveFile(false);
  } catch (err) {
    showBanner(`Could not change the page size: ${err}`);
    sel.value = await invoke<string>("document_profile").catch(() => sel.value);
  }
  syncMenuChecks();
  await repaginate();
});
async function saveNow() {
  try {
    await saveFile(true);
    announce("Saved");
  } catch (e) {
    showBanner(`Save failed: ${e}. Your edits are still kept in the recovery store.`);
  }
}

/** Open a project file through the system dialog (from Home or the editor). */
async function openViaDialog(): Promise<boolean> {
  const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Kolbítar project", extensions: ["cirth"] }] });
  return typeof path === "string" ? openWith("open_path", { path }) : false;
}

// Shortcuts: handled here, not as OS menu accelerators, so they work the same
// on every platform and can be exercised by the test drivers.
const isMac = /Mac/i.test(navigator.userAgent);

/** Typewriter mode: keep the caret's line at the middle of the script area.
 *  Not after mouse clicks (the text would jump under the pointer). The
 *  padding in styles.css lets the first and last lines reach the middle. */
function centreTypingLine() {
  if (!currentPrefs().typewriter || !view?.hasFocus()) return;
  const scroller = view.dom.closest(".editor-wrap") as HTMLElement | null;
  if (!scroller) return;
  const caret = view.coordsAtPos(view.state.selection.head);
  const box = scroller.getBoundingClientRect();
  const delta = (caret.top + caret.bottom) / 2 - (box.top + scroller.clientHeight / 2);
  if (Math.abs(delta) > 1) scroller.scrollTop += delta;
}

/** Focus is in the scene list or the board, but not in a text field. */
function inPanelNotField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (navEl.contains(el) || boardEl.contains(el)) && !el.closest("textarea, input, [contenteditable]");
}

/** The regions F6 moves between in the current view, in reading order. */
function regions(): HTMLElement[] {
  const v = document.body.dataset.view;
  const q = (s: string) => document.querySelector<HTMLElement>(s);
  const list = v === "home" ? [q(".home-side"), q(".home-main")] : v === "free" ? [q(".fw-side"), q(".fw-main")] : [q(".toolbar"), navEl, q(".editor-wrap"), boardEl];
  return list.filter((r): r is HTMLElement => !!r);
}
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F6" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      cycleRegions(regions(), e.shiftKey);
    } else if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      void toggleFullScreen();
    }
  },
  true,
);
window.addEventListener(
  "keydown",
  (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey || e.isComposing) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      if (lastOpen) void (e.shiftKey ? saveAs() : saveNow());
    } else if (k === "." && !e.shiftKey) {
      e.preventDefault();
      if (lastOpen) spell.menuAtCaret();
    } else if (k === "f" && !e.shiftKey) {
      e.preventDefault();
      if (lastOpen) findBar.open();
    } else if (k === "f" && e.shiftKey) {
      e.preventDefault();
      if (lastOpen) void focusMode.toggle();
    } else if (k === "t" && e.shiftKey) {
      e.preventDefault();
      void toggleTypewriter().then(centreTypingLine);
    } else if (k === "o" && !e.shiftKey) {
      e.preventDefault();
      void openViaDialog();
    } else if (k === "e" && !e.shiftKey) {
      e.preventDefault();
      if (lastOpen) exportDialog.open();
    } else if (k === "g") {
      e.preventDefault();
      if (lastOpen) goTo.open(e.shiftKey ? "scene" : "page");
    } else if (k === "=" || k === "+" || k === "-" || k === "0") {
      e.preventDefault();
      void stepScale(k === "0" ? 0 : k === "-" ? -1 : 1);
    } else if ((k === "z" || (k === "y" && !isMac)) && view && lastOpen && inPanelNotField(e.target)) {
      // Undo/redo from the scene list or the board: the script's one undo
      // history (structural moves are script changes). Text fields such as a
      // beat summary keep their own undo. Planning-only card moves are not
      // script changes and are not in the history.
      e.preventDefault();
      const again = k === "y" || e.shiftKey;
      const done = (again ? redo : undo)(view.state, view.dispatch);
      announce(done ? (again ? "Redone" : "Undone") : again ? "Nothing to redo" : "Nothing to undo");
    }
  },
  true,
);

/** Native menu choices (and tests) run the same actions as the buttons. */
async function runMenu(id: string): Promise<void> {
  if (id.startsWith("color_") || id.startsWith("highlight_")) {
    const [kind, value] = id.split("_");
    if (view && lastOpen) formatBar.apply(kind === "color" ? schema.marks.color : schema.marks.highlight, value === "none" ? null : value);
    return;
  }
  if (id.startsWith("kind_")) {
    if (view && lastOpen) {
      setKind(id.slice(5) as Kind)(view.state, view.dispatch);
      view.focus();
    }
    return;
  }
  switch (id) {
    case "new":
      await goHome();
      ($("new-title") as HTMLInputElement).focus();
      break;
    case "open":
      await openViaDialog();
      break;
    case "save":
      if (lastOpen) await saveNow();
      break;
    case "save_as":
      if (lastOpen) await saveAs();
      break;
    case "export_pdf":
      await exportPdf();
      break;
    case "export_changed_pdf":
      await exportPdf(undefined, true);
      break;
    case "revision_mode":
      if (lastOpen) await revisions.setMode(!revisions.state.mode);
      syncMenuChecks();
      break;
    case "revision_sets":
      if (lastOpen) await revisions.open();
      break;
    case "revision_clear":
      if (lastOpen) await revisions.clearActive();
      break;
    case "import":
      await importAny();
      break;
    case "export":
      if (lastOpen) exportDialog.open();
      break;
    case "mode_normal":
    case "mode_page":
      setViewMode(id === "mode_page" ? "pages" : "continuous");
      break;
    case "full_screen":
      await toggleFullScreen();
      break;
    case "goto_page":
    case "goto_scene":
      if (lastOpen) goTo.open(id === "goto_page" ? "page" : "scene");
      break;
    case "win_minimize":
    case "win_zoom":
      await invoke("window_command", { action: id.slice(4) === "zoom" ? "zoom" : "minimize" }).catch((e) => showBanner(`Window: ${e}`));
      break;
    case "shortcuts":
      shortcuts.open();
      break;
    case "updates":
      try {
        await invoke("open_releases_page");
        showBanner("The releases page is opening in your browser. Kolbítar never checks for updates by itself.");
      } catch (e) {
        showBanner(`Could not open the releases page (https://github.com/electrichobo/cirthscribe/releases): ${e}`);
      }
      break;
    case "licences":
      await about.open("gpl");
      break;
    case "import_fountain":
      await importFountain();
      break;
    case "export_fountain":
      await exportFountain();
      break;
    case "import_fdx":
      await importFdx();
      break;
    case "export_fdx":
      await exportFdx();
      break;
    case "export_docx":
    case "export_rtf":
    case "export_html":
      await exportDocument(id.slice(7) as "docx" | "rtf" | "html");
      break;
    case "export_txt":
      await exportText();
      break;
    case "home":
      await goHome();
      break;
    case "quit":
      await getCurrentWindow().close();
      break;
    case "find":
      if (lastOpen) findBar.open();
      break;
    case "dual":
      if (view && lastOpen) toggleDual(showBanner)(view.state, view.dispatch);
      break;
    case "page_break":
      if (view && lastOpen) togglePageBreak(view.state, view.dispatch);
      break;
    case "undo":
      if (view) undo(view.state, view.dispatch);
      break;
    case "redo":
      if (view) redo(view.state, view.dispatch);
      break;
    case "about":
      await about.open();
      break;
    case "latency":
      await latency.open();
      break;
    case "ui_larger":
      await stepScale(1);
      break;
    case "ui_smaller":
      await stepScale(-1);
      break;
    case "ui_reset":
      await stepScale(0);
      break;
    case "ui_contrast":
      await toggleContrast();
      break;
    case "focus_next":
      cycleRegions(regions(), false);
      break;
    case "pages_lock":
    case "pages_unlock":
      if (lastOpen) await pageLockAction(id);
      break;
    case "scenes_lock":
    case "scenes_unlock":
    case "scene_omit":
    case "scene_restore":
      if (lastOpen) await sceneNumbersAction(id);
      break;
    case "title_page":
      if (lastOpen) await titlePage.open();
      break;
    case "page_furniture":
      if (lastOpen) await furniture.open();
      break;
    case "free_writing":
      await openFreeWriting();
      break;
    case "bold":
    case "italic":
    case "underline":
      if (view && lastOpen) {
        toggleMark(schema.marks[id === "bold" ? "strong" : id === "italic" ? "em" : "underline"])(view.state, view.dispatch);
        view.focus();
      }
      break;
    case "spell_suggest":
      if (lastOpen) spell.menuAtCaret();
      break;
    case "spell_en_US":
    case "spell_en_GB":
    case "spell_off":
      if (lastOpen) chooseOption("spelling", id.slice(6));
      else syncMenuChecks();
      break;
    case "page_letter":
    case "page_a4":
      if (lastOpen) chooseOption("profile", id.slice(5));
      else syncMenuChecks();
      break;
    case "focus_mode":
      if (lastOpen) await focusMode.toggle();
      break;
    case "font_courier-prime":
    case "font_mono":
    case "font_serif":
    case "font_sans":
      await setScreenFont(id.slice(5) as ScreenFont);
      break;
    case "font_larger":
      await stepScreenSize(1);
      break;
    case "font_smaller":
      await stepScreenSize(-1);
      break;
    case "font_reset":
      await stepScreenSize(0);
      break;
    case "view_typewriter":
      await toggleTypewriter();
      centreTypingLine();
      break;
    case "view_nav":
    case "view_board":
    case "view_toolbar":
    case "view_status":
      await togglePanel(id.slice(5) as "nav" | "board" | "toolbar" | "status");
      break;
  }
}
void listen<string>("menu", (e) => void runMenu(e.payload));
installLiveRegions();
void loadPrefs();

$("save").addEventListener("click", () => void saveNow());
/** PDF proof from the canonical store (File > Export > PDF). */
/** File > Export > PDF…: asks where to save (a path skips the dialog). */
/** File > Export > PDF… (or Changed Pages (PDF)…: only the pages with the active revision set's changes). */
async function exportPdf(path?: string, changedOnly = false): Promise<boolean> {
  if (!lastOpen) return false;
  const suffix = changedOnly ? "-changed-pages.pdf" : ".pdf";
  const target = path ?? (await saveDialog({ defaultPath: lastOpen.package_path.replace(/\.cirth$/i, suffix), filters: [{ name: "PDF", extensions: ["pdf"] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; pages: number; doc_version: number; layout_ms: number; pdf_ms: number; missing_glyphs: string[]; page_numbers: number[] }>("export_pdf", { profileName: ($("profile") as HTMLSelectElement).value, path: target, changedOnly });
    const glyphs = r.missing_glyphs.length ? ` The font has no ${r.missing_glyphs.join(" ")}, so those characters may not print.` : "";
    const pages = changedOnly ? `changed page${r.pages === 1 ? "" : "s"} ${r.page_numbers.join(", ")}` : `${r.pages} pages`;
    // Honest until MANUAL_CHECKS N25 compares the margins with an industry reference.
    showBanner(`PDF written: ${r.path} · ${pages} from v${r.doc_version}.${glyphs} Page measurements follow published guidance and have not yet been checked against an industry PDF.`);
    return true;
  } catch (e) {
    showBanner(`PDF export failed: ${e}`);
    return false;
  }
}
/** Format > Scene Numbers. Numbers live in Rust; this asks, then repaints. */
/** Format > Locked Pages. The baseline lives in Rust (cirth_core::locked). */
async function pageLockAction(id: string) {
  const locked = !!lastPagination?.pages_locked;
  if (id === "pages_lock" && locked) return showBanner("Pages are already locked. Unlock them first to lock a new baseline.");
  if (id === "pages_unlock") {
    if (!locked) return showBanner("Pages are not locked.");
    const ok = await confirmDialog(
      "Unlock pages?",
      "Pages flow freely again: added pages such as 12A disappear and page numbers can change. Locking again takes the pages as they are then as the new baseline.",
      "Unlock",
    );
    if (!ok) return;
  }
  try {
    await syncer.flush();
    const n = await invoke<number>("page_lock_command", { action: id === "pages_lock" ? "lock" : "unlock", profileName: ($("profile") as HTMLSelectElement).value });
    await saveFile(false);
    await repaginate();
    announce(id === "pages_lock" ? `Pages locked: ${n} pages. Added text now goes onto A pages; later pages keep their numbers` : "Pages unlocked");
  } catch (e) {
    showBanner(`Locked pages: ${e}`);
  }
}

async function sceneNumbersAction(id: string) {
  const locked = !!lastPagination?.scene_numbers_locked;
  const scene = sceneAtCursor(view);
  if (id === "scenes_unlock") {
    if (!locked) return showBanner("Scene numbers are not locked.");
    const ok = await confirmDialog(
      "Unlock scene numbers?",
      "All scene numbers (and omitted marks) are removed. Locking again numbers the scenes 1, 2, 3… afresh, so numbers already sent out may change.",
      "Unlock",
    );
    if (!ok) return;
  }
  if ((id === "scene_omit" || id === "scene_restore") && !locked) return showBanner("Lock scene numbers first: only numbered scenes can be omitted.");
  if ((id === "scene_omit" || id === "scene_restore") && !scene) return showBanner("Put the caret in the scene to omit or restore.");
  const action = { scenes_lock: "lock", scenes_unlock: "unlock", scene_omit: "omit", scene_restore: "restore" }[id]!;
  try {
    await syncer.flush();
    const n = await invoke<number>("scene_numbers_command", { action, sceneId: scene?.sceneId ?? null });
    await saveFile(false);
    await repaginate();
    announce(
      action === "lock"
        ? `Scene numbers locked: ${n} scenes numbered`
        : action === "unlock"
          ? "Scene numbers unlocked and removed"
          : action === "omit"
            ? "Scene omitted: it keeps its number and prints as OMITTED"
            : "Scene restored",
    );
  } catch (e) {
    showBanner(`Scene numbers: ${e}`);
  }
}

/** The importer for a file: Final Draft XML by its content or extension,
 *  otherwise plain text read as Fountain (Fountain is plain text, so a
 *  screenplay saved as .txt imports the same way). */
export function importerFor(path: string, head: string): "fdx" | "fountain" | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "fdx" || /<FinalDraft[\s>]/.test(head)) return "fdx";
  if (["fountain", "spmd", "txt", "text"].includes(ext)) return "fountain";
  return null;
}

/** File > Import…: a new project from a Fountain, Final Draft or plain-text
 *  file; the format is read from the file. */
async function importAny(path?: string): Promise<boolean> {
  const source =
    path ??
    (await openDialog({
      multiple: false,
      directory: false,
      filters: [
        { name: "Screenplays (Fountain, Final Draft, plain text)", extensions: ["fountain", "spmd", "fdx", "txt", "text"] },
        { name: "All files", extensions: ["*"] },
      ],
    }));
  if (!source || Array.isArray(source)) return false;
  const head = await invoke<string>("peek_file", { path: source }).catch(() => "");
  const kind = importerFor(source, head);
  if (!kind) {
    showBanner(`Kolbítar cannot import this file: ${source}. It reads Fountain (.fountain, .spmd), Final Draft (.fdx) and plain text (.txt). Word and RTF import are planned.`);
    return false;
  }
  return kind === "fdx" ? importFdx(source) : importFountain(source);
}

/** File > Export…: run the chosen format's own export. */
async function exportAs(format: ExportFormat): Promise<boolean> {
  switch (format) {
    case "pdf":
      return exportPdf();
    case "pdf_changed":
      return exportPdf(undefined, true);
    case "txt":
      return exportText();
    case "fountain":
      return exportFountain();
    case "fdx":
      return exportFdx();
    default:
      return exportDocument(format);
  }
}

/** View > Mode > Full Screen (F11): the window fills the screen; menus stay. */
async function toggleFullScreen(): Promise<void> {
  try {
    const on = await invoke<boolean>("window_command", { action: "fullscreen" });
    void invoke("set_menu_checks", { checks: { full_screen: on } }).catch(() => undefined);
    announce(on ? "Full screen" : "Full screen off");
  } catch (e) {
    showBanner(`Full screen: ${e}`);
  }
}

/** File > Import Fountain…: a new project from a .fountain file. */
async function importFountain(path?: string): Promise<boolean> {
  const source = path ?? (await openDialog({ multiple: false, directory: false, filters: [{ name: "Fountain screenplay", extensions: ["fountain", "spmd", "txt"] }] }));
  if (!source || Array.isArray(source)) return false;
  return openWith("import_fountain", { path: source });
}

/** File > Export > Fountain…: the script and title page as Fountain text. */
async function exportFountain(path?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const target = path ?? (await saveDialog({ defaultPath: lastOpen.package_path.replace(/\.cirth$/i, ".fountain"), filters: [{ name: "Fountain screenplay", extensions: ["fountain"] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; notes: string[] }>("export_fountain", { path: target });
    showBanner(`Fountain written: ${r.path}. ${r.notes.join(" ")}`);
    return true;
  } catch (e) {
    showBanner(`Fountain export failed: ${e}`);
    return false;
  }
}

const DOCUMENT_FORMATS = {
  docx: { name: "Word document", label: "Word document" },
  rtf: { name: "Rich Text", label: "Rich Text file" },
  html: { name: "Web page", label: "Web page" },
} as const;

/** File > Export > Word / Rich Text / Web Page: document formats with a report of what they cannot keep. */
async function exportDocument(format: keyof typeof DOCUMENT_FORMATS, path?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const f = DOCUMENT_FORMATS[format];
  const target = path ?? (await saveDialog({ defaultPath: lastOpen.package_path.replace(/\.cirth$/i, `.${format}`), filters: [{ name: f.name, extensions: [format] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; notes: string[] }>("export_document", { format, path: target });
    showBanner(`${f.label} written: ${r.path}. ${r.notes.join(" ")}`);
    return true;
  } catch (e) {
    showBanner(`${f.label} export failed: ${e}`);
    return false;
  }
}

/** File > Import Final Draft…: a new project from a .fdx file. */
async function importFdx(path?: string): Promise<boolean> {
  const source = path ?? (await openDialog({ multiple: false, directory: false, filters: [{ name: "Final Draft", extensions: ["fdx"] }] }));
  if (!source || Array.isArray(source)) return false;
  return openWith("import_fdx", { path: source });
}

/** File > Export > Final Draft…: the script and title page as .fdx XML. */
async function exportFdx(path?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const target = path ?? (await saveDialog({ defaultPath: lastOpen.package_path.replace(/\.cirth$/i, ".fdx"), filters: [{ name: "Final Draft", extensions: ["fdx"] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; notes: string[] }>("export_fdx", { path: target });
    showBanner(`Final Draft file written: ${r.path}. ${r.notes.join(" ")}`);
    return true;
  } catch (e) {
    showBanner(`Final Draft export failed: ${e}`);
    return false;
  }
}

/** Plain text with the PDF's line breaks and pages (cirth_core::txt). */
async function exportText(path?: string, changedOnly = false): Promise<boolean> {
  if (!lastOpen) return false;
  const target = path ?? (await saveDialog({ defaultPath: lastOpen.package_path.replace(/\.cirth$/i, ".txt"), filters: [{ name: "Plain text", extensions: ["txt"] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<{ path: string; pages: number; doc_version: number; profile: string; notes: string[] }>("export_txt", { path: target, changedOnly });
    showBanner(`Plain text written: ${r.path} · ${r.pages} pages (${r.profile === "a4" ? "A4" : "US Letter"}) from v${r.doc_version}. ${r.notes.join(" ")}`);
    return true;
  } catch (e) {
    showBanner(`Text export failed: ${e}`);
    return false;
  }
}
$("zoom").addEventListener("input", (e) => {
  editorEl.style.zoom = `${(e.target as HTMLInputElement).value}%`;
  layoutMode.apply();
});
$("structural").addEventListener("change", (e) => {
  board.structural = (e.target as HTMLInputElement).checked;
  rerenderSide();
});

// Test and measurement hooks (used by app/tests via the WebView DevTools protocol).
(window as any).__cirth = {
  about,
  prefs: currentPrefs,
  regions,
  exportText,
  importFountain,
  importAny,
  importerFor,
  exportDialog,
  exportAs,
  goTo,
  shortcuts,
  toggleFullScreen,
  exportFountain,
  importFdx,
  exportFdx,
  exportDocument,
  exportPdf,
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
  latency,
  focusMode,
  layoutMode,
  titlePage,
  furniture,
  revisions,
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
  get fileSavedVersion() {
    return fileSavedVersion;
  },
  setAutosaveMs: (ms: number) => {
    autosaveMs = ms;
    if (lastOpen) scheduleAutosave();
  },
  closeWindow: () => getCurrentWindow().close(),
  menu: (id: string) => runMenu(id),
  suggestion: () => suggestion(view.state),
  setViewMode,
  free,
  openFreeWriting,
  spell,
  counts: () => ({ live: liveCounts, doc: docCounts }),
  countWords: (texts: string[]) => invoke<number[]>("count_words", { texts }),
  wordCounts: () => invoke<DocCounts>("word_counts"),
  find: {
    bar: findBar,
    matchesIn,
    state: () => {
      const fs = findState(view.state);
      return { matches: fs.matches.length, current: fs.current, open: !$("find-bar").hidden };
    },
  },
  saveAs: (path: string) => saveAs(path),
  openPath: (path: string) => openWith("open_path", { path }),
  checkOutside,
  libraryFolder: () => invoke<string>("library_folder"),
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
