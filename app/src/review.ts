// File > Import/Export Review Package (.cirth-review, M5 Step 6).
// Self-contained, portable review package containing script text, anchored comment threads,
// and block alternatives for outside review without machine paths, personal directories,
// or credentials (Acceptance F7, G5).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface ReviewPackageSummary {
  format: string;
  project_title: string;
  document_title: string;
  exported_at: string;
  reviewer: string;
  block_count: number;
  comment_thread_count: number;
  comment_message_count: number;
  alternative_count: number;
}

export interface ReviewExportResult {
  path: string;
  block_count: number;
  comment_thread_count: number;
  comment_message_count: number;
  alternative_count: number;
  bytes: number;
}

export interface ReviewImportReport {
  path: string;
  reviewer: string;
  threads_imported: number;
  messages_imported: number;
  alternatives_imported: number;
  orphaned_count: number;
  notes: string[];
}

export function createReviewDialog(hooks: {
  onImported?: (report: ReviewImportReport) => Promise<void> | void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "review-dialog";
  dialog.className = "about review-dialog hidden";
  dialog.setAttribute("aria-labelledby", "review-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "review-dialog-title";
  h.textContent = "Import Review Package";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Inspect outside notes, comment threads, and alternate takes before merging them cleanly into your script.";

  head.append(h, note);

  const statusEl = document.createElement("div");
  statusEl.id = "review-dialog-status";
  statusEl.className = "sr-only";
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  const body = document.createElement("div");
  body.className = "review-dialog-body";

  const card = document.createElement("div");
  card.className = "review-summary-card";

  const cardMeta = document.createElement("div");
  cardMeta.id = "review-summary-meta";
  cardMeta.className = "review-summary-meta";

  const statsGrid = document.createElement("div");
  statsGrid.id = "review-stats-grid";
  statsGrid.className = "review-stats-grid";

  card.append(cardMeta, statsGrid);
  body.append(card);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.id = "review-cancel-btn";
  cancelBtn.className = "btn btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => close();

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.id = "review-import-btn";
  importBtn.className = "btn btn-primary";
  importBtn.textContent = "Import Review Notes";
  importBtn.disabled = true;

  foot.append(cancelBtn, importBtn);
  dialog.append(head, statusEl, body, foot);
  document.body.appendChild(dialog);

  let currentPath: string | null = null;
  let currentSummary: ReviewPackageSummary | null = null;

  function close() {
    dialog.classList.add("hidden");
    if (dialog.open) {
      dialog.close();
    }
    currentPath = null;
    currentSummary = null;
    importBtn.disabled = true;
  }

  async function open(filePath: string): Promise<ReviewPackageSummary | null> {
    currentPath = filePath;
    statusEl.textContent = "Inspecting review package…";
    try {
      const summary = await invoke<ReviewPackageSummary>("review_inspect", { path: filePath });
      currentSummary = summary;

      cardMeta.innerHTML = `
        <div class="review-meta-row"><strong>Project:</strong> ${escapeHtml(summary.project_title)}</div>
        <div class="review-meta-row"><strong>Reviewer:</strong> ${escapeHtml(summary.reviewer)}</div>
        <div class="review-meta-row"><strong>Date:</strong> ${escapeHtml(summary.exported_at)}</div>
      `;

      statsGrid.innerHTML = `
        <div class="review-stat-box">
          <span class="stat-num">${summary.comment_thread_count}</span>
          <span class="stat-label">Comment Threads</span>
        </div>
        <div class="review-stat-box">
          <span class="stat-num">${summary.comment_message_count}</span>
          <span class="stat-label">Messages</span>
        </div>
        <div class="review-stat-box">
          <span class="stat-num">${summary.alternative_count}</span>
          <span class="stat-label">Alternate Takes</span>
        </div>
      `;

      importBtn.disabled = false;
      dialog.classList.remove("hidden");
      if (!dialog.open) {
        dialog.showModal();
      }
      announce(`Review package inspected: ${summary.comment_thread_count} threads and ${summary.alternative_count} alternatives found.`);
      return summary;
    } catch (e) {
      announce(`Cannot open review package: ${e}`);
      alert(`Cannot open review package: ${e}`);
      close();
      return null;
    }
  }

  importBtn.onclick = async () => {
    if (!currentPath) return;
    importBtn.disabled = true;
    statusEl.textContent = "Importing review notes…";
    try {
      const report = await invoke<ReviewImportReport>("review_apply", { path: currentPath });
      announce(`Review package imported: ${report.threads_imported} threads, ${report.alternatives_imported} alternatives.`);
      close();
      if (hooks.onImported) {
        await hooks.onImported(report);
      }
    } catch (e) {
      announce(`Import failed: ${e}`);
      alert(`Import failed: ${e}`);
      importBtn.disabled = false;
    }
  };

  return {
    open,
    close,
    isOpen: () => dialog.open && !dialog.classList.contains("hidden"),
    getSummary: () => currentSummary,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
