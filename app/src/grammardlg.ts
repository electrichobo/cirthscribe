// Offline Grammar, Style & Dialogue Analysis Engine (M6 Step 6, ROADMAP M6).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface GrammarIssue {
  id: string;
  rule_id: string;
  category:
    | "duplicate_words"
    | "passive_voice"
    | "screenplay_punctuation"
    | "cliches_and_fillers"
    | "spacing_and_punctuation";
  severity: "suggestion" | "warning";
  message: string;
  block_id: string;
  block_kind: string;
  offset: number;
  length: number;
  matched_text: string;
  replacement: string | null;
  context: string;
}

export interface GrammarAnalysisReport {
  total_issues: number;
  duplicate_words_count: number;
  passive_voice_count: number;
  screenplay_punctuation_count: number;
  cliches_count: number;
  spacing_count: number;
  issues: GrammarIssue[];
}

export function createGrammarDialog(_hooks?: {
  onSelectBlock?: (blockId: string) => void;
  onBlockUpdated?: () => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "grammar-dialog";
  dialog.className = "about grammar-dialog hidden";
  dialog.setAttribute("aria-labelledby", "grammar-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "grammar-dialog-title";
  h.textContent = "Grammar, Style & Dialogue Analysis";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "100% offline, deterministic rule-based analysis for duplicate words, passive voice, screenplay dialogue punctuation, cliches, and spacing consistency.";

  head.append(h, note);

  const body = document.createElement("div");
  body.className = "grammar-dialog-body";

  const metricsRow = document.createElement("div");
  metricsRow.className = "treatment-metrics";

  function makeCard(id: string, label: string) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const num = document.createElement("div");
    num.id = id;
    num.className = "metric-val";
    num.textContent = "0";
    const lbl = document.createElement("div");
    lbl.className = "metric-lbl";
    lbl.textContent = label;
    card.append(num, lbl);
    return card;
  }

  const cardTotal = makeCard("metric-grammar-total", "Total Issues");
  const cardDuplicates = makeCard("metric-grammar-duplicates", "Duplicate Words");
  const cardPassive = makeCard("metric-grammar-passive", "Passive Voice");
  const cardPunctuation = makeCard("metric-grammar-punctuation", "Dialogue Rules");
  const cardCliches = makeCard("metric-grammar-cliches", "Cliches & Fillers");
  const cardSpacing = makeCard("metric-grammar-spacing", "Spacing & Marks");

  metricsRow.append(
    cardTotal,
    cardDuplicates,
    cardPassive,
    cardPunctuation,
    cardCliches,
    cardSpacing
  );

  const filterRow = document.createElement("div");
  filterRow.className = "grammar-filter-row";
  filterRow.style.display = "flex";
  filterRow.style.gap = "8px";
  filterRow.style.margin = "12px 0";

  let currentCategoryFilter = "all";
  const ignoredRules = new Set<string>();
  const ignoredWords = new Set<string>();
  let lastReport: GrammarAnalysisReport | null = null;

  const categories = [
    { id: "all", label: "All" },
    { id: "duplicate_words", label: "Duplicate Words" },
    { id: "passive_voice", label: "Passive Voice" },
    { id: "screenplay_punctuation", label: "Dialogue Rules" },
    { id: "cliches_and_fillers", label: "Cliches" },
    { id: "spacing_and_punctuation", label: "Spacing" },
  ];

  const filterButtons: HTMLButtonElement[] = [];

  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-sm ${cat.id === "all" ? "btn-primary active" : ""}`;
    btn.textContent = cat.label;
    btn.onclick = () => {
      currentCategoryFilter = cat.id;
      for (const b of filterButtons) {
        b.classList.remove("active", "btn-primary");
      }
      btn.classList.add("active", "btn-primary");
      renderIssues();
    };
    filterButtons.push(btn);
    filterRow.appendChild(btn);
  }

  const issuesContainer = document.createElement("div");
  issuesContainer.className = "grammar-issues-list";
  issuesContainer.style.maxHeight = "360px";
  issuesContainer.style.overflowY = "auto";
  issuesContainer.style.border = "1px solid var(--border, #ccc)";
  issuesContainer.style.borderRadius = "4px";
  issuesContainer.style.padding = "8px";

  body.append(metricsRow, filterRow, issuesContainer);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const btnReanalyze = document.createElement("button");
  btnReanalyze.type = "button";
  btnReanalyze.className = "btn";
  btnReanalyze.textContent = "Re-Analyze";
  btnReanalyze.onclick = () => {
    refreshReport();
  };

  const btnResetIgnored = document.createElement("button");
  btnResetIgnored.type = "button";
  btnResetIgnored.className = "btn";
  btnResetIgnored.textContent = "Reset Ignored";
  btnResetIgnored.onclick = () => {
    ignoredRules.clear();
    ignoredWords.clear();
    refreshReport();
  };

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn btn-primary";
  btnClose.textContent = "Close";
  btnClose.onclick = () => {
    dialog.close();
  };

  foot.append(btnReanalyze, btnResetIgnored, btnClose);
  dialog.append(head, body, foot);
  document.body.appendChild(dialog);

  function renderMetrics(report: GrammarAnalysisReport) {
    const elTotal = cardTotal.querySelector(".metric-val");
    if (elTotal) elTotal.textContent = String(report.total_issues);
    const elDup = cardDuplicates.querySelector(".metric-val");
    if (elDup) elDup.textContent = String(report.duplicate_words_count);
    const elPass = cardPassive.querySelector(".metric-val");
    if (elPass) elPass.textContent = String(report.passive_voice_count);
    const elPunct = cardPunctuation.querySelector(".metric-val");
    if (elPunct) elPunct.textContent = String(report.screenplay_punctuation_count);
    const elCliches = cardCliches.querySelector(".metric-val");
    if (elCliches) elCliches.textContent = String(report.cliches_count);
    const elSpacing = cardSpacing.querySelector(".metric-val");
    if (elSpacing) elSpacing.textContent = String(report.spacing_count);
  }

  function renderIssues() {
    issuesContainer.innerHTML = "";
    if (!lastReport || lastReport.issues.length === 0) {
      const empty = document.createElement("p");
      empty.className = "form-note";
      empty.textContent = "No grammar or style issues detected. Clean script!";
      empty.style.textAlign = "center";
      empty.style.padding = "24px";
      issuesContainer.appendChild(empty);
      return;
    }

    const filtered = lastReport.issues.filter((issue) => {
      if (currentCategoryFilter === "all") return true;
      return issue.category === currentCategoryFilter;
    });

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "form-note";
      empty.textContent = "No issues in this category.";
      empty.style.textAlign = "center";
      empty.style.padding = "16px";
      issuesContainer.appendChild(empty);
      return;
    }

    for (const issue of filtered) {
      const item = document.createElement("div");
      item.className = "grammar-issue-item";
      item.style.padding = "8px";
      item.style.borderBottom = "1px solid var(--border-light, #eee)";
      item.style.display = "flex";
      item.style.flexDirection = "column";
      item.style.gap = "4px";

      const topRow = document.createElement("div");
      topRow.style.display = "flex";
      topRow.style.justifyContent = "space-between";
      topRow.style.alignItems = "center";

      const badge = document.createElement("span");
      badge.className = `badge badge-${issue.severity}`;
      badge.textContent = `${issue.category.replace(/_/g, " ")} (${issue.block_kind})`;
      badge.style.fontSize = "0.75rem";
      badge.style.textTransform = "capitalize";

      const ruleLabel = document.createElement("span");
      ruleLabel.style.fontSize = "0.8rem";
      ruleLabel.style.color = "var(--text-muted, #666)";
      ruleLabel.textContent = issue.rule_id;

      topRow.append(badge, ruleLabel);

      const msg = document.createElement("div");
      msg.style.fontWeight = "bold";
      msg.textContent = issue.message;

      const contextEl = document.createElement("div");
      contextEl.className = "grammar-context-snippet";
      contextEl.style.fontFamily = "monospace";
      contextEl.style.fontSize = "0.85rem";
      contextEl.style.background = "var(--bg-muted, #f8f8f8)";
      contextEl.style.padding = "4px 8px";
      contextEl.style.borderRadius = "3px";
      contextEl.textContent = issue.context;

      const actionsRow = document.createElement("div");
      actionsRow.style.display = "flex";
      actionsRow.style.gap = "6px";
      actionsRow.style.marginTop = "4px";

      if (issue.replacement !== null) {
        const btnFix = document.createElement("button");
        btnFix.type = "button";
        btnFix.className = "btn btn-xs btn-primary";
        btnFix.textContent = `Fix: "${issue.replacement}"`;
        btnFix.onclick = async () => {
          try {
            const updated = await invoke<GrammarAnalysisReport>("grammar_apply_fix", {
              blockId: issue.block_id,
              offset: issue.offset,
              length: issue.length,
              replacement: issue.replacement,
              ignoredRules: Array.from(ignoredRules),
              ignoredWords: Array.from(ignoredWords),
            });
            lastReport = updated;
            renderMetrics(updated);
            renderIssues();
            announce(`Applied fix for ${issue.rule_id}`);
            _hooks?.onBlockUpdated?.();
          } catch (e) {
            console.error("Failed to apply grammar fix", e);
          }
        };
        actionsRow.appendChild(btnFix);
      }

      const btnIgnoreRule = document.createElement("button");
      btnIgnoreRule.type = "button";
      btnIgnoreRule.className = "btn btn-xs";
      btnIgnoreRule.textContent = "Ignore Rule";
      btnIgnoreRule.onclick = () => {
        ignoredRules.add(issue.rule_id);
        refreshReport();
      };
      actionsRow.appendChild(btnIgnoreRule);

      if (issue.matched_text && issue.matched_text.length < 30) {
        const btnIgnoreWord = document.createElement("button");
        btnIgnoreWord.type = "button";
        btnIgnoreWord.className = "btn btn-xs";
        btnIgnoreWord.textContent = `Ignore "${issue.matched_text}"`;
        btnIgnoreWord.onclick = () => {
          ignoredWords.add(issue.matched_text.toLowerCase());
          refreshReport();
        };
        actionsRow.appendChild(btnIgnoreWord);
      }

      if (_hooks?.onSelectBlock) {
        const btnSelect = document.createElement("button");
        btnSelect.type = "button";
        btnSelect.className = "btn btn-xs";
        btnSelect.textContent = "Go to Block";
        btnSelect.onclick = () => {
          _hooks.onSelectBlock?.(issue.block_id);
        };
        actionsRow.appendChild(btnSelect);
      }

      item.append(topRow, msg, contextEl, actionsRow);
      issuesContainer.appendChild(item);
    }
  }

  async function refreshReport() {
    try {
      const report = await invoke<GrammarAnalysisReport>("grammar_analyze", {
        ignoredRules: Array.from(ignoredRules),
        ignoredWords: Array.from(ignoredWords),
      });
      lastReport = report;
      renderMetrics(report);
      renderIssues();
    } catch (e) {
      console.error("Failed to run grammar analysis", e);
    }
  }

  return {
    dialog,
    show: async () => {
      dialog.classList.remove("hidden");
      dialog.showModal();
      await refreshReport();
      announce("Grammar and style analysis opened");
    },
    close: () => {
      dialog.close();
    },
    refresh: refreshReport,
  };
}
