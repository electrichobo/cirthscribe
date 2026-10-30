// Comic Book Scripting: Analysis, lettering metrics, panel renumbering & exports (M6 Step 2, ROADMAP M6).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface ComicLetteringItem {
  kind: "balloon" | "caption" | "sfx";
  speaker: string | null;
  parenthetical: string | null;
  text: string;
  block_id: string;
}

export interface ComicPanel {
  panel_num: number;
  header_text: string;
  header_block_id: string;
  descriptions: string[];
  lettering: ComicLetteringItem[];
}

export interface ComicPage {
  page_num: number;
  header_text: string;
  header_block_id: string;
  declared_panels: number | null;
  panels: ComicPanel[];
}

export interface ComicScriptAnalysis {
  pages: ComicPage[];
  total_pages: number;
  total_panels: number;
  avg_panels_per_page: number;
  total_balloons: number;
  total_captions: number;
  total_sfx: number;
  warnings: string[];
}

export function createComicDialog(hooks: {
  onRenumber?: () => Promise<void> | void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "comic-dialog";
  dialog.className = "about comic-dialog hidden";
  dialog.setAttribute("aria-labelledby", "comic-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "comic-dialog-title";
  h.textContent = "Comic Script Analysis & Lettering";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Structure graphic novel pages and panels, verify speech balloons, captions, and sound effects, and validate panel continuity.";

  head.append(h, note);

  const body = document.createElement("div");
  body.className = "comic-dialog-body";

  const metricsRow = document.createElement("div");
  metricsRow.className = "comic-metrics-grid";

  const warningsBox = document.createElement("div");
  warningsBox.className = "comic-warnings-box hidden";

  const breakdownBox = document.createElement("div");
  breakdownBox.className = "comic-breakdown-box";

  body.append(metricsRow, warningsBox, breakdownBox);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const renumberBtn = document.createElement("button");
  renumberBtn.className = "btn";
  renumberBtn.textContent = "Renumber Panels";
  renumberBtn.title = "Automatically renumber panel headings sequentially and reconcile page panel counts.";

  const exportTxtBtn = document.createElement("button");
  exportTxtBtn.className = "btn";
  exportTxtBtn.textContent = "Export Text";

  const exportHtmlBtn = document.createElement("button");
  exportHtmlBtn.className = "btn";
  exportHtmlBtn.textContent = "Export HTML";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn primary";
  closeBtn.textContent = "Close";

  foot.append(renumberBtn, exportTxtBtn, exportHtmlBtn, closeBtn);

  dialog.append(head, body, foot);
  document.body.append(dialog);

  let currentAnalysis: ComicScriptAnalysis | null = null;

  function renderMetrics(a: ComicScriptAnalysis) {
    metricsRow.innerHTML = "";
    const items = [
      { label: "Pages", val: a.total_pages },
      { label: "Panels", val: a.total_panels },
      { label: "Avg Panels/Page", val: a.avg_panels_per_page.toFixed(1) },
      { label: "Speech Balloons", val: a.total_balloons },
      { label: "Captions", val: a.total_captions },
      { label: "Sound Effects", val: a.total_sfx },
    ];
    for (const it of items) {
      const card = document.createElement("div");
      card.className = "comic-metric-card";
      const val = document.createElement("div");
      val.className = "comic-metric-val";
      val.textContent = String(it.val);
      const lbl = document.createElement("div");
      lbl.className = "comic-metric-label";
      lbl.textContent = it.label;
      card.append(val, lbl);
      metricsRow.append(card);
    }

    if (a.warnings.length > 0) {
      warningsBox.classList.remove("hidden");
      warningsBox.innerHTML = `<strong>Continuity Warnings (${a.warnings.length}):</strong>`;
      const ul = document.createElement("ul");
      ul.className = "comic-warning-list";
      for (const w of a.warnings) {
        const li = document.createElement("li");
        li.textContent = w;
        ul.append(li);
      }
      warningsBox.append(ul);
    } else {
      warningsBox.classList.add("hidden");
      warningsBox.innerHTML = "";
    }

    breakdownBox.innerHTML = "<h3>Page & Panel Breakdown</h3>";
    if (a.pages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "comic-empty-msg";
      empty.textContent = "No pages or panels found in current document.";
      breakdownBox.append(empty);
    } else {
      const list = document.createElement("div");
      list.className = "comic-page-list";
      for (const p of a.pages) {
        const pItem = document.createElement("div");
        pItem.className = "comic-page-item";
        const pTitle = document.createElement("strong");
        pTitle.textContent = `${p.header_text} (${p.panels.length} panels)`;
        pItem.append(pTitle);

        if (p.panels.length > 0) {
          const pUl = document.createElement("ul");
          for (const pan of p.panels) {
            const pLi = document.createElement("li");
            const balloons = pan.lettering.filter((l) => l.kind === "balloon").length;
            const captions = pan.lettering.filter((l) => l.kind === "caption").length;
            const sfx = pan.lettering.filter((l) => l.kind === "sfx").length;
            pLi.textContent = `${pan.header_text}: ${balloons} balloon(s), ${captions} caption(s), ${sfx} SFX`;
            pUl.append(pLi);
          }
          pItem.append(pUl);
        }
        list.append(pItem);
      }
      breakdownBox.append(list);
    }
  }

  async function refresh() {
    try {
      currentAnalysis = await invoke<ComicScriptAnalysis>("comic_analyze");
      renderMetrics(currentAnalysis);
    } catch (e) {
      console.error("comic_analyze failed:", e);
    }
  }

  renumberBtn.onclick = async () => {
    try {
      renumberBtn.disabled = true;
      currentAnalysis = await invoke<ComicScriptAnalysis>("comic_renumber");
      renderMetrics(currentAnalysis);
      announce("Comic panels renumbered successfully.");
      if (hooks.onRenumber) {
        await hooks.onRenumber();
      }
    } catch (e) {
      alert(`Renumbering failed: ${e}`);
    } finally {
      renumberBtn.disabled = false;
    }
  };

  exportTxtBtn.onclick = async () => {
    try {
      const txt = await invoke<string>("comic_export_text");
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "comic-script.txt";
      a.click();
      URL.revokeObjectURL(url);
      announce("Comic text script exported.");
    } catch (e) {
      alert(`Export failed: ${e}`);
    }
  };

  exportHtmlBtn.onclick = async () => {
    try {
      const html = await invoke<string>("comic_export_html");
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "comic-script.html";
      a.click();
      URL.revokeObjectURL(url);
      announce("Comic HTML script exported.");
    } catch (e) {
      alert(`Export failed: ${e}`);
    }
  };

  closeBtn.onclick = () => {
    dialog.close();
    dialog.classList.add("hidden");
  };

  return {
    async open() {
      await refresh();
      dialog.classList.remove("hidden");
      dialog.showModal();
      announce("Comic Script Analysis dialog opened.");
    },
    close() {
      dialog.close();
      dialog.classList.add("hidden");
    },
    refresh,
    get analysis() {
      return currentAnalysis;
    },
  };
}
