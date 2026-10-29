// View > Tools > StoryScry… (M4 step 1, ACCEPTANCE B6, E6–E8): production
// reports and original SVG charts (owner decision A) built from the core's
// `cirth_core::reports` row data.
//
// Rules enforced here:
// - Every report states its scope (which scripts, whether omitted scenes are
//   counted) and the script version (`source_version`) it was made from.
// - When the script or planning data changes while StoryScry is open or while
//   a report is calculating, the report is flagged out of date with a Refresh
//   button instead of silently presenting stale numbers as current (B6).
// - Charts and tables read the exact same row arrays (E8).
// - Every chart has a table view, estimates are labelled as estimates, and
//   colour is paired with text labels, stroke patterns or marker shapes so
//   colour is never the only signal.

import { announce } from "./a11y";
import { eighths } from "./views";

export interface ReportScope {
  mode: "document" | "episodes" | "project";
  documents: string[];
  include_omitted: boolean;
}

export interface ScopeDoc {
  id: string;
  title: string;
}

export interface SceneRow {
  document_id: string;
  document_title: string;
  scene_id: string;
  number: string;
  omitted: boolean;
  heading: string;
  int_ext: string;
  location: string;
  time_of_day: string;
  page: string;
  eighths: number;
  speakers: string[];
  dual_pairs: number;
  logline: string;
}

export interface CharacterRow {
  name: string;
  speeches: number;
  dual_speeches: number;
  words: number;
  share_pct: number;
  scenes: number;
  first_document_id: string;
  first_document_title: string;
  first_scene_id: string;
  first_scene_number: string;
  first_page: string;
}

export interface LocationRow {
  name: string;
  int_ext: string;
  scenes: number;
  eighths: number;
  first_document_id: string;
  first_document_title: string;
  first_scene_id: string;
  first_scene_number: string;
  first_page: string;
  last_document_id: string;
  last_document_title: string;
  last_scene_id: string;
  last_scene_number: string;
  last_page: string;
}

export interface ActionDialogueSceneRow {
  document_id: string;
  document_title: string;
  scene_id: string;
  number: string;
  heading: string;
  page: string;
  eighths: number;
  action_words: number;
  dialogue_words: number;
  action_lines: number;
  dialogue_lines: number;
  dialogue_word_pct: number;
}

export interface ActionDialogueReport {
  action_words: number;
  dialogue_words: number;
  action_lines: number;
  dialogue_lines: number;
  action_word_pct: number;
  dialogue_word_pct: number;
  action_line_pct: number;
  dialogue_line_pct: number;
  scenes: ActionDialogueSceneRow[];
}

export interface BucketRow {
  label: string;
  scenes: number;
  eighths: number;
  scene_pct: number;
  eighths_pct: number;
}

export interface RevisionRow {
  document_id: string;
  document_title: string;
  set_id: string;
  label: string;
  colour: string;
  date: string;
  mark: string;
  author: string;
  active: boolean;
  changed_pages: number;
  page_labels: string[];
  passages: number;
}

export interface ReportBundle {
  source_version: number;
  planning_version: number;
  scope: ReportScope;
  scope_label: string;
  documents: ScopeDoc[];
  all_documents: ScopeDoc[];
  include_omitted: boolean;
  omitted_in_scope: number;
  total_pages: number;
  total_eighths: number;
  scenes: SceneRow[];
  characters: CharacterRow[];
  locations: LocationRow[];
  action_dialogue: ActionDialogueReport;
  int_ext: BucketRow[];
  day_night: BucketRow[];
  revisions: RevisionRow[];
}

export type ReportTab =
  | "dashboard"
  | "scenes"
  | "characters"
  | "locations"
  | "action_dialogue"
  | "int_ext"
  | "day_night"
  | "revisions";

export type ExportableReport =
  | "all"
  | "scenes"
  | "characters"
  | "locations"
  | "action_dialogue"
  | "int_ext"
  | "day_night"
  | "revisions";

export type ReportFormat = "xlsx" | "csv" | "tsv" | "pdf" | "html" | "rtf";

export interface ReportExported {
  path: string;
  report: string;
  title: string;
  format: string;
  scope_label: string;
  source_version: number;
  planning_version: number;
  bytes: number;
  notes: string[];
}

const TABS: { id: ReportTab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "scenes", label: "Scenes" },
  { id: "characters", label: "Characters" },
  { id: "locations", label: "Locations" },
  { id: "action_dialogue", label: "Action vs Dialogue" },
  { id: "int_ext", label: "Interior vs Exterior" },
  { id: "day_night", label: "Day vs Night" },
  { id: "revisions", label: "Revisions" },
];

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** Distinct stroke dash patterns so colour is never the only signal in charts. */
const DASHES = ["none", "5,2", "2,2", "7,2,2,2", "9,3", "3,3"];

