import "./styles.css";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo, undoDepth, redoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen, emitTo } from "@tauri-apps/api/event";
import { schema, docFromBlocks, nodeToBlock, KIND_LABEL, newId, type Beat, type Block, type Kind } from "./schema";
import { idsPlugin } from "./ids";
import { screenplayKeymap, setKind, setKeyConfig, getKeyConfig, defaultKeyConfig, comicKeyConfig } from "./keys";
import { Syncer, diff, type SyncStatus } from "./sync";
import { clipboardTextParser, clipboardTextSerializer, handlePaste, insertBlocks, parsePlainText } from "./paste";
import { pageMarksPlugin, pageKey, buildDecorations, type PageStart } from "./pagemarks";
import { sceneNumbersPlugin, sceneNumbersKey, buildSceneNumberDecorations, type SceneNumber } from "./scenenums";
import { confirmDialog } from "./confirm";
import { renderBoard, renderNavigator, moveCard, editorScript, revealScene, navUi, outlineOrder, type BoardState, type ScriptView, type NavInfo, type CharacterStat, setSceneNumbers, sceneAtCursor } from "./views";
import { createPanelHost, POP_LABEL, type PopPanel } from "./panels";
import { scenesOf, moveScene, reorderScenes } from "./scenes";
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
import { createProjectTree } from "./projecttree";
import { createLabelNamesDialog } from "./labelnames";
import { createOverview, type OverviewData, type OverviewScene } from "./overview";
import { createStoryScry, type ExportableReport, type ReportBundle, type ReportExported, type ReportFormat, type ReportScope } from "./storyscry";
import { createStripboard } from "./stripboard";
import { createCharacterSides } from "./sides";
import { createBreakdownTags, charToUtf16Offset, selectionAnchor, tagsPlugin, tagsPluginKey, type TagOp, type TagsState, type TagView } from "./tags";
import { createCommentsDialog, commentsPlugin } from "./comments";
import { createAlternativesManager, alternativesPlugin, type AlternativesManager } from "./alternatives";
import { createSnapshotsDialog } from "./snapshots";
import { createBranchesDialog } from "./branches";
import { createMergeDialog } from "./merge";
import { createReviewDialog, type ReviewImportReport, type ReviewExportResult, type ReviewPackageSummary } from "./review";
import { createComicDialog, type ComicScriptAnalysis } from "./comicdlg";
import { createInteractiveDialog, type InteractiveGraph } from "./interactivedlg";
import { createTreatmentDialog, type TreatmentDoc } from "./treatmentdlg";
import { createGrammarDialog, type GrammarAnalysisReport } from "./grammardlg";
import { createBible, type BibleOp, type Entity } from "./bible";
import { setBibleNames } from "./complete";
import { createTimeline, type TimelineOp } from "./timeline";
import { createEvidenceBoard, type EvidenceOp } from "./evidence";
import { createBookmarks, type BookmarkOp } from "./bookmarks";
import { comboOf, commandFor, menuTexts } from "./bindings";
import { createNotesPanel } from "./notes";
import { createRevisions, revisionsPlugin } from "./revisions";
import { setTheme, type Theme } from "./a11y";
import { usedPointer, announce, installLiveRegions, loadPrefs, stepScale, toggleContrast, togglePanel, toggleTypewriter, setScreenFont, setScreenSize, stepScreenSize, onPanelsChanged, SCREEN_FONTS, type ScreenFont, cycleRegions, focusRegion, focusKey, restoreFocus, currentPrefs } from "./a11y";

