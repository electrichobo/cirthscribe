// Stripboard and schedule UI (M4 step 5, acceptance E3, E4, E9).
//
// Shows a vertical stack of scene strips with its own schedule order, day breaks,
// banners, an unscheduled pile, user strip notes, sorting, and an accessible color
// legend pairing color with distinct symbols and names (E3, E9).
// Dragging or reordering strips never modifies screenplay script text or order (E3).
// Canonical script edits refresh strip fields while preserving user schedule order
// and notes (E3). Omitted and deleted scenes remain in the schedule flagged visibly (E4).

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ReportExported, ReportScope } from "./storyscry";

export type StripKind = "scene" | "day_break" | "banner";

export interface Strip {
  id: string;
  kind: StripKind;
  document_id: string;
  document_title: string;
  scene_id?: string;
  scene_number: string;
  heading: string;
  int_ext: string;
  location: string;
  time_of_day: string;
  description: string;
  page: string;
  eighths: number;
  characters: string[];
  tags: string[];
  note: string;
  omitted: boolean;
  deleted: boolean;
  color_code: string;
  color_label: string;
  color_symbol: string;
  day_number?: number;
  day_title?: string;
  total_eighths?: number;
  total_scenes?: number;
  banner_text?: string;
}

export interface ScheduleState {
  scope: string;
  scope_label: string;
  scheduled: Strip[];
  unscheduled: Strip[];
  source_version: number;
  planning_version: number;
  total_scheduled_scenes: number;
  total_scheduled_eighths: number;
  total_shooting_days: number;
}

export interface StripboardHost {
  documentId: () => string;
  version: () => number;
  planningVersion: () => number;
  applyPlanning: (op: any) => Promise<boolean>;
  undoPlanning: () => Promise<boolean>;
  redoPlanning: () => Promise<boolean>;
  episodes: () => Promise<Array<{ id: string; title: string }>>;
  onGoToScene?: (sceneId: string) => void;
}