/** Nightingale (polar area) SVG chart for share buckets (INT/EXT, Day/Night, Locations). */
function nightingaleChart(
  title: string,
  slices: { label: string; value: number; detail: string }[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "storyscry-chart-wrap";
  const nonZero = slices.filter((s) => s.value > 0);
  if (!nonZero.length) {
    const empty = document.createElement("p");
    empty.className = "form-note";
    empty.textContent = "No scenes in the selected scope.";
    wrap.append(empty);
    return wrap;
  }
  const svg = svgEl("svg", { viewBox: "0 0 220 140", class: "storyscry-svg", role: "img", "aria-label": title });
  const cx = 72;
  const cy = 70;
  const maxR = 54;
  const maxVal = Math.max(...slices.map((s) => s.value), 1);

  // Reference rings at 50% and 100%.
  for (const r of [maxR * 0.5, maxR]) {
    svg.append(svgEl("circle", { cx, cy, r: r.toFixed(1), class: "chart-ring" }));
  }

  const n = slices.length;
  slices.forEach((s, i) => {
    if (s.value <= 0) return;
    // Radius proportional to sqrt(value / maxVal) so sector area matches value.
    const r = Math.max(8, Math.sqrt(s.value / maxVal) * maxR);
    if (nonZero.length === 1 || n === 1) {
      svg.append(
        svgEl("circle", {
          cx,
          cy,
          r: r.toFixed(1),
          class: `chart-slice chart-c${i % 6}`,
          "stroke-dasharray": DASHES[i % DASHES.length],
        }),
      );
      return;
    }
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    svg.append(
      svgEl("path", {
        d,
        class: `chart-slice chart-c${i % 6}`,
        "stroke-dasharray": DASHES[i % DASHES.length],
      }),
    );
  });

  const legend = document.createElement("ul");
  legend.className = "storyscry-legend";
  slices.forEach((s, i) => {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = `chart-swatch chart-c${i % 6}`;
    sw.textContent = ["●", "■", "◆", "▲", "▼", "★"][i % 6];
    sw.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.textContent = `${s.label}: ${s.detail}`;
    li.append(sw, txt);
    legend.append(li);
  });
  wrap.append(svg, legend);
  return wrap;
}

/** Bullet chart comparing Action vs Dialogue shares for words and lines. */
function actionDialogueBulletChart(ad: ActionDialogueReport): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "storyscry-chart-wrap";
  const svg = svgEl("svg", {
    viewBox: "0 0 320 100",
    class: "storyscry-svg",
    role: "img",
    "aria-label": `Action vs dialogue: ${ad.dialogue_word_pct}% dialogue words, ${ad.action_word_pct}% action words`,
  });

  const rows = [
    { label: "Words", dlgPct: ad.dialogue_word_pct, actPct: ad.action_word_pct, y: 18, note: `Dialogue ${ad.dialogue_words.toLocaleString()} (${ad.dialogue_word_pct}%) · Action ${ad.action_words.toLocaleString()} (${ad.action_word_pct}%)` },
    { label: "Lines", dlgPct: ad.dialogue_line_pct, actPct: ad.action_line_pct, y: 58, note: `Dialogue ${ad.dialogue_lines.toLocaleString()} (${ad.dialogue_line_pct}%) · Action ${ad.action_lines.toLocaleString()} (${ad.action_line_pct}%)` },
  ];
  const barX = 52;
  const barW = 250;
  for (const r of rows) {
    const t = svgEl("text", { x: 4, y: r.y + 11, class: "chart-label" });
    t.textContent = r.label;
    svg.append(t);
    // Background track (100% = action + dialogue).
    svg.append(svgEl("rect", { x: barX, y: r.y, width: barW, height: 14, rx: 2, class: "chart-track" }));
    // Dialogue bar from left.
    const w = Math.max(0, Math.min(barW, (r.dlgPct / 100) * barW));
    svg.append(svgEl("rect", { x: barX, y: r.y, width: w.toFixed(1), height: 14, rx: 2, class: "chart-slice chart-c0" }));
    // 50% reference tick.
    const mid = barX + barW * 0.5;
    svg.append(svgEl("line", { x1: mid, y1: r.y - 3, x2: mid, y2: r.y + 17, class: "chart-target" }));
    const sub = svgEl("text", { x: barX, y: r.y + 28, class: "chart-sub" });
    sub.textContent = r.note;
    svg.append(sub);
  }
  wrap.append(svg);
  return wrap;
}