interface Opened {
  name: string;
  /** The project's title; `doc.title` is the open document's (an episode's). */
  project_title: string;
  document_id: string;
  /** The project's first script: exports keep the project's file name. */
  is_default: boolean;
  doc: { title: string; version: number; blocks: Block[] };
  beats: Beat[];
  recovered: boolean;
  migrated_from: number | null;
  pre_migration_backup: string | null;
  saved_version: number;
  work_path: string;
  package_path: string;
  open_ms: number;
  format_profile?: string;
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
  /** Each scene's page, length in eighths and speakers (the navigator). */
  scene_stats: { scene_id: string; page: string; eighths: number; position: number; characters: string[] }[];
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
  storyScry?.notifyChanged();
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

// Planning edits (ADR 0003): every card change is a planning command based on
// the planning version, undone in the planning history. The board keeps its
// own sequence of steps so Ctrl/Cmd+Z there undoes the board's last action:
// a planning step, or a card move that reordered the script (undone through
// the script's history, only if the script has not changed since).
interface PlanningState {
  version: number;
  beats: Beat[];
  structural: boolean;
  can_undo: boolean;
  can_redo: boolean;
  done: boolean;
}
type BoardStep = { kind: "planning" } | { kind: "script"; depth: number };
let planningVersion = 0;
let boardSteps: BoardStep[] = [];
let boardRedo: BoardStep[] = [];

/** Take the core's cards, keeping each card's object (open cards hold references). */
function takePlanning(st: PlanningState) {
  planningVersion = st.version;
  const old = new Map(board.beats.map((b) => [b.id, b]));
  board.beats = st.beats.map((b) => Object.assign(old.get(b.id) ?? b, b));
  board.structural = st.structural;
  ($("structural") as HTMLInputElement).checked = st.structural;
  storyScry?.notifyChanged();
}

async function refreshPlanning() {
  takePlanning(await invoke<PlanningState>("planning_state_now"));
  boardSteps = [];
  boardRedo = [];
}

/** Where an export goes by default: beside the project file, named after it
 *  (and after the episode, for any document but the project's first). */
function exportPath(ext: string): string {
  const base = lastOpen!.package_path.replace(/\.cirth$/i, "");
  if (lastOpen!.is_default) return base + ext;
  const episode = lastOpen!.doc.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base} - ${episode || "episode"}${ext}`;
}

/** Planning writes run one at a time, and undo waits for any still in flight. */
let planningQueue: Promise<unknown> = Promise.resolve();
const queued = <T>(f: () => Promise<T>): Promise<T> => {
  const next = planningQueue.then(f, f);
  planningQueue = next.catch(() => undefined);
  return next;
};

/** Store a beat (new or changed) as one planning step (the main window's panels and pop-out windows both use it). */
function putBeat(beat: Beat, from: "board" | "nav" = "board"): Promise<void> {
  return queued(() => putBeatNow(beat, from));
}

async function putBeatNow(beat: Beat, from: "board" | "nav"): Promise<void> {
  try {
    takePlanning(await invoke<PlanningState>("planning_command", { op: { PutBeat: beat }, base: planningVersion }));
    // Undo goes to the panel the change was made in (ADR 0003).
    if (from === "board") {
      boardSteps.push({ kind: "planning" });
      boardRedo = [];
    } else {
      navSteps.push("planning");
      navRedo = [];
    }
  } catch (e) {
    await refreshPlanning().catch(() => undefined);
    showBanner(String(e).includes("stale") ? "The board had changed, so it was reloaded; that card change was not applied. Make it again." : `Card not saved: ${e}`);
    rerenderSide();
  }
  panelHost.broadcast();
}

/** A scene move made from the board: a script edit, recorded so the board can undo it. */
function boardMove(sceneId: string, before: string | null) {
  script().move(sceneId, before);
  boardSteps.push({ kind: "script", depth: undoDepth(view.state) });
  boardRedo = [];
}

/** Ctrl/Cmd+Z (or redo) with focus in the board, after any card change still being stored. */
function boardUndo(again: boolean): Promise<void> {
  return queued(() => boardUndoNow(again));
}

async function boardUndoNow(again: boolean) {
  const from = again ? boardRedo : boardSteps;
  const to = again ? boardSteps : boardRedo;
  const step = from.pop();
  if (!step) return announce(again ? "Nothing to redo on the board" : "Nothing to undo on the board");
  if (step.kind === "planning") {
    const st = await invoke<PlanningState>("planning_undo", { redo: again });
    takePlanning(st);
    if (st.done) to.push(step);
    rerenderSide();
    return announce(again ? "Card change redone" : "Card change undone");
  }
  if ((again ? redoDepth(view.state) : undoDepth(view.state)) !== step.depth) {
    from.length = 0;
    return announce(`The script has changed since that move, so the board leaves it alone. ${again ? "Redo" : "Undo"} it in the script instead.`);
  }
  (again ? redo : undo)(view.state, view.dispatch);
  to.push({ kind: "script", depth: again ? undoDepth(view.state) : redoDepth(view.state) });
  announce(again ? "Scene move redone in the script" : "Scene move undone; the script order is restored");
}

/** A header button that moves a panel into its own window (ADR 0004). */
function popButton(panel: "nav" | "board"): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "panel-pop";
  b.textContent = "⧉";
  b.title = `Open the ${POP_LABEL[panel].toLowerCase()} in its own window`;
  b.setAttribute("aria-label", b.title);
  b.addEventListener("click", () => void panelHost.popOut(panel));
  // Not a Tab stop: each panel stays one Tab stop; the keyboard route is View > Tools.
  b.tabIndex = -1;
  return b;
}

// The navigator's data besides the script (M3 step 3): labels, characters and
// the whole project's scenes, fetched after each pagination and on change.
interface NavigatorInfo {
  labels: Record<string, string>;
  label_names: [string, string][];
  characters: CharacterStat[];
  project_scenes: NavInfo["projectScenes"];
}
let navData: NavigatorInfo = { labels: {}, label_names: [], characters: [], project_scenes: [] };
async function refreshNav() {
  if (!lastOpen) return;
  try {
    navData = await invoke<NavigatorInfo>("navigator_info", { project: navUi.project });
    // The board's pacing reads the same stats.
    rerenderSide();
  } catch {
    // The scene list still works from the script alone.
  }
}
function navInfo(): NavInfo {
  return {
    stats: new Map((lastPagination?.scene_stats ?? []).map((x) => [x.scene_id, x])),
    labels: new Map(Object.entries(navData.labels)),
    labelNames: navData.label_names,
    characters: navData.characters,
    projectScenes: navData.project_scenes,
    beats: board.beats,
    currentDocument: lastOpen?.document_id ?? null,
  };
}
/** Steps taken in the scene list that are not script edits (labels), for its undo. */
let navSteps: "planning"[] = [];
let navRedo: "planning"[] = [];
async function setLabel(sceneId: string, label: string) {
  await queued(async () => {
    try {
      takePlanning(await invoke<PlanningState>("planning_command", { op: { SetSceneLabel: { scene_id: sceneId, label } }, base: planningVersion }));
      navSteps.push("planning");
      navRedo = [];
      const name = navData.label_names.find(([k]) => k === label)?.[1];
      announce(name ? `Label: ${name}` : "Label removed");
    } catch (e) {
      showBanner(`Label not set: ${e}`);
    }
  });
  await refreshNav();
}
/** Ctrl/Cmd+Z in the scene list: a label change if that was its last step, otherwise the script's history (its moves are script edits). */
async function navUndo(again: boolean): Promise<boolean> {
  const from = again ? navRedo : navSteps;
  if (!from.length) return false;
  await queued(async () => {
    const st = await invoke<PlanningState>("planning_undo", { redo: again });
    takePlanning(st);
    if (st.done) (again ? navSteps : navRedo).push(from.pop()!);
    else from.length = 0;
  });
  await refreshNav();
  announce(again ? "Label change redone" : "Label change undone");
  return true;
}
const labelNames = createLabelNamesDialog(() => navData.label_names, async (changes) => {
  for (const [key, name] of changes) await invoke("set_label_name", { key, name });
  await refreshNav();
});
async function openElsewhere(documentId: string, sceneId: string) {
  if (await openWith("open_document", { id: documentId })) revealScene(view, sceneId);
}

/** Delete an outline item from the Outline tab (a planning step; Ctrl/Cmd+Z there brings it back). */
async function deleteItem(id: string) {
  const it = board.beats.find((b) => b.id === id);
  await queued(async () => {
    try {
      takePlanning(await invoke<PlanningState>("planning_command", { op: { DeleteBeat: id }, base: planningVersion }));
      navSteps.push("planning");
      navRedo = [];
      announce(`${it?.title || it?.logline || "Item"} deleted. Undo brings it back.`);
    } catch (e) {
      showBanner(`Not deleted: ${e}`);
    }
  });
  rerenderSide();
}

/** After a beat moves in the outline: with "Board may reorder script" on, its
 *  scene moves to match (one script edit, before the next linked beat's scene). */
function reorderFromOutline(id: string) {
  const b = board.beats.find((x) => x.id === id);
  if (!board.structural || !b?.scene_id || !view) return;
  const linked = outlineOrder(board.beats).map((x) => x.it).filter((x) => x.kind === "beat" && x.scene_id);
  const at = linked.findIndex((x) => x.id === id);
  const next = linked.slice(at + 1).find((x) => x.scene_id !== b.scene_id && scenesOf(view.state.doc).some((sc) => sc.sceneId === x.scene_id));
  const order = scenesOf(view.state.doc).map((sc) => sc.sceneId);
  const want = next?.scene_id ?? null;
  const i = order.indexOf(b.scene_id);
  if (i < 0 || order[i + 1] === want || (want === null && i === order.length - 1)) return;
  script().move(b.scene_id, want);
  announce("The script's scene order follows the outline. Undo in the script reverts it.");
}

/** The overview map's data: this script from the editor and its page map; the project from the core. */
async function overviewData(project: boolean): Promise<OverviewData> {
  const labels = new Map(Object.entries(navData.labels));
  // Acts: the outermost act of the first card linked to each scene (this script's outline).
  const byId = new Map(board.beats.map((b) => [b.id, b]));
  const acts = outlineOrder(board.beats).map((x) => x.it).filter((b) => b.kind === "act");
  const actOf = new Map<string, OverviewScene["act"]>();
  for (const { it } of outlineOrder(board.beats)) {
    if (it.kind !== "beat" || !it.scene_id || actOf.has(it.scene_id)) continue;
    let p = it.parent ? byId.get(it.parent) : undefined;
    while (p && p.kind !== "act") p = p.parent ? byId.get(p.parent) : undefined;
    actOf.set(it.scene_id, p ? { id: p.id, title: p.title || "(untitled act)", index: acts.indexOf(p) } : null);
  }
  const stats = new Map((lastPagination?.scene_stats ?? []).map((x) => [x.scene_id, x]));
  const here: OverviewScene[] = scenesOf(view.state.doc).map((s) => ({
    sceneId: s.sceneId,
    heading: s.heading,
    number: sceneNumbers.get(s.sceneId)?.number,
    page: stats.get(s.sceneId)?.page ?? "",
    eighths: stats.get(s.sceneId)?.eighths ?? 1,
    label: labels.get(s.sceneId) ?? "",
    act: actOf.get(s.sceneId) ?? null,
  }));
  const current = { id: lastOpen!.document_id, title: lastOpen!.doc.title, current: true, scenes: here };
  let docs = [current];
  if (project) {
    const info = await invoke<{ project_scenes: { document_id: string; document_title: string; scene_id: string; heading: string; page: string; eighths: number }[] }>("navigator_info", { project: true });
    docs = [];
    for (const p of info.project_scenes) {
      if (p.document_id === current.id) {
        if (!docs.includes(current)) docs.push(current);
        continue;
      }
      let d = docs.find((x) => x.id === p.document_id);
      if (!d) docs.push((d = { id: p.document_id, title: p.document_title, current: false, scenes: [] }));
      d.scenes.push({ sceneId: p.scene_id, heading: p.heading, page: p.page, eighths: p.eighths, label: labels.get(p.scene_id) ?? "", act: null });
    }
  }
  return { docs, labelNames: navData.label_names, currentScene: sceneAtCursor(view)?.sceneId ?? null };
}
const overview = createOverview({
  data: overviewData,
  go: (doc, scene) => (doc === lastOpen?.document_id ? revealScene(view, scene) : void openElsewhere(doc, scene)),
});
const REPORT_FORMAT_FILTERS: Record<ReportFormat, { name: string; ext: string }> = {
  xlsx: { name: "Spreadsheet (.xlsx)", ext: "xlsx" },
  csv: { name: "CSV (.csv)", ext: "csv" },
  tsv: { name: "TSV (.tsv)", ext: "tsv" },
  pdf: { name: "PDF (.pdf)", ext: "pdf" },
  html: { name: "Web page (.html)", ext: "html" },
  rtf: { name: "Rich Text (.rtf)", ext: "rtf" },
};

async function exportReport(
  report: ExportableReport,
  format: ReportFormat,
  path?: string,
  scope?: ReportScope,
): Promise<ReportExported | null> {
  if (!lastOpen) return null;
  const f = REPORT_FORMAT_FILTERS[format];
  const suffix = `-${report === "all" ? "reports" : report.replace(/_/g, "-")}.${f.ext}`;
  const target = path ?? (await saveDialog({ defaultPath: exportPath(suffix), filters: [{ name: f.name, extensions: [f.ext] }] }));
  if (!target) return null;
  await syncer.flush();
  const activeScope: ReportScope = scope ?? storyScry.scope();
  try {
    const r = await invoke<ReportExported>("export_report", {
      scope: activeScope,
      report,
      format,
      path: target,
    });
    showBanner(`${r.title} (${r.format.toUpperCase()}) written: ${r.path}. ${r.notes.join(" ")}`);
    return r;
  } catch (e) {
    showBanner(`Report export failed: ${e}`);
    return null;
  }
}

const storyScry = createStoryScry({
  fetch: async (scope: ReportScope) => {
    await syncer.flush();
    return invoke<ReportBundle>("storyscry_reports", { scope });
  },
  versions: () => ({
    scriptVersion: syncer?.currentVersion ?? 0,
    hasUnsynced: syncer?.hasUnsynced ?? false,
    planningVersion,
  }),
  go: (doc, scene) => (doc === lastOpen?.document_id ? revealScene(view, scene) : void openElsewhere(doc, scene)),
  exportReport: (scope, report, format, path) => exportReport(report, format, path, scope),
});

// The stripboard and shooting schedule (M4 step 5, E3, E4, E9).
const stripboard = createStripboard({
  documentId: () => lastOpen?.document_id ?? "",
  version: () => syncer?.currentVersion ?? 0,
  planningVersion: () => planningVersion,
  applyPlanning: (op) =>
    queued(async () => {
      try {
        takePlanning(await invoke<PlanningState>("planning_command", { op, base: planningVersion }));
        return true;
      } catch (e) {
        showBanner(`Stripboard: ${e}`);
        await refreshPlanning().catch(() => undefined);
        return false;
      }
    }),
  undoPlanning: () =>
    queued(async () => {
      const st = await invoke<PlanningState>("planning_undo", { redo: false });
      takePlanning(st);
      return st.done;
    }),
  redoPlanning: () =>
    queued(async () => {
      const st = await invoke<PlanningState>("planning_undo", { redo: true });
      takePlanning(st);
      return st.done;
    }),
  episodes: async () => (await invoke<{ id: string; title: string; kind: string }[]>("project_tree")).filter((i) => i.kind === "document").map((i) => ({ id: i.id, title: i.title })),
  onGoToScene: (sceneId) => revealScene(view, sceneId),
});

// Character sides (M4 step 6; ROADMAP §M4).
const characterSides = createCharacterSides({
  documentId: () => lastOpen?.document_id ?? "",
});

// The project bible (M3 step 7): entries are planning data; renames change the scripts.
const bible = createBible({
  state: () => invoke("bible_state"),
  apply: (op: BibleOp) =>
    queued(async () => {
      try {
        takePlanning(await invoke<PlanningState>("planning_command", { op, base: planningVersion }));
        return true;
      } catch (e) {
        showBanner(`Bible: ${e}`);
        await refreshPlanning().catch(() => undefined);
        return false;
      }
    }),
  undo: () =>
    queued(async () => {
      const st = await invoke<PlanningState>("planning_undo", { redo: false });
      takePlanning(st);
      return st.done;
    }),
  scopes: async () => (await invoke<{ id: string; title: string; kind: string }[]>("project_tree")).map((i) => ({ id: i.id, title: i.title, kind: i.kind })),
  renamePreview: (id, from, to) => invoke("bible_rename_preview", { id, from, to }),
  renameApply: async (id, from, to, expect) => {
    await syncer.flush();
    const n = await invoke<number>("bible_rename_apply", { id, from, to, expect });
    // The open script changed underneath the editor: reload it (its undo history starts again).
    if (lastOpen) await openWith("open_document", { id: lastOpen.document_id });
    return n;
  },
  go: (doc, scene) => (doc === lastOpen?.document_id ? revealScene(view, scene) : void openElsewhere(doc, scene)),
  newId,
});
// The story timeline (M3 step 8): events are planning data; reordering the script is a separate script edit.
const timeline = createTimeline({
  state: async () => {
    await syncer.flush();
    return invoke("timeline_state");
  },
  apply: (op: TimelineOp) =>
    queued(async () => {
      try {
        takePlanning(await invoke<PlanningState>("planning_command", { op, base: planningVersion }));
        return true;
      } catch (e) {
        showBanner(`Timeline: ${e}`);
        await refreshPlanning().catch(() => undefined);
        return false;
      }
    }),
  undo: () =>
    queued(async () => {
      const st = await invoke<PlanningState>("planning_undo", { redo: false });
      takePlanning(st);
      return st.done;
    }),
  currentScene: () => (view ? (sceneAtCursor(view)?.sceneId ?? null) : null),
  structural: () => board.structural,
  reorder: (order) => {
    if (!board.structural) return false;
    const tr = reorderScenes(view.state, order);
    if (!tr) {
      showBanner("The script changed; open the timeline again to see the story order.");
      return false;
    }
    view.dispatch(tr);
    return true;
  },
  go: (doc, scene) => (doc === lastOpen?.document_id ? revealScene(view, scene) : void openElsewhere(doc, scene)),
  newId,
});

/** A planning command from a dialog: true when stored (planning steps, ADR 0003). */
const planOp = (op: unknown, what: string) =>
  queued(async () => {
    try {
      takePlanning(await invoke<PlanningState>("planning_command", { op, base: planningVersion }));
      return true;
    } catch (e) {
      showBanner(`${what}: ${e}`);
      await refreshPlanning().catch(() => undefined);
      return false;
    }
  });
const planUndo = () =>
  queued(async () => {
    const st = await invoke<PlanningState>("planning_undo", { redo: false });
    takePlanning(st);
    return st.done;
  });

// The evidence board (M3 step 9): cards and strings are planning data; pictures are packaged; links are never fetched.
const evidence = createEvidenceBoard({
  state: () => invoke("evidence_state"),
  apply: (op: EvidenceOp) => planOp(op, "Evidence board"),
  undo: planUndo,
  sources: async () => {
    const places = (await invoke<{ places: Record<string, { document_title: string; heading: string }> }>("evidence_state")).places;
    const bible = await invoke<{ entries: { id: string; name: string; kind: string }[] }>("bible_state");
    const tl = await invoke<{ events: { id: string; title: string }[] }>("timeline_state");
    return {
      scene: Object.entries(places).map(([id, p]) => ({ id, title: `${p.heading || "(empty heading)"} · ${p.document_title}` })),
      beat: board.beats.filter((b) => b.kind === "beat").map((b) => ({ id: b.id, title: b.logline || b.summary || "(beat)" })),
      entity: bible.entries.map((e) => ({ id: e.id, title: `${e.name} (${e.kind})` })),
      event: tl.events.map((e) => ({ id: e.id, title: e.title })),
    };
  },
  pickPicture: async () => {
    const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Pictures (PNG, JPEG, GIF, WebP)", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    if (!path || Array.isArray(path)) return null;
    return invoke("add_picture", { path });
  },
  pictureData: (id) => invoke("picture_data", { id }),
  openLink: (url) => invoke("open_link", { url }),
  go: (doc, scene) => (doc === lastOpen?.document_id ? revealScene(view, scene) : void openElsewhere(doc, scene)),
  newId,
});

// Bookmarks: a named block; going there opens its script and puts the caret at the block.
async function goToBlock(documentId: string, blockId: string) {
  if (documentId !== lastOpen?.document_id && !(await openWith("open_document", { id: documentId }))) return;
  let at = -1;
  view.state.doc.forEach((n, pos) => {
    if (at < 0 && n.attrs.id === blockId) at = pos + 1;
  });
  if (at < 0) return showBanner("That bookmark's text is no longer in the script.");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).scrollIntoView());
  view.focus();
}

async function goToTagSpan(documentId: string, blockId: string, startChar: number, endChar: number) {
  if (documentId !== lastOpen?.document_id && !(await openWith("open_document", { id: documentId }))) return;
  let fromPos = -1;
  let toPos = -1;
  view.state.doc.forEach((n, pos) => {
    if (fromPos >= 0 || n.attrs.id !== blockId) return;
    const text = n.textContent;
    const uStart = Math.min(text.length, Math.max(0, charToUtf16Offset(text, startChar)));
    const uEnd = Math.min(text.length, Math.max(uStart, charToUtf16Offset(text, endChar)));
    fromPos = pos + 1 + uStart;
    toPos = pos + 1 + uEnd;
  });
  if (fromPos < 0) return showBanner("That tag's paragraph is no longer in the script.");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, fromPos, toPos)).scrollIntoView());
  view.focus();
}

function decorateTags(tags: TagView[]) {
  if (!view || !lastOpen) return;
  view.dispatch(
    view.state.tr
      .setMeta(tagsPluginKey, { tags, documentId: lastOpen.document_id })
      .setMeta("addToHistory", false),
  );
}

async function refreshTagDecorations() {
  if (!view || !lastOpen) return;
  try {
    const st = await invoke<TagsState>("tags_state");
    decorateTags(st.tags);
  } catch {
    // Decoration is visual only; never block editing.
  }
}

const breakdownTags = createBreakdownTags({
  state: async () => {
    await syncer.flush();
    return invoke<TagsState>("tags_state");
  },
  apply: (op: TagOp) => planOp(op, "Breakdown tags"),
  undo: planUndo,
  addCategory: (label) => invoke<[string, string]>("add_tag_category", { label }),
  selection: () => selectionAnchor(view ?? null, lastOpen?.document_id ?? null),
  currentDocument: () => lastOpen?.document_id ?? null,
  decorate: decorateTags,
  go: (doc, block, s, e) => void goToTagSpan(doc, block, s, e),
  newId,
});
const commentsDialog = createCommentsDialog({
  getView: () => view ?? null,
  getDocumentId: () => lastOpen?.document_id ?? null,
  jumpToBlock: (blockId) => void goToTagSpan(lastOpen?.document_id ?? "", blockId, 0, 0),
});
const alternativesMgrRef = { current: null as AlternativesManager | null };
const alternativesMgr = createAlternativesManager({
  getView: () => view ?? null,
  getDocumentId: () => lastOpen?.document_id ?? null,
});
alternativesMgrRef.current = alternativesMgr;
const snapshotsDialog = createSnapshotsDialog({
  onRestored: async (opened) => {
    if (opened) {
      await applyOpened(opened);
    } else if (lastOpen) {
      await openWith("open_document", { id: lastOpen.document_id });
    }
  },
});
const branchIndicator = $("branch-indicator") as HTMLButtonElement | null;
const mergeDialog = createMergeDialog(document.body, {
  invoke,
  onMerged: async (opened) => {
    await applyOpened(opened);
    showBanner(`Branch merged successfully (version ${opened.doc.version}).`);
  },
  announce: (msg) => announce(msg),
});
const branchesDialog = createBranchesDialog({
  onSwitched: async (opened) => {
    await applyOpened(opened);
  },
  onBranchChanged: (name) => {
    if (branchIndicator) {
      branchIndicator.textContent = `⑂ ${name}`;
      branchIndicator.setAttribute("aria-label", `Current Branch: ${name} (click to switch or manage branches)`);
      branchIndicator.hidden = false;
    }
  },
  onMergeBranch: (branchId) => {
    void mergeDialog.open(branchId);
  },
});
const reviewDialog = createReviewDialog({
  onImported: async (report) => {
    showBanner(`Review package imported: ${report.threads_imported} threads, ${report.alternatives_imported} alternate takes.`);
    if (lastOpen) {
      await openWith("open_document", { id: lastOpen.document_id });
    }
  },
});
const comicDialog = createComicDialog({
  onRenumber: async () => {
    if (lastOpen) {
      await openWith("open_document", { id: lastOpen.document_id });
    }
  },
});
const interactiveDialog = createInteractiveDialog({});
const treatmentDialog = createTreatmentDialog({});
const grammarDialog = createGrammarDialog({
  onBlockUpdated: async () => {
    if (lastOpen) {
      await openWith("open_document", { id: lastOpen.document_id });
    }
  },
});
if (branchIndicator) {
  branchIndicator.onclick = () => {
    if (lastOpen) void branchesDialog.open();
  };
}
const bookmarks = createBookmarks({
  list: async () => {
    const st = await invoke<{ bookmarks: { id: string; name: string; document_id: string; block_id: string }[] }>("evidence_state");
    const titles = Object.fromEntries((await invoke<{ id: string; title: string }[]>("project_tree")).map((i) => [i.id, i.title]));
    return { bookmarks: st.bookmarks, titles };
  },
  here: () => {
    if (!view || !lastOpen) return null;
    const $p = view.state.selection.$from;
    const block = $p.depth ? $p.node(1) : null;
    return block?.attrs.id ? { document_id: lastOpen.document_id, block_id: block.attrs.id, text: block.textContent } : null;
  },
  apply: (op: BookmarkOp) => planOp(op, "Bookmark"),
  go: (b) => void goToBlock(b.document_id, b.block_id),
  newId,
});

/** Autocomplete offers the bible's names (characters for cues, locations for headings). */
async function refreshBibleNames() {
  try {
    const st = await invoke<{ entries: Entity[] }>("bible_state");
    const names = (k: string) => st.entries.filter((e) => e.kind === k).flatMap((e) => [e.name, ...e.aliases]).map((n) => n.toUpperCase());
    setBibleNames({ cues: names("character"), locations: names("location") });
  } catch {
    setBibleNames({ cues: [], locations: [] });
  }
}
document.getElementById("bible-dialog")?.addEventListener("close", () => {
  void refreshBibleNames();
  void refreshNav();
});

const script = (): ScriptView => ({
  ...editorScript(view, (b) => putBeat(b, "nav").then(() => rerenderSide()), popButton),
  deleteItem: (id) => void deleteItem(id),
  reorderFromOutline,
  planWith: (plan) =>
    queued(async () => {
      const r = plan(board.beats.map((b) => ({ ...b })));
      if (typeof r !== "string") await putBeatNow(r, "nav");
      return r;
    }).then((r) => {
      rerenderSide();
      return r;
    }),
  nav: navInfo,
  redraw: () => renderNav(),
  setScope: () => void refreshNav(),
  setLabel: (id, label) => void setLabel(id, label),
  renameLabels: () => labelNames.open(),
  openElsewhere: (d, sc) => void openElsewhere(d, sc),
});

function rerenderSide() {
  renderNav();
  // Never rebuild a card while its logline or summary is being typed in:
  // the unsaved text would be replaced by the stored value.
  const a = document.activeElement;
  const typing = a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === "text");
  if (!boardEl.contains(a) || !typing) {
    const key = focusKey(boardEl);
    renderBoard(boardBody, { ...script(), putBeat, move: boardMove }, board, rerenderSide, key?.split("|")[0]);
    restoreFocus(boardEl, key);
  }
  panelHost.broadcast();
}

/** Re-render the navigator, keeping keyboard focus on the same scene. */
function renderNav() {
  const key = focusKey(navEl);
  renderNavigator(navEl, script(), key?.split("|")[0]);
  panelHost.broadcast();
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
    void refreshNav();
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
    storyScry.notifyChanged();
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
      // Bold, elements, dual dialogue and the rest are rebindable: the
      // shortcut dispatcher runs them (bindings.ts). Undo and redo are fixed.
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap(baseKeymap),
      pageMarksPlugin(),
      sceneNumbersPlugin(),
      findPlugin(),
      spellPlugin(),
      dualPlugin(),
      revisionsPlugin(),
      tagsPlugin(),
      commentsPlugin(),
      alternativesPlugin(alternativesMgrRef),
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
  await applyOpened(o, t0);
  return true;
}

/** Directly apply a loaded `Opened` project state into the editor view without re-flushing stale changes. */
async function applyOpened(o: Opened, t0: number = performance.now()): Promise<void> {
  const t1 = performance.now();
  setView("editor");
  $("find-bar").hidden = true; // a new editor state has no search
  $("project-title").textContent = o.is_default ? o.doc.title || o.name : `${o.project_title || o.name} › ${o.doc.title}`;
  try {
    const curBranch = await branchesDialog.current();
    if (branchIndicator) {
      branchIndicator.textContent = `⑂ ${curBranch}`;
      branchIndicator.setAttribute("aria-label", `Current Branch: ${curBranch} (click to switch or manage branches)`);
      branchIndicator.hidden = false;
    }
  } catch {}
  board.beats = o.beats;
  await refreshPlanning();
  void refreshBibleNames();
  navSteps = [];
  navRedo = [];
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
    void refreshTagDecorations();
    void commentsDialog.refresh();
    void alternativesMgr.refresh();
  };
  void refreshTagDecorations();
  void commentsDialog.refresh();
  void alternativesMgr.refresh();
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
  if (o.recovered)
    notes.push(
      o.doc.version > o.saved_version
        ? `Recovered unsaved work from the working store (v${o.doc.version}; the file was saved at v${o.saved_version}).`
        : "Recovered settings or notes changed after the last save (the script itself was saved).",
    );
  if (o.import_notes?.length) notes.push(`Imported. ${o.import_notes.join(" ")}`);
  if (o.migrated_from) notes.push(`Upgraded this project from file format ${o.migrated_from} to the current format. The original file is kept unchanged at ${o.pre_migration_backup ?? "(no copy kept)"}; the project file is written in the new format at the next save.`);
  showBanner(notes.length ? notes.join(" ") : null);
  fileSavedVersion = o.saved_version;
  fileSavedAt = null;
  scheduleAutosave();
  setKeyConfig(o.format_profile === "comic" ? comicKeyConfig : defaultKeyConfig);
  await notesPanel.load(true);
  lastOpen = o; // set last: tests treat it as "open finished"
  showFileStatus();
  rerenderSide();
  void repaginate();
  view.focus();
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
/** Notes typed in the last half second reach the store before any save. */
let notesFlush: () => Promise<void> = async () => {};
async function saveFile(explicit: boolean): Promise<void> {
  while (saving) await saving;
  saving = (async () => {
    await syncer.flush();
    await notesFlush();
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
    await panelHost.dockAll();
    try {
      await saveFile(false);
      await invoke("close_project");
    } catch (e) {
      // Do not leave the project if it could not be saved.
      showBanner(`Could not save before closing: ${e}. The project stays open.`);
      return;
    }
    lastOpen = null;
    if (branchIndicator) branchIndicator.hidden = true;
    await notesPanel.load(false);
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
const projectTree = createProjectTree({
  current: () => lastOpen?.document_id ?? null,
  openDocument: (id) => openWith("open_document", { id }),
  changed: () => {
    // A rename of the open document shows at once in the status bar.
    void invoke<Opened["doc"]>("load_document")
      .then((d) => {
        if (!lastOpen) return;
        lastOpen.doc.title = d.title;
        $("project-title").textContent = lastOpen.is_default ? d.title || lastOpen.name : `${lastOpen.project_title || lastOpen.name} › ${d.title}`;
      })
      .catch(() => undefined);
  },
});
// Menu items show the keys in force (after a change, and at startup).
let shownKeys = "";
onPanelsChanged(() => {
  const keys = JSON.stringify(currentPrefs().keys ?? {});
  if (keys === shownKeys) return;
  shownKeys = keys;
  void invoke("set_menu_texts", { texts: menuTexts(currentPrefs().keys ?? {}) }).catch(() => undefined);
});
const panelHost = createPanelHost({
  open: () => !!lastOpen,
  scenes: () => (view ? scenesOf(view.state.doc) : []),
  current: () => (view ? sceneAtCursor(view)?.sceneId : undefined),
  numbers: () => sceneNumbers,
  beats: () => board.beats,
  structural: () => board.structural,
  setStructural: (on) => setStructural(on),
  reveal: (id) => revealScene(view, id),
  move: (id, before, panel) => (panel === "board" ? boardMove(id, before) : script().move(id, before)),
  putBeat: async (beat, panel) => {
    await putBeat(beat, panel === "nav" ? "nav" : "board");
    if (panel === "nav") reorderFromOutline(beat.id);
    rerenderSide();
  },
  deleteItem: (id) => void deleteItem(id),
  notesText: () => notesPanel.value,
  nav: () => navInfo(),
  project: () => navUi.project,
  setLabel: (id, label) => void setLabel(id, label),
  setScope: (project) => {
    navUi.project = project;
    void refreshNav();
  },
  openElsewhere: (d, sc) => void openElsewhere(d, sc),
  setNotes: (text) => notesPanel.set(text),
  undo: (again, panel) => {
    if (!view || !lastOpen) return;
    if (panel === "board") void boardUndo(again);
    else (again ? redo : undo)(view.state, view.dispatch);
  },
  changed: () => layoutMode.apply(),
});
/** "Board may reorder script": stored per document (ADR 0003). */
function setStructural(on: boolean) {
  ($("structural") as HTMLInputElement).checked = on;
  board.structural = on;
  if (lastOpen) void invoke("set_board_structural", { on }).catch((e) => showBanner(`Could not store the board setting: ${e}`));
  rerenderSide();
}
const notesPanel = createNotesPanel($("notes"), { focusScript: () => view?.focus(), close: () => void togglePanel("notes") });
notesFlush = () => notesPanel.flush();
onPanelsChanged(() => {
  if (currentPrefs().panels.notes) notesPanel.shown();
});
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
  // A panel in its own window comes to the front instead (ADR 0004).
  navBtn.addEventListener("click", () => (panelHost.isPopped("nav") ? void panelHost.popOut("nav") : layoutMode.mode === "overlay" && currentPrefs().panels.nav ? layoutMode.toggleFloat("nav") : void togglePanel("nav")));
  const boardBtn = iconButton("toggle-board", "board", "Board", "Show or hide the board");
  boardBtn.addEventListener("click", () => (panelHost.isPopped("board") ? void panelHost.popOut("board") : layoutMode.mode === "overlay" && currentPrefs().panels.board ? layoutMode.toggleFloat("board") : void togglePanel("board")));
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
  const list = v === "home" ? [q(".home-side"), q(".home-main")] : v === "free" ? [q(".fw-side"), q(".fw-main")] : [q(".toolbar"), navEl, q(".editor-wrap"), $("notes"), boardEl];
  return list.filter((r): r is HTMLElement => !!r);
}
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F6" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      cycleRegions(regions(), e.shiftKey);
    }
  },
  true,
);
// Every rebindable shortcut (bindings.ts): the keys in force come from the
// user's preferences; the command runs exactly as its menu item does.
// Formatting keys act only in the script.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.isComposing || document.body.hasAttribute("data-capturing-keys")) return;
    const combo = comboOf(e);
    const b = combo ? commandFor(currentPrefs().keys ?? {}, combo) : undefined;
    if (!b) return;
    if (b.scope === "script" && !(view && lastOpen && view.dom.contains(e.target as Node))) return;
    e.preventDefault();
    e.stopPropagation();
    void runMenu(b.id);
  },
  true,
);
window.addEventListener(
  "keydown",
  (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey || e.isComposing) return;
    const k = e.key.toLowerCase();
    if ((k === "z" || (k === "y" && !isMac)) && view && lastOpen && inPanelNotField(e.target)) {
      // Undo follows focus (ADR 0003). The scene list: the script's history
      // (its moves are script edits). The board: its own last action, a card
      // change (planning history) or a move that reordered the script. Text
      // fields keep their own undo while typing.
      e.preventDefault();
      const again = k === "y" || e.shiftKey;
      if (boardEl.contains(e.target as Node)) return void boardUndo(again);
      if (navEl.contains(e.target as Node) && (again ? navRedo : navSteps).length) return void navUndo(again);
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
    case "evidence":
      if (lastOpen) await evidence.open();
      break;
    case "bookmarks":
    case "bookmark_add":
      if (lastOpen) await bookmarks.open(id === "bookmark_add");
      break;
    case "timeline":
      if (lastOpen) await timeline.open();
      break;
    case "bible":
      if (lastOpen) await bible.open();
      break;
    case "overview":
      if (lastOpen) await overview.open();
      break;
    case "storyscry":
      if (lastOpen) await storyScry.open();
      break;
    case "stripboard":
      if (lastOpen) await stripboard.open();
      break;
    case "sides":
      if (lastOpen) await characterSides.open();
      break;
    case "tags":
      if (lastOpen) await breakdownTags.open();
      break;
    case "comments":
      if (lastOpen) await commentsDialog.open();
      break;
    case "alt_take":
      if (lastOpen) await alternativesMgr.addTakePrompt();
      break;
    case "project_tree":
      if (lastOpen) await projectTree.open();
      break;
    case "snapshots":
      if (lastOpen) await snapshotsDialog.open();
      break;
    case "branches":
      if (lastOpen) await branchesDialog.open();
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
    case "export_review":
      await exportReviewPackage();
      break;
    case "import_review":
      await importReviewPackage();
      break;
    case "comic_tools":
      if (lastOpen) await comicDialog.open();
      break;
    case "interactive_tools":
      if (lastOpen) await interactiveDialog.open();
      break;
    case "treatment_tools":
      if (lastOpen) await treatmentDialog.open();
      break;
    case "grammar_tools":
      if (lastOpen) await grammarDialog.show();
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
    case "theme_system":
    case "theme_day":
    case "theme_night":
    case "theme_midnight":
    case "theme_oled":
      await setTheme(id.slice(6) as Theme);
      break;
    case "popout_nav":
    case "popout_board":
    case "popout_notes":
      if (lastOpen) await panelHost.popOut(id.slice(7) as PopPanel);
      break;
    case "view_nav":
    case "view_board":
    case "view_toolbar":
    case "view_status":
    case "view_notes":
      await togglePanel(id.slice(5) as "nav" | "board" | "toolbar" | "status" | "notes");
      if (id === "view_notes" && currentPrefs().panels.notes && lastOpen) notesPanel.focus();
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
  const target = path ?? (await saveDialog({ defaultPath: exportPath(suffix), filters: [{ name: "PDF", extensions: ["pdf"] }] }));
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
    case "reports":
      await storyScry.open();
      return true;
    case "stripboard":
      await stripboard.open();
      return true;
    case "sides":
      await characterSides.open();
      return true;
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
  const target = path ?? (await saveDialog({ defaultPath: exportPath(".fountain"), filters: [{ name: "Fountain screenplay", extensions: ["fountain"] }] }));
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
  const target = path ?? (await saveDialog({ defaultPath: exportPath(`.${format}`), filters: [{ name: f.name, extensions: [format] }] }));
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
  const target = path ?? (await saveDialog({ defaultPath: exportPath(".fdx"), filters: [{ name: "Final Draft", extensions: ["fdx"] }] }));
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
  const target = path ?? (await saveDialog({ defaultPath: exportPath(".txt"), filters: [{ name: "Plain text", extensions: ["txt"] }] }));
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

/** Export a self-contained portable review package (.cirth-review, M5 Step 6). */
async function exportReviewPackage(path?: string, reviewer?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const target = path ?? (await saveDialog({ defaultPath: exportPath(".cirth-review"), filters: [{ name: "Review Package", extensions: ["cirth-review"] }] }));
  if (!target) return false;
  await syncer.flush();
  try {
    const r = await invoke<ReviewExportResult>("review_export", { path: target, reviewer: reviewer ?? null });
    showBanner(`Review package exported: ${r.comment_thread_count} threads and ${r.alternative_count} alternate takes.`);
    announce(`Review package exported to ${r.path}`);
    return true;
  } catch (e) {
    showBanner(`Review package export failed: ${e}`);
    return false;
  }
}

/** Import a portable review package (.cirth-review, M5 Step 6). */
async function importReviewPackage(path?: string): Promise<boolean> {
  if (!lastOpen) return false;
  const target = path ?? (await openDialog({ filters: [{ name: "Review Package", extensions: ["cirth-review"] }] }));
  if (!target || typeof target !== "string") return false;
  const s = await reviewDialog.open(target);
  return !!s;
}
$("zoom").addEventListener("input", (e) => {
  editorEl.style.zoom = `${(e.target as HTMLInputElement).value}%`;
  layoutMode.apply();
});
$("structural").addEventListener("change", (e) => setStructural((e.target as HTMLInputElement).checked));

// Test and measurement hooks (used by app/tests via the WebView DevTools protocol).
(window as any).__cirth = {
  about,
  prefs: currentPrefs,
  regions,
  exportText,
  importFountain,
  importAny,
  overview,
  storyScry,
  stripboard,
  characterSides,
  tags: breakdownTags,
  comments: commentsDialog,
  alternatives: alternativesMgr,
  snapshots: snapshotsDialog,
  branches: branchesDialog,
  merge: mergeDialog,
  reviewPackage: {
    dialog: reviewDialog,
    export: exportReviewPackage,
    import: importReviewPackage,
    inspect: (path: string) => invoke<ReviewPackageSummary>("review_inspect", { path }),
    apply: (path: string) => invoke<ReviewImportReport>("review_apply", { path }),
  },
  comic: {
    dialog: comicDialog,
    analyze: (documentId?: string) => invoke<ComicScriptAnalysis>("comic_analyze", { documentId }),
    renumber: (documentId?: string) => invoke<ComicScriptAnalysis>("comic_renumber", { documentId }),
    exportText: (documentId?: string, title?: string) => invoke<string>("comic_export_text", { documentId, title }),
    exportHtml: (documentId?: string, title?: string) => invoke<string>("comic_export_html", { documentId, title }),
  },
  interactive: {
    dialog: interactiveDialog,
    analyze: (documentId?: string) => invoke<InteractiveGraph>("interactive_analyze", { documentId }),
    exportTwee: (documentId?: string, title?: string) => invoke<string>("interactive_export_twee", { documentId, title }),
    exportHtml: (documentId?: string, title?: string) => invoke<string>("interactive_export_html", { documentId, title }),
    exportJson: (documentId?: string, title?: string) => invoke<string>("interactive_export_json", { documentId, title }),
  },
  treatment: {
    dialog: treatmentDialog,
    analyze: (documentId?: string) => invoke<TreatmentDoc>("treatment_analyze", { documentId }),
    exportHtml: (documentId?: string, title?: string) => invoke<string>("treatment_export_html", { documentId, title }),
    exportText: (documentId?: string, title?: string) => invoke<string>("treatment_export_text", { documentId, title }),
    exportDocx: (documentId?: string, title?: string) => invoke<number[]>("treatment_export_docx", { documentId, title }),
  },
  grammar: {
    dialog: grammarDialog,
    analyze: (documentId?: string, ignoredRules: string[] = [], ignoredWords: string[] = []) =>
      invoke<GrammarAnalysisReport>("grammar_analyze", { documentId, ignoredRules, ignoredWords }),
    applyFix: (
      blockId: string,
      offset: number,
      length: number,
      replacement: string,
      documentId?: string,
      ignoredRules: string[] = [],
      ignoredWords: string[] = []
    ) =>
      invoke<GrammarAnalysisReport>("grammar_apply_fix", {
        documentId,
        blockId,
        offset,
        length,
        replacement,
        ignoredRules,
        ignoredWords,
      }),
  },
  exportStageplayText: (documentId?: string, title?: string) => invoke<string>("export_stageplay_text", { documentId, title }),
  exportTeleplayText: (documentId?: string, title?: string) => invoke<string>("export_teleplay_text", { documentId, title }),
  bible,
  timeline,
  evidence,
  bookmarks,
  projectTree,
  openDocument: (id: string) => openWith("open_document", { id }),
  notes: notesPanel,
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
  exportReport,
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
  reorderScenes: (order: string[]) => {
    const tr = reorderScenes(view.state, order);
    if (tr) view.dispatch(tr);
    return !!tr;
  },
  moveCard: (id: string, before: string | null) => moveCard({ ...script(), move: boardMove }, board, id, before, rerenderSide),
  setStructural,
  panels: panelHost,
  putBeat,
  reloadPlanning: refreshPlanning,
  /** Send a command exactly as a pop-out panel window does (tests). */
  panelCommand: (c: unknown) => emitTo("main", "panel-command", c),
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
