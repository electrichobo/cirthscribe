// Rich-Text Treatments, Pitch Bibles & Project Bible Integration (M6 Step 5, ROADMAP M6).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface TreatmentItem {
  id: string;
  kind: "heading1" | "heading2" | "heading3" | "paragraph" | "blockquote" | "list_item" | "character";
  text: string;
  runs: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean }>;
  block_id: string;
}

export interface TreatmentEntityMention {
  entity_id: string;
  entity_name: string;
  kind: string;
  count: number;
  block_ids: string[];
}

export interface TreatmentDoc {
  title: string;
  subtitle: string | null;
  items: TreatmentItem[];
  total_headings: number;
  total_paragraphs: number;
  total_quotes: number;
  total_lists: number;
  total_words: number;
  reading_time_mins: number;
  mentions: TreatmentEntityMention[];
}

export function createTreatmentDialog(_hooks?: {
  onSelectBlock?: (blockId: string) => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "treatment-dialog";
  dialog.className = "about treatment-dialog hidden";
  dialog.setAttribute("aria-labelledby", "treatment-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "treatment-dialog-title";
  h.textContent = "Treatment & Pitch Bible Inspector";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Review prose treatment structure, reading time estimates, cross-referenced Project Bible entities, and export to semantic HTML, Plain Text, or Word (DOCX).";

  head.append(h, note);

  const body = document.createElement("div");
  body.className = "treatment-dialog-body";

  const metricsRow = document.createElement("div");
  metricsRow.className = "comic-metrics-grid";

  const bibleBox = document.createElement("div");
  bibleBox.className = "treatment-bible-mentions-box";

  const sectionsBox = document.createElement("div");
  sectionsBox.className = "treatment-sections-box";

  body.append(metricsRow, bibleBox, sectionsBox);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const exportHtmlBtn = document.createElement("button");
  exportHtmlBtn.className = "btn";
  exportHtmlBtn.textContent = "Export HTML";
  exportHtmlBtn.title = "Export semantic presentation-ready HTML treatment.";

  const exportTxtBtn = document.createElement("button");
  exportTxtBtn.className = "btn";
  exportTxtBtn.textContent = "Export Text";
  exportTxtBtn.title = "Export formatted plain text treatment.";

  const exportDocxBtn = document.createElement("button");
  exportDocxBtn.className = "btn";
  exportDocxBtn.textContent = "Export DOCX";
  exportDocxBtn.title = "Export Word (.docx) document with treatment styles.";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn primary";
  closeBtn.textContent = "Close";

  foot.append(exportHtmlBtn, exportTxtBtn, exportDocxBtn, closeBtn);

  dialog.append(head, body, foot);
  document.body.append(dialog);

  let currentDoc: TreatmentDoc | null = null;

  function renderMetrics(doc: TreatmentDoc) {
    metricsRow.innerHTML = "";
    const items = [
      { label: "Total Words", val: String(doc.total_words) },
      { label: "Reading Time", val: `~${doc.reading_time_mins} min` },
      { label: "Headings", val: String(doc.total_headings) },
      { label: "Paragraphs", val: String(doc.total_paragraphs) },
      { label: "Bible Mentions", val: String(doc.mentions.length) },
    ];

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "comic-metric-card";
      const v = document.createElement("div");
      v.className = "metric-val";
      v.textContent = item.val;
      const l = document.createElement("div");
      l.className = "metric-lbl";
      l.textContent = item.label;
      card.append(v, l);
      metricsRow.append(card);
    }
  }

  function renderBibleBox(doc: TreatmentDoc) {
    bibleBox.innerHTML = "";
    bibleBox.style.margin = "14px 0";
    bibleBox.style.padding = "14px";
    bibleBox.style.background = "#1e293b22";
    bibleBox.style.border = "1px solid #334155";
    bibleBox.style.borderRadius = "8px";

    const title = document.createElement("strong");
    title.textContent = `Project Bible Cross-References (${doc.mentions.length} entities):`;
    title.style.display = "block";
    title.style.marginBottom = "8px";
    title.style.color = "#38bdf8";
    bibleBox.append(title);

    if (doc.mentions.length === 0) {
      const p = document.createElement("p");
      p.textContent = "No Project Bible characters or locations were detected in this treatment's prose.";
      p.style.color = "#94a3b8";
      p.style.fontSize = "0.9em";
      bibleBox.append(p);
      return;
    }

    const tagCloud = document.createElement("div");
    tagCloud.style.display = "flex";
    tagCloud.style.flexWrap = "wrap";
    tagCloud.style.gap = "8px";

    for (const m of doc.mentions) {
      const badge = document.createElement("span");
      badge.textContent = `[${m.kind.toUpperCase()}] ${m.entity_name} (${m.count}x)`;
      badge.style.background = "#0284c722";
      badge.style.color = "#7dd3fc";
      badge.style.border = "1px solid #0284c755";
      badge.style.borderRadius = "4px";
      badge.style.padding = "4px 8px";
      badge.style.fontSize = "0.85em";
      badge.style.fontWeight = "600";
      tagCloud.append(badge);
    }
    bibleBox.append(tagCloud);
  }

  function renderSectionsBox(doc: TreatmentDoc) {
    sectionsBox.innerHTML = "";
    sectionsBox.style.margin = "14px 0";
    sectionsBox.style.padding = "14px";
    sectionsBox.style.background = "#0f172a";
    sectionsBox.style.border = "1px solid #1e293b";
    sectionsBox.style.borderRadius = "8px";
    sectionsBox.style.maxHeight = "240px";
    sectionsBox.style.overflowY = "auto";

    const title = document.createElement("strong");
    title.textContent = "Document Section Outline:";
    title.style.display = "block";
    title.style.marginBottom = "8px";
    title.style.color = "#cbd5e1";
    sectionsBox.append(title);

    const ul = document.createElement("ul");
    ul.style.margin = "0 0 0 18px";
    ul.style.padding = "0";

    const headings = doc.items.filter(
      (it) =>
        it.kind === "heading1" ||
        it.kind === "heading2" ||
        it.kind === "heading3" ||
        it.kind === "character"
    );

    if (headings.length === 0) {
      const p = document.createElement("p");
      p.textContent = "No section headings detected.";
      p.style.color = "#64748b";
      sectionsBox.append(p);
      return;
    }

    for (const hItem of headings) {
      const li = document.createElement("li");
      li.style.marginBottom = "4px";
      li.style.fontSize = "0.9em";

      if (hItem.kind === "heading1") {
        li.style.fontWeight = "bold";
        li.style.color = "#60a5fa";
        li.textContent = `H1: ${hItem.text}`;
      } else if (hItem.kind === "heading2") {
        li.style.fontWeight = "600";
        li.style.color = "#93c5fd";
        li.style.marginLeft = "12px";
        li.textContent = `H2: ${hItem.text}`;
      } else if (hItem.kind === "heading3") {
        li.style.color = "#bfdbfe";
        li.style.marginLeft = "24px";
        li.textContent = `H3: ${hItem.text}`;
      } else {
        li.style.color = "#cbd5e1";
        li.textContent = `[Character] ${hItem.text}`;
      }

      ul.append(li);
    }
    sectionsBox.append(ul);
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

  async function downloadBinaryFile(bytes: number[], filename: string, mime: string) {
    const u8 = new Uint8Array(bytes);
    const blob = new Blob([u8], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportHtmlBtn.onclick = async () => {
    try {
      const html = await invoke<string>("treatment_export_html", {});
      const filename = `${currentDoc?.title || "treatment"}.html`;
      await downloadStringFile(html, filename, "text/html;charset=utf-8");
      announce("Exported treatment HTML");
    } catch (e) {
      alert(`Export error: ${String(e)}`);
    }
  };

  exportTxtBtn.onclick = async () => {
    try {
      const txt = await invoke<string>("treatment_export_text", {});
      const filename = `${currentDoc?.title || "treatment"}.txt`;
      await downloadStringFile(txt, filename, "text/plain;charset=utf-8");
      announce("Exported treatment text");
    } catch (e) {
      alert(`Export error: ${String(e)}`);
    }
  };

  exportDocxBtn.onclick = async () => {
    try {
      const docxBytes = await invoke<number[]>("treatment_export_docx", {});
      const filename = `${currentDoc?.title || "treatment"}.docx`;
      await downloadBinaryFile(
        docxBytes,
        filename,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      announce("Exported treatment DOCX");
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
        const doc = await invoke<TreatmentDoc>("treatment_analyze", { documentId });
        currentDoc = doc;

        renderMetrics(doc);
        renderBibleBox(doc);
        renderSectionsBox(doc);

        dialog.classList.remove("hidden");
        dialog.showModal();
        announce("Treatment inspector opened");
      } catch (e) {
        alert(`Failed to analyze treatment: ${String(e)}`);
      }
    },
    close() {
      dialog.close();
      dialog.classList.add("hidden");
    },
  };
}