export function createStripboard(host: StripboardHost) {
  let dialog: HTMLDialogElement | null = null;
  let currentState: ScheduleState | null = null;
  let currentScope: ReportScope = {
    mode: "document",
    documents: [host.documentId()],
    include_omitted: true,
  };
  let renderedScriptVersion = 0;
  let renderedPlanningVersion = 0;

  function ensureDialog(): HTMLDialogElement {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "stripboard-dialog";
    dialog.className = "about stripboard";
    dialog.setAttribute("aria-labelledby", "stripboard-title");

    dialog.innerHTML = `
      <div class="stripboard-head">
        <div class="stripboard-title-row">
          <h2 id="stripboard-title">Stripboard &amp; Schedule</h2>
          <span id="stripboard-stamp" class="form-note stripboard-stamp"></span>
        </div>
        <div class="stripboard-tools">
          <label class="form-row form-row-inline">
            <span class="form-label">Scope</span>
            <select id="stripboard-scope">
              <option value="document">This script</option>
              <option value="project">Whole project</option>
            </select>
          </label>
          <label class="stripboard-check">
            <input type="checkbox" id="stripboard-omitted" checked>
            <span>Include omitted scenes</span>
          </label>
        </div>
      </div>

      <div id="stripboard-stale" class="stripboard-stale" hidden>
        <span id="stripboard-stale-text">Script or schedule updated.</span>
        <button type="button" id="stripboard-refresh" class="btn">Refresh</button>
      </div>

      <!-- Color Legend (E3, E9) -->
      <div class="stripboard-legend" role="region" aria-label="Color Legend">
        <span class="legend-item day_int"><span class="swatch">○</span> Day Interior</span>
        <span class="legend-item night_int"><span class="swatch">●</span> Night Interior</span>
        <span class="legend-item day_ext"><span class="swatch">☼</span> Day Exterior</span>
        <span class="legend-item night_ext"><span class="swatch">☽</span> Night Exterior</span>
        <span class="legend-item other"><span class="swatch">◈</span> Other / Mixed</span>
      </div>

      <!-- Controls Toolbar -->
      <div class="stripboard-toolbar">
        <div class="toolbar-left">
          <button type="button" id="stripboard-add-day" class="btn">+ Day Break</button>
          <button type="button" id="stripboard-add-banner" class="btn">+ Banner</button>
          <label class="sort-label">
            <span>Sort by</span>
            <select id="stripboard-sort-by">
              <option value="scene_number">Scene #</option>
              <option value="int_ext">INT / EXT</option>
              <option value="location">Location</option>
              <option value="time_of_day">Time of Day</option>
              <option value="eighths">Length</option>
              <option value="characters">Cast</option>
            </select>
          </label>
          <button type="button" id="stripboard-sort-btn" class="btn">Sort</button>
        </div>
        <div class="toolbar-right">
          <button type="button" id="stripboard-undo" class="btn" title="Undo schedule edit">Undo</button>
          <button type="button" id="stripboard-redo" class="btn" title="Redo schedule edit">Redo</button>
        </div>
      </div>

      <!-- Main Board Content -->
      <div id="stripboard-body" class="stripboard-body">
        <div class="stripboard-section-head">
          <h3>Scheduled Strips</h3>
          <span id="stripboard-scheduled-summary" class="form-note"></span>
        </div>
        <div id="stripboard-scheduled-list" class="strip-list"></div>

        <div id="stripboard-unscheduled-section" class="stripboard-unscheduled-section">
          <div class="stripboard-section-head">
            <h3>Unscheduled Pile</h3>
            <span id="stripboard-unscheduled-summary" class="form-note"></span>
          </div>
          <div id="stripboard-unscheduled-list" class="strip-list"></div>
        </div>
      </div>

      <!-- Footer & Export Bar (E9) -->
      <div class="dialog-actions stripboard-actions">
        <div class="stripboard-export-bar">
          <span class="form-label">Export:</span>
          <select id="stripboard-export-format">
            <option value="html">HTML (printable)</option>
            <option value="pdf">PDF (formatted)</option>
            <option value="xlsx">XLSX (Google Sheets / Excel)</option>
            <option value="csv">CSV (quoted UTF-8)</option>
            <option value="tsv">TSV (formula-safe)</option>
          </select>
          <button type="button" id="stripboard-export-btn" class="btn">Export…</button>
          <span id="stripboard-export-status" class="form-note stripboard-export-status"></span>
        </div>
        <button type="button" id="stripboard-close" class="btn">Close</button>
      </div>
    `;

    document.body.appendChild(dialog);

    // Wire listeners
    dialog.querySelector("#stripboard-close")!.addEventListener("click", () => dialog!.close());

    dialog.querySelector("#stripboard-scope")!.addEventListener("change", (e) => {
      const mode = (e.target as HTMLSelectElement).value as "document" | "project";
      currentScope.mode = mode;
      currentScope.documents = mode === "document" ? [host.documentId()] : [];
      refresh();
    });

    dialog.querySelector("#stripboard-omitted")!.addEventListener("change", (e) => {
      currentScope.include_omitted = (e.target as HTMLInputElement).checked;
      refresh();
    });

    dialog.querySelector("#stripboard-refresh")!.addEventListener("click", () => refresh());

    dialog.querySelector("#stripboard-add-day")!.addEventListener("click", () => addDayBreak());
    dialog.querySelector("#stripboard-add-banner")!.addEventListener("click", () => addBanner());
    dialog.querySelector("#stripboard-sort-btn")!.addEventListener("click", () => sortSchedule());

    dialog.querySelector("#stripboard-undo")!.addEventListener("click", async () => {
      try {
        if (await host.undoPlanning()) {
          await refresh();
        }
      } catch (err) {
        console.error("Undo failed:", err);
      }
    });

    dialog.querySelector("#stripboard-redo")!.addEventListener("click", async () => {
      try {
        if (await host.redoPlanning()) {
          await refresh();
        }
      } catch (err) {
        console.error("Redo failed:", err);
      }
    });

    dialog.querySelector("#stripboard-export-btn")!.addEventListener("click", () => handleExport());

    return dialog;
  }

  async function refresh() {
    ensureDialog();
    try {
      currentScope.documents = currentScope.mode === "document" ? [host.documentId()] : [];
      const state = await invoke<ScheduleState>("stripboard_state", { scope: currentScope });
      currentState = state;
      renderedScriptVersion = host.version();
      renderedPlanningVersion = host.planningVersion();

      render();
    } catch (err) {
      console.error("Failed to load stripboard state:", err);
    }
  }

  function render() {
    if (!dialog || !currentState) return;

    // Stamp
    const stampEl = dialog.querySelector("#stripboard-stamp")!;
    stampEl.textContent = `Script v${currentState.source_version} · Planning v${currentState.planning_version}`;

    // Staleness check (B6)
    const staleEl = dialog.querySelector("#stripboard-stale") as HTMLElement;
    const isStale = host.version() !== renderedScriptVersion || host.planningVersion() !== renderedPlanningVersion;
    staleEl.hidden = !isStale;
    if (isStale) {
      const txt = dialog.querySelector("#stripboard-stale-text")!;
      txt.textContent = `Script changed (v${currentState.source_version} → v${host.version()}).`;
    }

    // Summaries
    const schedSummary = dialog.querySelector("#stripboard-scheduled-summary")!;
    const wholePgs = Math.floor(currentState.total_scheduled_eighths / 8);
    const remEighths = currentState.total_scheduled_eighths % 8;
    const pgsStr = wholePgs > 0 && remEighths > 0 ? `${wholePgs} ${remEighths}/8` : remEighths > 0 ? `${remEighths}/8` : `${wholePgs}`;
    schedSummary.textContent = `${currentState.total_scheduled_scenes} scenes · ${pgsStr} pgs (estimate) · ${currentState.total_shooting_days} day${currentState.total_shooting_days === 1 ? "" : "s"}`;

    const unschedSummary = dialog.querySelector("#stripboard-unscheduled-summary")!;
    unschedSummary.textContent = `${currentState.unscheduled.length} scene${currentState.unscheduled.length === 1 ? "" : "s"}`;

    // Render Scheduled List
    const schedList = dialog.querySelector("#stripboard-scheduled-list")!;
    schedList.innerHTML = "";

    currentState.scheduled.forEach((strip, index) => {
      schedList.appendChild(createStripElement(strip, index, true));
    });

    // Render Unscheduled List
    const unschedList = dialog.querySelector("#stripboard-unscheduled-list")!;
    unschedList.innerHTML = "";

    currentState.unscheduled.forEach((strip, index) => {
      unschedList.appendChild(createStripElement(strip, index, false));
    });
  }

  function createStripElement(strip: Strip, index: number, isScheduled: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = `strip-card strip-kind-${strip.kind}`;
    el.dataset.id = strip.id;
    el.dataset.index = String(index);

    if (strip.kind === "day_break") {
      el.classList.add("strip-day-break");
      const title = strip.day_title || `Day ${strip.day_number || 1}`;
      const scenes = strip.total_scenes ?? 0;
      const eighths = strip.total_eighths ?? 0;
      const whole = Math.floor(eighths / 8);
      const rem = eighths % 8;
      const pgs = whole > 0 && rem > 0 ? `${whole} ${rem}/8` : rem > 0 ? `${rem}/8` : `${whole}`;

      el.innerHTML = `
        <div class="day-break-head">
          <div class="day-break-title">
            <input type="text" class="day-title-input" value="${escapeHtml(title)}" placeholder="Day Title">
          </div>
          <div class="day-break-meta">
            <span>${scenes} scene${scenes === 1 ? "" : "s"} · ${pgs} pgs</span>
            <div class="strip-actions">
              <button type="button" class="btn-icon btn-move-up" title="Move Up" ${index === 0 ? "disabled" : ""}>↑</button>
              <button type="button" class="btn-icon btn-move-down" title="Move Down">↓</button>
              <button type="button" class="btn-icon btn-delete" title="Delete Day Break">✕</button>
            </div>
          </div>
        </div>
        <div class="day-break-note-row">
          <input type="text" class="strip-note-input" value="${escapeHtml(strip.note)}" placeholder="Day call time / staging notes…">
        </div>
      `;

      el.querySelector(".day-title-input")!.addEventListener("change", (e) => {
        strip.day_title = (e.target as HTMLInputElement).value;
        saveSchedule();
      });

      el.querySelector(".strip-note-input")!.addEventListener("change", (e) => {
        strip.note = (e.target as HTMLInputElement).value;
        saveSchedule();
      });

      wireStripMoveAndDelete(el, index, isScheduled);
      return el;
    }

    if (strip.kind === "banner") {
      el.classList.add("strip-banner");
      el.innerHTML = `
        <div class="banner-head">
          <input type="text" class="banner-text-input" value="${escapeHtml(strip.banner_text || "COMPANY MOVE")}" placeholder="Banner Text">
          <div class="strip-actions">
            <button type="button" class="btn-icon btn-move-up" title="Move Up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="btn-icon btn-move-down" title="Move Down">↓</button>
            <button type="button" class="btn-icon btn-delete" title="Delete Banner">✕</button>
          </div>
        </div>
        <div class="banner-note-row">
          <input type="text" class="strip-note-input" value="${escapeHtml(strip.note)}" placeholder="Banner note / details…">
        </div>
      `;

      el.querySelector(".banner-text-input")!.addEventListener("change", (e) => {
        strip.banner_text = (e.target as HTMLInputElement).value;
        saveSchedule();
      });

      el.querySelector(".strip-note-input")!.addEventListener("change", (e) => {
        strip.note = (e.target as HTMLInputElement).value;
        saveSchedule();
      });

      wireStripMoveAndDelete(el, index, isScheduled);
      return el;
    }

    // Scene Strip
    el.classList.add(`strip-${strip.color_code}`);
    if (strip.omitted) el.classList.add("omitted");
    if (strip.deleted) el.classList.add("deleted");

    const whole = Math.floor(strip.eighths / 8);
    const rem = strip.eighths % 8;
    const pgs = whole > 0 && rem > 0 ? `${whole} ${rem}/8` : rem > 0 ? `${rem}/8` : `${whole}`;

    const omittedBadge = strip.deleted
      ? `<span class="badge badge-deleted">[DELETED]</span>`
      : strip.omitted
      ? `<span class="badge badge-omitted">[OMITTED]</span>`
      : "";

    const castHtml = strip.characters.length > 0 ? `<div class="strip-cast"><strong>Cast:</strong> ${escapeHtml(strip.characters.join(", "))}</div>` : "";
    const tagsHtml = strip.tags.length > 0 ? `<div class="strip-tags"><strong>Tags:</strong> ${escapeHtml(strip.tags.join("; "))}</div>` : "";

    el.innerHTML = `
      <div class="scene-strip-main">
        <div class="strip-bar">
          <span class="strip-symbol">${strip.color_symbol}</span>
        </div>
        <div class="strip-content">
          <div class="strip-header-row">
            <div class="strip-heading-wrap">
              <span class="badge badge-scene">SCENE ${escapeHtml(strip.scene_number)}</span>
              ${omittedBadge}
              <span class="strip-heading-text">${escapeHtml(strip.heading)}</span>
            </div>
            <div class="strip-meta-wrap">
              <span class="strip-color-label">${strip.color_symbol} ${strip.color_label}</span>
              <span class="strip-length">${pgs} pgs</span>
              <span class="strip-page">Pg ${strip.page}</span>
              <div class="strip-actions">
                ${
                  isScheduled
                    ? `<button type="button" class="btn-icon btn-move-up" title="Move Up" ${index === 0 ? "disabled" : ""}>↑</button>
                       <button type="button" class="btn-icon btn-move-down" title="Move Down">↓</button>
                       <button type="button" class="btn-icon btn-to-unscheduled" title="Move to Unscheduled">⤵</button>`
                    : `<button type="button" class="btn btn-to-scheduled">Add to Schedule</button>`
                }
              </div>
            </div>
          </div>

          <!-- Description: full text, never clipped (E9) -->
          <div class="strip-desc">${escapeHtml(strip.description || strip.heading)}</div>

          ${castHtml}
          ${tagsHtml}

          <div class="strip-note-row">
            <input type="text" class="strip-note-input" value="${escapeHtml(strip.note)}" placeholder="Scheduling notes (rigs, cast wrap, etc.)…">
          </div>
        </div>
      </div>
    `;

    el.querySelector(".strip-note-input")!.addEventListener("change", (e) => {
      strip.note = (e.target as HTMLInputElement).value;
      saveSchedule();
    });

    if (strip.scene_id && host.onGoToScene) {
      el.querySelector(".strip-heading-text")!.addEventListener("click", () => {
        if (strip.scene_id && host.onGoToScene) {
          host.onGoToScene(strip.scene_id);
          dialog?.close();
        }
      });
    }

    wireStripMoveAndDelete(el, index, isScheduled);
    return el;
  }

  function wireStripMoveAndDelete(el: HTMLElement, index: number, isScheduled: boolean) {
    const upBtn = el.querySelector(".btn-move-up");
    if (upBtn) {
      upBtn.addEventListener("click", () => {
        if (!currentState || index <= 0) return;
        const list = isScheduled ? currentState.scheduled : currentState.unscheduled;
        const item = list.splice(index, 1)[0];
        list.splice(index - 1, 0, item);
        saveSchedule();
      });
    }

    const downBtn = el.querySelector(".btn-move-down");
    if (downBtn) {
      downBtn.addEventListener("click", () => {
        if (!currentState) return;
        const list = isScheduled ? currentState.scheduled : currentState.unscheduled;
        if (index >= list.length - 1) return;
        const item = list.splice(index, 1)[0];
        list.splice(index + 1, 0, item);
        saveSchedule();
      });
    }

    const delBtn = el.querySelector(".btn-delete");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        if (!currentState) return;
        const list = isScheduled ? currentState.scheduled : currentState.unscheduled;
        list.splice(index, 1);
        saveSchedule();
      });
    }

    const toUnschedBtn = el.querySelector(".btn-to-unscheduled");
    if (toUnschedBtn) {
      toUnschedBtn.addEventListener("click", () => {
        if (!currentState) return;
        const item = currentState.scheduled.splice(index, 1)[0];
        currentState.unscheduled.push(item);
        saveSchedule();
      });
    }

    const toSchedBtn = el.querySelector(".btn-to-scheduled");
    if (toSchedBtn) {
      toSchedBtn.addEventListener("click", () => {
        if (!currentState) return;
        const item = currentState.unscheduled.splice(index, 1)[0];
        currentState.scheduled.push(item);
        saveSchedule();
      });
    }
  }

  function addDayBreak() {
    if (!currentState) return;
    const newDayNum = (currentState.total_shooting_days || 0) + 1;
    const breakStrip: Strip = {
      id: `day_break_${Date.now()}`,
      kind: "day_break",
      document_id: "",
      document_title: "",
      scene_number: "",
      heading: "",
      int_ext: "",
      location: "",
      time_of_day: "",
      description: "",
      page: "",
      eighths: 0,
      characters: [],
      tags: [],
      note: "",
      omitted: false,
      deleted: false,
      color_code: "",
      color_label: "",
      color_symbol: "",
      day_number: newDayNum,
      day_title: `Day ${newDayNum}`,
    };
    currentState.scheduled.push(breakStrip);
    saveSchedule();
  }

  function addBanner() {
    if (!currentState) return;
    const bannerStrip: Strip = {
      id: `banner_${Date.now()}`,
      kind: "banner",
      document_id: "",
      document_title: "",
      scene_number: "",
      heading: "",
      int_ext: "",
      location: "",
      time_of_day: "",
      description: "",
      page: "",
      eighths: 0,
      characters: [],
      tags: [],
      note: "",
      omitted: false,
      deleted: false,
      color_code: "",
      color_label: "",
      color_symbol: "",
      banner_text: "COMPANY MOVE",
    };
    currentState.scheduled.push(bannerStrip);
    saveSchedule();
  }

  function sortSchedule() {
    if (!currentState || !dialog) return;
    const sortBy = (dialog.querySelector("#stripboard-sort-by") as HTMLSelectElement).value;

    // Sort scene strips while keeping day breaks intact or sorting scenes within days
    const dayBreaksAndBanners: Array<{ index: number; strip: Strip }> = [];
    const scenes: Strip[] = [];

    currentState.scheduled.forEach((s, idx) => {
      if (s.kind === "scene") {
        scenes.push(s);
      } else {
        dayBreaksAndBanners.push({ index: idx, strip: s });
      }
    });

    scenes.sort((a, b) => {
      switch (sortBy) {
        case "scene_number": {
          const na = parseInt(a.scene_number.replace(/\D/g, ""), 10) || 0;
          const nb = parseInt(b.scene_number.replace(/\D/g, ""), 10) || 0;
          return na !== nb ? na - nb : a.scene_number.localeCompare(b.scene_number);
        }
        case "int_ext":
          return a.int_ext.localeCompare(b.int_ext) || a.location.localeCompare(b.location);
        case "location":
          return a.location.localeCompare(b.location) || a.scene_number.localeCompare(b.scene_number);
        case "time_of_day":
          return a.time_of_day.localeCompare(b.time_of_day) || a.location.localeCompare(b.location);
        case "eighths":
          return b.eighths - a.eighths;
        case "characters":
          return a.characters.join(", ").localeCompare(b.characters.join(", "));
        default:
          return 0;
      }
    });

    // Reconstruct list: place scenes after initial Day 1 break if present
    const newScheduled: Strip[] = [];
    let sceneIdx = 0;

    if (dayBreaksAndBanners.length > 0 && dayBreaksAndBanners[0].index === 0) {
      newScheduled.push(dayBreaksAndBanners[0].strip);
      dayBreaksAndBanners.shift();
    }

    while (sceneIdx < scenes.length) {
      newScheduled.push(scenes[sceneIdx++]);
    }

    // Append remaining banners or day breaks
    for (const item of dayBreaksAndBanners) {
      newScheduled.push(item.strip);
    }

    currentState.scheduled = newScheduled;
    saveSchedule();
  }

  async function saveSchedule() {
    if (!currentState) return;
    try {
      const scopeKey = currentState.scope;
      const ok = await host.applyPlanning({ SetSchedule: { scope: scopeKey, state: currentState } });
      if (ok) {
        await refresh();
      }
    } catch (err) {
      console.error("Failed to save stripboard:", err);
    }
  }

  async function handleExport() {
    if (!dialog || !currentState) return;
    const formatSel = dialog.querySelector("#stripboard-export-format") as HTMLSelectElement;
    const format = formatSel.value;
    const statusEl = dialog.querySelector("#stripboard-export-status") as HTMLElement;

    try {
      statusEl.textContent = "Selecting destination…";
      const filterExt = format === "html" ? ["html", "htm"] : format === "pdf" ? ["pdf"] : format === "xlsx" ? ["xlsx"] : format === "csv" ? ["csv"] : ["tsv"];
      const dest = await save({
        title: "Export Stripboard & Schedule",
        defaultPath: `stripboard-${currentState.scope_label.toLowerCase().replace(/\s+/g, "-")}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: filterExt }],
      });

      if (!dest) {
        statusEl.textContent = "";
        return;
      }

      statusEl.textContent = "Exporting…";
      const exported = await invoke<ReportExported>("export_stripboard", {
        scope: currentScope,
        format,
        path: dest,
      });

      statusEl.textContent = `Saved ${exported.format.toUpperCase()} (${exported.bytes} bytes).`;
    } catch (err) {
      console.error("Export failed:", err);
      statusEl.textContent = `Export failed: ${err}`;
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return {
    open: async () => {
      const d = ensureDialog();
      await refresh();
      if (!d.open) d.showModal();
    },
    close: () => {
      dialog?.close();
    },
    refresh,
  };
}
