// Interactive Storytelling: Passage graph analysis, integrity validation, live playtester & exports (M6 Step 4, ROADMAP M6).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface InteractiveChoice {
  id: string;
  label: string;
  target: string;
  condition: string | null;
  source_block_id: string;
}

export interface InteractivePassage {
  id: string;
  title: string;
  tags: string[];
  content: string;
  choices: InteractiveChoice[];
  is_start: boolean;
  is_ending: boolean;
  word_count: number;
  block_ids: string[];
}

export interface GraphIssue {
  kind: "dangling_target" | "dead_end" | "unreachable";
  passage_id: string;
  passage_title: string;
  message: string;
  choice_label: string | null;
  target: string | null;
}

export interface GraphValidation {
  is_valid: boolean;
  issues: GraphIssue[];
  dangling_count: number;
  dead_end_count: number;
  unreachable_count: number;
}

export interface InteractiveGraph {
  story_title: string;
  ifid: string;
  start_passage_id: string;
  passages: InteractivePassage[];
  total_passages: number;
  total_choices: number;
  total_endings: number;
  total_words: number;
  validation: GraphValidation;
}

export function createInteractiveDialog(_hooks?: {
  onSelectPassage?: (blockId: string) => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "interactive-dialog";
  dialog.className = "about interactive-dialog hidden";
  dialog.setAttribute("aria-labelledby", "interactive-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "interactive-dialog-title";
  h.textContent = "Interactive Story Inspector & Playtester";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Analyze passages and choices, validate narrative graph reachability, test-play branching paths offline, and export to Twee 3, Playable HTML, or JSON.";

  head.append(h, note);

  const body = document.createElement("div");
  body.className = "interactive-dialog-body";

  const metricsRow = document.createElement("div");
  metricsRow.className = "comic-metrics-grid";

  const warningsBox = document.createElement("div");
  warningsBox.className = "comic-warnings-box hidden";

  const playtestSection = document.createElement("div");
  playtestSection.className = "interactive-playtest-box";

  body.append(metricsRow, warningsBox, playtestSection);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const exportTweeBtn = document.createElement("button");
  exportTweeBtn.className = "btn";
  exportTweeBtn.textContent = "Export Twee 3 (.twee)";
  exportTweeBtn.title = "Export story in standard Twine / Twee 3 format.";

  const exportHtmlBtn = document.createElement("button");
  exportHtmlBtn.className = "btn";
  exportHtmlBtn.textContent = "Export Playable HTML";
  exportHtmlBtn.title = "Export standalone single-file offline playable HTML runner.";

  const exportJsonBtn = document.createElement("button");
  exportJsonBtn.className = "btn";
  exportJsonBtn.textContent = "Export JSON Graph";
  exportJsonBtn.title = "Export structured JSON story graph for game engines.";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn primary";
  closeBtn.textContent = "Close";

  foot.append(exportTweeBtn, exportHtmlBtn, exportJsonBtn, closeBtn);

  dialog.append(head, body, foot);
  document.body.append(dialog);

  let currentGraph: InteractiveGraph | null = null;
  let playtestHistory: string[] = [];
  let currentPlaytestPassageId: string | null = null;

  function renderMetrics(graph: InteractiveGraph) {
    metricsRow.innerHTML = "";
    const items = [
      { label: "Passages", val: String(graph.total_passages) },
      { label: "Choices", val: String(graph.total_choices) },
      { label: "Endings", val: String(graph.total_endings) },
      { label: "Total Words", val: String(graph.total_words) },
      {
        label: "Graph Status",
        val: graph.validation.is_valid ? "Healthy" : "Issues Found",
        color: graph.validation.is_valid ? "#10b981" : "#f59e0b",
      },
    ];

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "comic-metric-card";
      const v = document.createElement("div");
      v.className = "metric-val";
      v.textContent = item.val;
      if (item.color) v.style.color = item.color;
      const l = document.createElement("div");
      l.className = "metric-lbl";
      l.textContent = item.label;
      card.append(v, l);
      metricsRow.append(card);
    }
  }

  function renderWarnings(graph: InteractiveGraph) {
    warningsBox.innerHTML = "";
    if (graph.validation.is_valid) {
      warningsBox.className = "comic-warnings-box";
      warningsBox.style.borderLeft = "4px solid #10b981";
      warningsBox.style.background = "#064e3b22";
      warningsBox.style.padding = "10px 14px";
      warningsBox.style.borderRadius = "4px";
      warningsBox.style.margin = "12px 0";
      const okMsg = document.createElement("div");
      okMsg.textContent = "\u2713 Story graph is healthy: all choice targets resolve, no unreachable nodes or unexpected dead ends.";
      okMsg.style.color = "#34d399";
      okMsg.style.fontWeight = "600";
      warningsBox.append(okMsg);
    } else {
      warningsBox.className = "comic-warnings-box";
      warningsBox.style.borderLeft = "4px solid #f59e0b";
      warningsBox.style.background = "#78350f22";
      warningsBox.style.padding = "10px 14px";
      warningsBox.style.borderRadius = "4px";
      warningsBox.style.margin = "12px 0";

      const title = document.createElement("strong");
      title.textContent = `Graph Continuity Issues (${graph.validation.issues.length}):`;
      title.style.display = "block";
      title.style.marginBottom = "6px";
      title.style.color = "#fbbf24";
      warningsBox.append(title);

      const ul = document.createElement("ul");
      ul.style.margin = "0 0 0 18px";
      ul.style.padding = "0";

      for (const issue of graph.validation.issues) {
        const li = document.createElement("li");
        li.style.marginBottom = "4px";
        li.style.color = "#fef3c7";
        const kindBadge = document.createElement("span");
        kindBadge.style.fontWeight = "bold";
        kindBadge.style.textTransform = "uppercase";
        kindBadge.style.marginRight = "6px";
        kindBadge.style.fontSize = "0.85em";
        kindBadge.textContent = `[${issue.kind.replace("_", " ")}]`;

        if (issue.kind === "dangling_target") {
          kindBadge.style.color = "#f87171";
        } else if (issue.kind === "unreachable") {
          kindBadge.style.color = "#fbbf24";
        } else {
          kindBadge.style.color = "#93c5fd";
        }

        li.append(kindBadge, document.createTextNode(issue.message));
        ul.append(li);
      }
      warningsBox.append(ul);
    }
  }

  function findPassage(target: string, graph: InteractiveGraph): InteractivePassage | null {
    const tTrim = target.trim();
    const tSlug = tTrim.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    for (const p of graph.passages) {
      if (p.id === tTrim) return p;
      if (p.title.trim().toLowerCase() === tTrim.toLowerCase()) return p;
      const pSlug = p.title.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (pSlug && pSlug === tSlug) return p;
    }
    return null;
  }

  function renderPlaytest(graph: InteractiveGraph) {
    playtestSection.innerHTML = "";
    playtestSection.style.border = "1px solid #334155";
    playtestSection.style.borderRadius = "8px";
    playtestSection.style.padding = "16px";
    playtestSection.style.background = "#0f172a";
    playtestSection.style.margin = "14px 0";

    const playtestHead = document.createElement("div");
    playtestHead.style.display = "flex";
    playtestHead.style.justifyContent = "space-between";
    playtestHead.style.alignItems = "center";
    playtestHead.style.marginBottom = "12px";
    playtestHead.style.borderBottom = "1px solid #1e293b";
    playtestHead.style.paddingBottom = "8px";

    const pTitle = document.createElement("strong");
    pTitle.textContent = "Live Story Playtester (Offline Preview)";
    pTitle.style.color = "#38bdf8";

    const navBtns = document.createElement("div");
    navBtns.style.display = "flex";
    navBtns.style.gap = "8px";

    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.style.padding = "4px 8px";
    backBtn.style.fontSize = "0.85em";
    backBtn.textContent = "Back";
    backBtn.disabled = playtestHistory.length === 0;
    backBtn.onclick = () => {
      if (playtestHistory.length > 0) {
        currentPlaytestPassageId = playtestHistory.pop()!;
        renderPlaytest(graph);
      }
    };

    const restartBtn = document.createElement("button");
    restartBtn.className = "btn";
    restartBtn.style.padding = "4px 8px";
    restartBtn.style.fontSize = "0.85em";
    restartBtn.textContent = "Restart";
    restartBtn.onclick = () => {
      playtestHistory = [];
      currentPlaytestPassageId = graph.start_passage_id;
      renderPlaytest(graph);
    };

    navBtns.append(backBtn, restartBtn);
    playtestHead.append(pTitle, navBtns);
    playtestSection.append(playtestHead);

    const targetId = currentPlaytestPassageId || graph.start_passage_id;
    const currentPassage = findPassage(targetId, graph);

    if (!currentPassage) {
      const err = document.createElement("div");
      err.textContent = "Passage not found.";
      playtestSection.append(err);
      return;
    }

    const passageTitle = document.createElement("h3");
    passageTitle.textContent = currentPassage.title;
    passageTitle.style.color = "#60a5fa";
    passageTitle.style.margin = "8px 0";
    playtestSection.append(passageTitle);

    if (currentPassage.tags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.style.display = "flex";
      tagsRow.style.gap = "6px";
      tagsRow.style.marginBottom = "10px";
      for (const t of currentPassage.tags) {
        const tagSpan = document.createElement("span");
        tagSpan.textContent = t;
        tagSpan.style.background = "#1e3a8a";
        tagSpan.style.color = "#bfdbfe";
        tagSpan.style.borderRadius = "3px";
        tagSpan.style.padding = "2px 6px";
        tagSpan.style.fontSize = "0.75em";
        tagsRow.append(tagSpan);
      }
      playtestSection.append(tagsRow);
    }

    const cleanContent = currentPassage.content
      .replace(/\[\[.*?\]\](?:\s*\(.*?\))?(?:\s*\{.*?\})?/g, "")
      .trim();

    const bodyText = document.createElement("div");
    bodyText.textContent = cleanContent;
    bodyText.style.whiteSpace = "pre-line";
    bodyText.style.color = "#e2e8f0";
    bodyText.style.lineHeight = "1.6";
    bodyText.style.marginBottom = "16px";
    playtestSection.append(bodyText);

    if (currentPassage.choices.length > 0) {
      const choicesLabel = document.createElement("div");
      choicesLabel.textContent = "Choices:";
      choicesLabel.style.fontWeight = "bold";
      choicesLabel.style.marginBottom = "8px";
      choicesLabel.style.color = "#94a3b8";
      playtestSection.append(choicesLabel);

      const choiceList = document.createElement("div");
      choiceList.style.display = "flex";
      choiceList.style.flexDirection = "column";
      choiceList.style.gap = "8px";

      for (const c of currentPassage.choices) {
        const cBtn = document.createElement("button");
        cBtn.className = "btn";
        cBtn.style.textAlign = "left";
        cBtn.style.padding = "8px 12px";
        cBtn.style.background = "#1e293b";
        cBtn.style.border = "1px solid #38bdf844";
        cBtn.style.color = "#38bdf8";
        cBtn.style.display = "flex";
        cBtn.style.justifyContent = "space-between";
        cBtn.style.alignItems = "center";

        const labelSpan = document.createElement("span");
        labelSpan.textContent = c.label;

        const condSpan = document.createElement("span");
        if (c.condition) {
          condSpan.textContent = `[if ${c.condition}]`;
          condSpan.style.fontSize = "0.8em";
          condSpan.style.color = "#94a3b8";
          condSpan.style.marginLeft = "8px";
        }

        cBtn.append(labelSpan, condSpan);

        cBtn.onclick = () => {
          const next = findPassage(c.target, graph);
          if (next) {
            playtestHistory.push(currentPassage.id);
            currentPlaytestPassageId = next.id;
            renderPlaytest(graph);
          } else {
            alert(`Target passage not found: ${c.target}`);
          }
        };

        choiceList.append(cBtn);
      }
      playtestSection.append(choiceList);
    }

    if (currentPassage.is_ending) {
      const endingBox = document.createElement("div");
      endingBox.style.marginTop = "16px";
      endingBox.style.padding = "12px";
      endingBox.style.background = "#064e3b33";
      endingBox.style.border = "1px solid #059669";
      endingBox.style.borderRadius = "6px";
      endingBox.style.textAlign = "center";

      const endTitle = document.createElement("strong");
      endTitle.textContent = "THE END";
      endTitle.style.display = "block";
      endTitle.style.color = "#34d399";
      endTitle.style.fontSize = "1.1em";

      const endDesc = document.createElement("div");
      endDesc.textContent = "You have reached an ending for this story path.";
      endDesc.style.color = "#a7f3d0";
      endDesc.style.fontSize = "0.9em";
      endDesc.style.marginTop = "4px";

      endingBox.append(endTitle, endDesc);
      playtestSection.append(endingBox);
    }
  }

  async function downloadStringFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportTweeBtn.onclick = async () => {
    try {
      const twee = await invoke<string>("interactive_export_twee", {});
      const filename = `${currentGraph?.story_title || "story"}.twee`;
      await downloadStringFile(twee, filename, "text/plain;charset=utf-8");
      announce("Exported Twee 3 story");
    } catch (e) {
      alert(`Export error: ${String(e)}`);
    }
  };

  exportHtmlBtn.onclick = async () => {
    try {
      const html = await invoke<string>("interactive_export_html", {});
      const filename = `${currentGraph?.story_title || "story"}.html`;
      await downloadStringFile(html, filename, "text/html;charset=utf-8");
      announce("Exported playable offline HTML");
    } catch (e) {
      alert(`Export error: ${String(e)}`);
    }
  };

  exportJsonBtn.onclick = async () => {
    try {
      const json = await invoke<string>("interactive_export_json", {});
      const filename = `${currentGraph?.story_title || "story"}-graph.json`;
      await downloadStringFile(json, filename, "application/json;charset=utf-8");
      announce("Exported JSON story graph");
    } catch (e) {
      alert(`Export error: ${String(e)}`);
    }
  };

  closeBtn.onclick = () => {
    dialog.close();
    dialog.classList.add("hidden");
  };

  return {
    async open(documentId?: string) {
      try {
        const graph = await invoke<InteractiveGraph>("interactive_analyze", { documentId });
        currentGraph = graph;
        playtestHistory = [];
        currentPlaytestPassageId = graph.start_passage_id;

        renderMetrics(graph);
        renderWarnings(graph);
        renderPlaytest(graph);

        dialog.classList.remove("hidden");
        dialog.showModal();
        announce("Interactive story inspector opened");
      } catch (e) {
        alert(`Failed to analyze interactive story: ${String(e)}`);
      }
    },
    close() {
      dialog.close();
      dialog.classList.add("hidden");
    },
  };
}