/** Dot plot of top speaking characters (words and speeches). */
function characterDotPlot(chars: CharacterRow[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "storyscry-chart-wrap";
  if (!chars.length) {
    const empty = document.createElement("p");
    empty.className = "form-note";
    empty.textContent = "No speaking characters in the selected scope.";
    wrap.append(empty);
    return wrap;
  }
  const top = chars.slice(0, 6);
  const maxWords = Math.max(...top.map((c) => c.words), 1);
  const h = top.length * 22 + 14;
  const svg = svgEl("svg", {
    viewBox: `0 0 320 ${h}`,
    class: "storyscry-svg",
    role: "img",
    "aria-label": "Character dialogue words dot plot",
  });
  const x0 = 96;
  const x1 = 235;
  top.forEach((c, i) => {
    const y = 14 + i * 22;
    const lbl = svgEl("text", { x: 4, y: y + 4, class: "chart-label" });
    lbl.textContent = c.name.length > 13 ? `${c.name.slice(0, 12)}…` : c.name;
    const line = svgEl("line", { x1: x0, y1: y, x2: x1, y2: y, class: "chart-stem" });
    const cx = x0 + (c.words / maxWords) * (x1 - x0);
    const dot = svgEl("circle", { cx: cx.toFixed(1), cy: y, r: 5, class: `chart-slice chart-c${i % 6}` });
    const val = svgEl("text", { x: x1 + 8, y: y + 4, class: "chart-sub" });
    val.textContent = `${c.words} w (${c.speeches} sp)`;
    svg.append(lbl, line, dot, val);
  });
  wrap.append(svg);
  return wrap;
}

/** Bar chart of scene lengths in eighths of a page (estimate) with average reference line. */
function sceneLengthsChart(scenes: SceneRow[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "storyscry-chart-wrap";
  if (!scenes.length) {
    const empty = document.createElement("p");
    empty.className = "form-note";
    empty.textContent = "No scenes in the selected scope.";
    wrap.append(empty);
    return wrap;
  }
  const shown = scenes.slice(0, 24);
  const maxE = Math.max(...shown.map((s) => s.eighths), 8);
  const avgE = scenes.reduce((a, s) => a + s.eighths, 0) / scenes.length;
  const svg = svgEl("svg", {
    viewBox: "0 0 320 110",
    class: "storyscry-svg",
    role: "img",
    "aria-label": `Scene lengths in eighths of a page (estimate), average ${eighths(Math.round(avgE))} pages`,
  });
  const x0 = 8;
  const w = 304;
  const baseY = 86;
  const maxH = 68;
  const barW = Math.max(4, Math.min(22, Math.floor(w / shown.length) - 2));
  shown.forEach((s, i) => {
    const bh = Math.max(3, (s.eighths / maxE) * maxH);
    const x = x0 + i * (barW + 2);
    const rect = svgEl("rect", {
      x,
      y: (baseY - bh).toFixed(1),
      width: barW,
      height: bh.toFixed(1),
      class: `chart-slice chart-c${i % 6}`,
    });
    const title = svgEl("title");
    title.textContent = `Scene ${s.number}: ${s.heading} — ${eighths(s.eighths)} p (estimate)`;
    rect.append(title);
    svg.append(rect);
  });
  const avgY = baseY - (avgE / maxE) * maxH;
  svg.append(svgEl("line", { x1: x0, y1: avgY.toFixed(1), x2: x0 + w, y2: avgY.toFixed(1), class: "chart-target", "stroke-dasharray": "4,3" }));
  const cap = svgEl("text", { x: x0, y: 103, class: "chart-sub" });
  cap.textContent = `${scenes.length} scene${scenes.length === 1 ? "" : "s"} · mean ≈ ${eighths(Math.max(1, Math.round(avgE)))} p (estimate)`;
  svg.append(cap);
  wrap.append(svg);
  return wrap;
}

/** Bar chart of revision sets (changed pages and passages). */
function revisionsChart(revs: RevisionRow[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "storyscry-chart-wrap";
  if (!revs.length) {
    const empty = document.createElement("p");
    empty.className = "form-note";
    empty.textContent = "No revision sets in the selected scope.";
    wrap.append(empty);
    return wrap;
  }
  const top = revs.slice(0, 6);
  const maxPages = Math.max(...top.map((r) => r.changed_pages), 1);
  const h = top.length * 22 + 14;
  const svg = svgEl("svg", {
    viewBox: `0 0 320 ${h}`,
    class: "storyscry-svg",
    role: "img",
    "aria-label": "Revision sets changed pages and passages",
  });
  const x0 = 110;
  const maxW = 120;
  top.forEach((r, i) => {
    const y = 6 + i * 22;
    const lbl = svgEl("text", { x: 4, y: y + 11, class: "chart-label" });
    const text = `${r.mark} ${r.label}`;
    lbl.textContent = text.length > 15 ? `${text.slice(0, 14)}…` : text;
    const bw = Math.max(2, (r.changed_pages / maxPages) * maxW);
    svg.append(lbl, svgEl("rect", { x: x0, y, width: bw.toFixed(1), height: 13, rx: 2, class: `chart-slice chart-c${i % 6}` }));
    const val = svgEl("text", { x: x0 + maxW + 8, y: y + 11, class: "chart-sub" });
    val.textContent = `${r.changed_pages} p · ${r.passages} pass.`;
    svg.append(val);
  });
  wrap.append(svg);
  return wrap;
}

export function createStoryScry(hooks: {
  fetch: (scope: ReportScope) => Promise<ReportBundle>;
  versions: () => { scriptVersion: number; hasUnsynced: boolean; planningVersion: number };
  go: (documentId: string, sceneId: string) => void;
  exportReport: (scope: ReportScope, report: ExportableReport, format: ReportFormat, path?: string) => Promise<ReportExported | null>;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "storyscry-dialog";
  dialog.className = "about storyscry";
  dialog.setAttribute("aria-labelledby", "storyscry-title");

  const head = document.createElement("div");
  head.className = "storyscry-head";
  const h = document.createElement("h2");
  h.id = "storyscry-title";
  h.textContent = "StoryScry";
  const stampEl = document.createElement("span");
  stampEl.id = "storyscry-stamp";
  stampEl.className = "form-note storyscry-stamp";
  head.append(h, stampEl);

  const tools = document.createElement("div");
  tools.className = "storyscry-tools";
  const scopeSel = document.createElement("select");
  scopeSel.id = "storyscry-scope";
  scopeSel.setAttribute("aria-label", "Report scope");
  scopeSel.append(
    new Option("This script", "document"),
    new Option("Selected scripts…", "episodes"),
    new Option("Whole project", "project"),
  );

  const omittedLabel = document.createElement("label");
  omittedLabel.className = "storyscry-check";
  const omittedCheck = document.createElement("input");
  omittedCheck.type = "checkbox";
  omittedCheck.id = "storyscry-omitted";
  omittedLabel.append(omittedCheck, " Include omitted scenes");

  const tablesBtn = document.createElement("button");
  tablesBtn.type = "button";
  tablesBtn.id = "storyscry-tables-toggle";
  tablesBtn.setAttribute("aria-pressed", "false");
  tablesBtn.textContent = "Show charts as tables";

  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.id = "storyscry-filter";
  filterInput.placeholder = "Filter report rows…";
  filterInput.setAttribute("aria-label", "Filter report rows");
  filterInput.hidden = true;

  const estNote = document.createElement("span");
  estNote.className = "form-note storyscry-note";
  estNote.textContent = "Page and eighth lengths are estimates from the layout.";

  tools.append(scopeSel, omittedLabel, tablesBtn, filterInput, estNote);

  const episodesBar = document.createElement("div");
  episodesBar.id = "storyscry-episodes";
  episodesBar.className = "storyscry-episodes";
  episodesBar.hidden = true;

  const staleBar = document.createElement("div");
  staleBar.id = "storyscry-stale";
  staleBar.className = "storyscry-stale";
  staleBar.setAttribute("role", "status");
  staleBar.hidden = true;
  const staleText = document.createElement("span");
  staleText.id = "storyscry-stale-text";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.id = "storyscry-refresh";
  refreshBtn.textContent = "Refresh";
  staleBar.append(staleText, refreshBtn);

  const tabBar = document.createElement("div");
  tabBar.className = "about-tabs storyscry-tabs";
  tabBar.setAttribute("role", "tablist");
  const tabButtons = new Map<ReportTab, HTMLButtonElement>();
  for (const t of TABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.id === "dashboard"));
    b.className = t.id === "dashboard" ? "current" : "";
    b.textContent = t.label;
    b.addEventListener("click", () => selectTab(t.id));
    tabBar.append(b);
    tabButtons.set(t.id, b);
  }

  const body = document.createElement("div");
  body.id = "storyscry-body";
  body.className = "storyscry-body";

  const exportBar = document.createElement("div");
  exportBar.className = "storyscry-export-bar";
  const exportReportSel = document.createElement("select");
  exportReportSel.id = "storyscry-export-report";
  exportReportSel.setAttribute("aria-label", "Report to export");
  exportReportSel.append(
    new Option("All reports", "all"),
    new Option("Scenes report", "scenes"),
    new Option("Characters report", "characters"),
    new Option("Locations report", "locations"),
    new Option("Action vs Dialogue report", "action_dialogue"),
    new Option("Interior vs Exterior report", "int_ext"),
    new Option("Day vs Night report", "day_night"),
    new Option("Revisions report", "revisions"),
  );
  const exportFormatSel = document.createElement("select");
  exportFormatSel.id = "storyscry-export-format";
  exportFormatSel.setAttribute("aria-label", "Report export format");
  exportFormatSel.append(
    new Option("Spreadsheet (.xlsx)", "xlsx"),
    new Option("CSV (.csv)", "csv"),
    new Option("TSV (.tsv)", "tsv"),
    new Option("PDF (.pdf)", "pdf"),
    new Option("Web page (.html)", "html"),
    new Option("Rich Text (.rtf)", "rtf"),
  );
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.id = "storyscry-export-btn";
  exportBtn.textContent = "Export…";
  const exportStatus = document.createElement("span");
  exportStatus.id = "storyscry-export-status";
  exportStatus.className = "form-note storyscry-export-status";
  exportBar.append(exportReportSel, exportFormatSel, exportBtn, exportStatus);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.id = "storyscry-close";
  closeBtn.textContent = "Close";
  const actions = document.createElement("div");
  actions.className = "dialog-actions storyscry-actions";
  actions.append(exportBar, closeBtn);

  dialog.append(head, tools, episodesBar, staleBar, tabBar, body, actions);
  document.body.append(dialog);

  let data: ReportBundle | null = null;
  let tab: ReportTab = "dashboard";
  let showTables = false;
  let chosenDocs = new Set<string>();
  let sortCol = "";
  let sortAsc = true;
  let stale = false;
  let loadingSeq = 0;

  function go(docId: string, sceneId: string) {
    dialog.close();
    hooks.go(docId, sceneId);
  }

  function sceneBtn(label: string, docId: string, sceneId: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "storyscry-go";
    b.textContent = label || "(scene)";
    b.addEventListener("click", () => go(docId, sceneId));
    return b;
  }

  function checkStaleness() {
    if (!data) {
      stale = false;
      staleBar.hidden = true;
      return;
    }
    const v = hooks.versions();
    stale = v.hasUnsynced || v.scriptVersion !== data.source_version || v.planningVersion !== data.planning_version;
    staleBar.hidden = !stale;
    if (stale) {
      staleText.textContent = `Out of date: this report shows script v${data.source_version} (project now has newer changes).`;
    }
    updateStamp();
  }

  function updateStamp() {
    if (!data) {
      stampEl.textContent = "";
      return;
    }
    const status = stale ? `out of date (made from v${data.source_version})` : `v${data.source_version}`;
    stampEl.textContent = `${data.scope_label} · ${status} · ${data.total_pages} page${data.total_pages === 1 ? "" : "s"} · scenes sum to ≈ ${eighths(data.total_eighths)} p (estimate)`;
  }

  function renderEpisodesPicker() {
    if (!data || scopeSel.value !== "episodes") {
      episodesBar.hidden = true;
      return;
    }
    episodesBar.hidden = false;
    episodesBar.replaceChildren();
    if (!chosenDocs.size) {
      for (const d of data.documents) chosenDocs.add(d.id);
    }
    for (const d of data.all_documents) {
      const lbl = document.createElement("label");
      lbl.className = "storyscry-ep-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = d.id;
      cb.checked = chosenDocs.has(d.id);
      cb.addEventListener("change", () => {
        if (cb.checked) chosenDocs.add(d.id);
        else if (chosenDocs.size > 1) chosenDocs.delete(d.id);
        else cb.checked = true;
        void load();
      });
      lbl.append(cb, ` ${d.title || "(untitled)"}`);
      episodesBar.append(lbl);
    }
  }

  function selectTab(next: ReportTab) {
    if (tab !== next) {
      sortCol = "";
      sortAsc = true;
    }
    tab = next;
    exportReportSel.value = tab === "dashboard" ? "all" : tab;
    for (const [id, b] of tabButtons) {
      const on = id === tab;
      b.classList.toggle("current", on);
      b.setAttribute("aria-selected", String(on));
    }
    tablesBtn.hidden = tab !== "dashboard";
    filterInput.hidden = tab === "dashboard";
    draw();
  }

  function makeSortableTable<T>(
    id: string,
    columns: { key: string; label: string; val: (row: T) => string | number; cell: (td: HTMLTableCellElement, row: T) => void }[],
    rows: T[],
    filterFn: (row: T, q: string) => boolean,
  ): HTMLElement {
    const q = filterInput.value.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => filterFn(r, q)) : rows.slice();
    const activeCol = columns.find((c) => c.key === sortCol);
    if (activeCol) {
      filtered.sort((a, b) => {
        const va = activeCol.val(a);
        const vb = activeCol.val(b);
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      });
    }
    const table = document.createElement("table");
    table.id = id;
    table.className = "storyscry-table";
    const hr = table.createTHead().insertRow();
    for (const col of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      const sorted = sortCol === col.key;
      th.setAttribute("aria-sort", sorted ? (sortAsc ? "ascending" : "descending") : "none");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "storyscry-sort";
      btn.dataset.sort = col.key;
      btn.textContent = sorted ? `${col.label} ${sortAsc ? "▲" : "▼"}` : col.label;
      btn.addEventListener("click", () => {
        if (sortCol === col.key) sortAsc = !sortAsc;
        else {
          sortCol = col.key;
          sortAsc = true;
        }
        draw();
      });
      th.append(btn);
      hr.append(th);
    }
    const tb = table.createTBody();
    for (const row of filtered) {
      const tr = tb.insertRow();
      for (const col of columns) {
        const td = tr.insertCell();
        col.cell(td, row);
      }
    }
    return table;
  }

  function compactTable(headers: string[], rows: string[][]): HTMLTableElement {
    const t = document.createElement("table");
    t.className = "storyscry-mini-table";
    const hr = t.createTHead().insertRow();
    for (const h of headers) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      hr.append(th);
    }
    const tb = t.createTBody();
    for (const r of rows) {
      const tr = tb.insertRow();
      for (const c of r) tr.insertCell().textContent = c;
    }
    return t;
  }

  function drawDashboard(d: ReportBundle) {
    const grid = document.createElement("div");
    grid.className = "storyscry-grid";

    const addCard = (reportId: ReportTab, title: string, summary: string, chartFn: () => HTMLElement, tableFn: () => HTMLElement) => {
      const card = document.createElement("section");
      card.className = "storyscry-card";
      card.dataset.report = reportId;
      const top = document.createElement("div");
      top.className = "storyscry-card-head";
      const h3 = document.createElement("h3");
      h3.textContent = title;
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "storyscry-open-report";
      openBtn.dataset.openReport = reportId;
      openBtn.textContent = "Open report";
      openBtn.addEventListener("click", () => selectTab(reportId));
      top.append(h3, openBtn);
      const sub = document.createElement("p");
      sub.className = "form-note storyscry-card-sub";
      sub.textContent = summary;
      card.append(top, sub, showTables ? tableFn() : chartFn());
      grid.append(card);
    };

    addCard(
      "scenes",
      "Scenes",
      `${d.scenes.length} scene${d.scenes.length === 1 ? "" : "s"} · ≈ ${eighths(d.total_eighths)} pages (estimate)`,
      () => sceneLengthsChart(d.scenes),
      () =>
        compactTable(
          ["#", "Heading", "Page", "Length (est.)"],
          d.scenes.slice(0, 8).map((s) => [s.number, s.heading || "(empty heading)", s.page, `${eighths(s.eighths)} p`]),
        ),
    );

    addCard(
      "characters",
      "Characters",
      `${d.characters.length} speaking character${d.characters.length === 1 ? "" : "s"}`,
      () => characterDotPlot(d.characters),
      () =>
        compactTable(
          ["Character", "Speeches", "Words", "Share", "Scenes"],
          d.characters.slice(0, 8).map((c) => [c.name, String(c.speeches), String(c.words), `${c.share_pct}%`, String(c.scenes)]),
        ),
    );

    addCard(
      "locations",
      "Locations",
      `${d.locations.length} location${d.locations.length === 1 ? "" : "s"}`,
      () =>
        nightingaleChart(
          "Locations by length in eighths (estimate)",
          d.locations.slice(0, 6).map((l) => ({ label: l.name, value: l.eighths, detail: `${l.scenes} sc · ≈ ${eighths(l.eighths)} p (est.)` })),
        ),
      () =>
        compactTable(
          ["Location", "INT/EXT", "Scenes", "Length (est.)"],
          d.locations.slice(0, 8).map((l) => [l.name, l.int_ext, String(l.scenes), `${eighths(l.eighths)} p`]),
        ),
    );

    const ad = d.action_dialogue;
    addCard(
      "action_dialogue",
      "Action vs Dialogue",
      `Dialogue ${ad.dialogue_word_pct}% of words (${ad.dialogue_line_pct}% of lines)`,
      () => actionDialogueBulletChart(ad),
      () =>
        compactTable(
          ["Kind", "Words", "Word %", "Lines", "Line %"],
          [
            ["Dialogue", String(ad.dialogue_words), `${ad.dialogue_word_pct}%`, String(ad.dialogue_lines), `${ad.dialogue_line_pct}%`],
            ["Action", String(ad.action_words), `${ad.action_word_pct}%`, String(ad.action_lines), `${ad.action_line_pct}%`],
          ],
        ),
    );

    addCard(
      "int_ext",
      "Interior vs Exterior",
      d.int_ext.map((r) => `${r.label} ${r.scenes}`).join(" · "),
      () =>
        nightingaleChart(
          "Interior vs exterior scenes",
          d.int_ext.map((r) => ({ label: r.label, value: r.scenes, detail: `${r.scenes} sc (${r.scene_pct}%) · ≈ ${eighths(r.eighths)} p (est.)` })),
        ),
      () =>
        compactTable(
          ["Setting", "Scenes", "Scene %", "Length (est.)", "Length %"],
          d.int_ext.map((r) => [r.label, String(r.scenes), `${r.scene_pct}%`, `${eighths(r.eighths)} p`, `${r.eighths_pct}%`]),
        ),
    );

    addCard(
      "day_night",
      "Day vs Night",
      d.day_night.slice(0, 4).map((r) => `${r.label} ${r.scenes}`).join(" · ") || "No scenes",
      () =>
        nightingaleChart(
          "Day vs night scenes",
          d.day_night.slice(0, 6).map((r) => ({ label: r.label, value: r.scenes, detail: `${r.scenes} sc (${r.scene_pct}%) · ≈ ${eighths(r.eighths)} p (est.)` })),
        ),
      () =>
        compactTable(
          ["Time of day", "Scenes", "Scene %", "Length (est.)", "Length %"],
          d.day_night.map((r) => [r.label, String(r.scenes), `${r.scene_pct}%`, `${eighths(r.eighths)} p`, `${r.eighths_pct}%`]),
        ),
    );

    addCard(
      "revisions",
      "Revisions",
      `${d.revisions.length} revision set${d.revisions.length === 1 ? "" : "s"}`,
      () => revisionsChart(d.revisions),
      () =>
        compactTable(
          ["Set", "Colour", "Date", "Changed pages", "Passages"],
          d.revisions.map((r) => [r.label, r.colour, r.date || "—", String(r.changed_pages), String(r.passages)]),
        ),
    );

    body.append(grid);
  }

  function drawReport(d: ReportBundle) {
    const multiDoc = d.documents.length > 1;
    switch (tab) {
      case "scenes": {
        body.append(
          makeSortableTable<SceneRow>(
            "storyscry-scenes-table",
            [
              ...(multiDoc ? [{ key: "doc", label: "Script", val: (r: SceneRow) => r.document_title, cell: (td: HTMLTableCellElement, r: SceneRow) => (td.textContent = r.document_title) }] : []),
              { key: "number", label: "#", val: (r) => r.number, cell: (td, r) => (td.textContent = r.omitted ? `${r.number} (omitted)` : r.number) },
              { key: "int_ext", label: "INT/EXT", val: (r) => r.int_ext, cell: (td, r) => (td.textContent = r.int_ext) },
              {
                key: "location",
                label: "Location",
                val: (r) => r.location || r.heading,
                cell: (td, r) => td.append(sceneBtn(r.location || r.heading || "(empty heading)", r.document_id, r.scene_id)),
              },
              { key: "tod", label: "Time", val: (r) => r.time_of_day, cell: (td, r) => (td.textContent = r.time_of_day) },
              { key: "page", label: "Page", val: (r) => r.page, cell: (td, r) => (td.textContent = r.page) },
              { key: "eighths", label: "Length (est.)", val: (r) => r.eighths, cell: (td, r) => (td.textContent = `${eighths(r.eighths)} p`) },
              {
                key: "speakers",
                label: "Speakers",
                val: (r) => r.speakers.length,
                cell: (td, r) => (td.textContent = r.speakers.join(", ") + (r.dual_pairs ? ` (${r.dual_pairs} dual)` : "")),
              },
              { key: "logline", label: "Logline", val: (r) => r.logline, cell: (td, r) => (td.textContent = r.logline) },
            ],
            d.scenes,
            (r, q) =>
              [r.number, r.heading, r.location, r.time_of_day, r.logline, r.document_title, ...r.speakers]
                .join(" ")
                .toLowerCase()
                .includes(q),
          ),
        );
        break;
      }
      case "characters": {
        body.append(
          makeSortableTable<CharacterRow>(
            "storyscry-characters-table",
            [
              { key: "name", label: "Character", val: (r) => r.name, cell: (td, r) => (td.textContent = r.name) },
              {
                key: "speeches",
                label: "Speeches",
                val: (r) => r.speeches,
                cell: (td, r) => (td.textContent = r.dual_speeches ? `${r.speeches} (${r.dual_speeches} dual)` : String(r.speeches)),
              },
              { key: "words", label: "Dialogue words", val: (r) => r.words, cell: (td, r) => (td.textContent = r.words.toLocaleString()) },
              { key: "share", label: "Share of dialogue", val: (r) => r.share_pct, cell: (td, r) => (td.textContent = `${r.share_pct}%`) },
              { key: "scenes", label: "Scenes speaking", val: (r) => r.scenes, cell: (td, r) => (td.textContent = String(r.scenes)) },
              {
                key: "first",
                label: "First appearance",
                val: (r) => `${r.first_document_title} ${r.first_scene_number}`,
                cell: (td, r) =>
                  td.append(
                    sceneBtn(
                      `${multiDoc ? `${r.first_document_title} · ` : ""}Scene ${r.first_scene_number} (p. ${r.first_page})`,
                      r.first_document_id,
                      r.first_scene_id,
                    ),
                  ),
              },
            ],
            d.characters,
            (r, q) => r.name.toLowerCase().includes(q),
          ),
        );
        break;
      }
      case "locations": {
        body.append(
          makeSortableTable<LocationRow>(
            "storyscry-locations-table",
            [
              { key: "name", label: "Location", val: (r) => r.name, cell: (td, r) => (td.textContent = r.name) },
              { key: "int_ext", label: "INT/EXT", val: (r) => r.int_ext, cell: (td, r) => (td.textContent = r.int_ext) },
              { key: "scenes", label: "Scenes", val: (r) => r.scenes, cell: (td, r) => (td.textContent = String(r.scenes)) },
              { key: "eighths", label: "Length (est.)", val: (r) => r.eighths, cell: (td, r) => (td.textContent = `${eighths(r.eighths)} p`) },
              {
                key: "first",
                label: "First use",
                val: (r) => r.first_scene_number,
                cell: (td, r) =>
                  td.append(
                    sceneBtn(
                      `${multiDoc ? `${r.first_document_title} · ` : ""}Scene ${r.first_scene_number} (p. ${r.first_page})`,
                      r.first_document_id,
                      r.first_scene_id,
                    ),
                  ),
              },
              {
                key: "last",
                label: "Last use",
                val: (r) => r.last_scene_number,
                cell: (td, r) =>
                  td.append(
                    sceneBtn(
                      `${multiDoc ? `${r.last_document_title} · ` : ""}Scene ${r.last_scene_number} (p. ${r.last_page})`,
                      r.last_document_id,
                      r.last_scene_id,
                    ),
                  ),
              },
            ],
            d.locations,
            (r, q) => `${r.name} ${r.int_ext}`.toLowerCase().includes(q),
          ),
        );
        break;
      }
      case "action_dialogue": {
        const ad = d.action_dialogue;
        const summary = document.createElement("p");
        summary.className = "form-note";
        summary.textContent = `Overall: Action ${ad.action_words.toLocaleString()} words (${ad.action_word_pct}%), ${ad.action_lines.toLocaleString()} lines (${ad.action_line_pct}%) · Dialogue ${ad.dialogue_words.toLocaleString()} words (${ad.dialogue_word_pct}%), ${ad.dialogue_lines.toLocaleString()} lines (${ad.dialogue_line_pct}%).`;
        body.append(
          summary,
          makeSortableTable<ActionDialogueSceneRow>(
            "storyscry-ad-table",
            [
              ...(multiDoc ? [{ key: "doc", label: "Script", val: (r: ActionDialogueSceneRow) => r.document_title, cell: (td: HTMLTableCellElement, r: ActionDialogueSceneRow) => (td.textContent = r.document_title) }] : []),
              { key: "number", label: "#", val: (r) => r.number, cell: (td, r) => (td.textContent = r.number) },
              { key: "heading", label: "Scene", val: (r) => r.heading, cell: (td, r) => td.append(sceneBtn(r.heading || "(empty heading)", r.document_id, r.scene_id)) },
              { key: "action_words", label: "Action words", val: (r) => r.action_words, cell: (td, r) => (td.textContent = r.action_words.toLocaleString()) },
              { key: "dialogue_words", label: "Dialogue words", val: (r) => r.dialogue_words, cell: (td, r) => (td.textContent = r.dialogue_words.toLocaleString()) },
              { key: "action_lines", label: "Action lines", val: (r) => r.action_lines, cell: (td, r) => (td.textContent = r.action_lines.toLocaleString()) },
              { key: "dialogue_lines", label: "Dialogue lines", val: (r) => r.dialogue_lines, cell: (td, r) => (td.textContent = r.dialogue_lines.toLocaleString()) },
              { key: "dlg_pct", label: "Dialogue word %", val: (r) => r.dialogue_word_pct, cell: (td, r) => (td.textContent = `${r.dialogue_word_pct}%`) },
            ],
            ad.scenes,
            (r, q) => `${r.number} ${r.heading} ${r.document_title}`.toLowerCase().includes(q),
          ),
        );
        break;
      }
      case "int_ext":
      case "day_night": {
        const rows = tab === "int_ext" ? d.int_ext : d.day_night;
        const labelHeader = tab === "int_ext" ? "Setting (INT/EXT)" : "Time of day";
        body.append(
          makeSortableTable<BucketRow>(
            `storyscry-${tab}-table`,
            [
              { key: "label", label: labelHeader, val: (r) => r.label, cell: (td, r) => (td.textContent = r.label) },
              { key: "scenes", label: "Scenes", val: (r) => r.scenes, cell: (td, r) => (td.textContent = String(r.scenes)) },
              { key: "scene_pct", label: "Scene %", val: (r) => r.scene_pct, cell: (td, r) => (td.textContent = `${r.scene_pct}%`) },
              { key: "eighths", label: "Length (est.)", val: (r) => r.eighths, cell: (td, r) => (td.textContent = `${eighths(r.eighths)} p`) },
              { key: "eighths_pct", label: "Length % (est.)", val: (r) => r.eighths_pct, cell: (td, r) => (td.textContent = `${r.eighths_pct}%`) },
            ],
            rows,
            (r, q) => r.label.toLowerCase().includes(q),
          ),
        );
        break;
      }
      case "revisions": {
        body.append(
          makeSortableTable<RevisionRow>(
            "storyscry-revisions-table",
            [
              ...(multiDoc ? [{ key: "doc", label: "Script", val: (r: RevisionRow) => r.document_title, cell: (td: HTMLTableCellElement, r: RevisionRow) => (td.textContent = r.document_title) }] : []),
              { key: "label", label: "Revision set", val: (r) => r.label, cell: (td, r) => (td.textContent = r.active ? `${r.label} (active)` : r.label) },
              { key: "colour", label: "Colour", val: (r) => r.colour, cell: (td, r) => (td.textContent = r.colour) },
              { key: "mark", label: "Mark", val: (r) => r.mark, cell: (td, r) => (td.textContent = r.mark) },
              { key: "date", label: "Date", val: (r) => r.date, cell: (td, r) => (td.textContent = r.date || "—") },
              { key: "pages", label: "Changed pages", val: (r) => r.changed_pages, cell: (td, r) => (td.textContent = r.changed_pages ? `${r.changed_pages} (${r.page_labels.join(", ")})` : "0") },
              { key: "passages", label: "Revised passages", val: (r) => r.passages, cell: (td, r) => (td.textContent = String(r.passages)) },
            ],
            d.revisions,
            (r, q) => `${r.label} ${r.colour} ${r.date} ${r.author} ${r.document_title}`.toLowerCase().includes(q),
          ),
        );
        break;
      }
    }
  }

  function draw() {
    body.replaceChildren();
    if (!data) return;
    checkStaleness();
    renderEpisodesPicker();
    if (tab === "dashboard") drawDashboard(data);
    else drawReport(data);
  }

  function currentScope(): ReportScope {
    const mode = (scopeSel.value as ReportScope["mode"]) || "document";
    return {
      mode,
      documents: mode === "episodes" ? [...chosenDocs] : [],
      include_omitted: omittedCheck.checked,
    };
  }

  async function load() {
    const seq = ++loadingSeq;
    const bundle = await hooks.fetch(currentScope());
    if (seq !== loadingSeq) return;
    data = bundle;
    if (scopeSel.value === "episodes" && !chosenDocs.size) {
      for (const d of bundle.documents) chosenDocs.add(d.id);
    }
    draw();
  }

  async function runExport(path?: string, reportOverride?: ExportableReport, formatOverride?: ReportFormat): Promise<ReportExported | null> {
    const rep = reportOverride ?? (exportReportSel.value as ExportableReport);
    const fmt = formatOverride ?? (exportFormatSel.value as ReportFormat);
    exportReportSel.value = rep;
    exportFormatSel.value = fmt;
    const res = await hooks.exportReport(currentScope(), rep, fmt, path);
    if (res) {
      exportStatus.textContent = `${res.title} (${res.format.toUpperCase()}) written: ${res.scope_label} · v${res.source_version}`;
      announce(`${res.title} exported as ${res.format.toUpperCase()}`);
    }
    return res;
  }

  scopeSel.addEventListener("change", () => void load());
  omittedCheck.addEventListener("change", () => void load());
  tablesBtn.addEventListener("click", () => {
    showTables = !showTables;
    tablesBtn.setAttribute("aria-pressed", String(showTables));
    tablesBtn.textContent = showTables ? "Show as charts" : "Show charts as tables";
    draw();
  });
  filterInput.addEventListener("input", () => draw());
  refreshBtn.addEventListener("click", () => void load());
  exportBtn.addEventListener("click", () => void runExport());
  closeBtn.addEventListener("click", () => dialog.close());

  return {
    async open(initialTab: ReportTab = "dashboard") {
      tab = initialTab;
      exportReportSel.value = tab === "dashboard" ? "all" : tab;
      exportStatus.textContent = "";
      for (const [id, b] of tabButtons) {
        const on = id === tab;
        b.classList.toggle("current", on);
        b.setAttribute("aria-selected", String(on));
      }
      tablesBtn.hidden = tab !== "dashboard";
      filterInput.hidden = tab === "dashboard";
      await load();
      if (!dialog.open) dialog.showModal();
      (tabButtons.get(tab) ?? closeBtn).focus();
      announce(`StoryScry opened: ${data?.scope_label ?? ""}`);
    },
    close: () => dialog.close(),
    refresh: () => load(),
    export: (path?: string, report?: ExportableReport, format?: ReportFormat) => runExport(path, report, format),
    scope: () => currentScope(),
    /** Called by main.ts when the script or planning state changes so an open report marks itself out of date (B6). */
    notifyChanged() {
      if (dialog.open && data) checkStaleness();
    },
    get isOpen() {
      return dialog.open;
    },
    get isStale() {
      checkStaleness();
      return stale;
    },
    get data() {
      return data;
    },
  };
}
