// View > Tools > Comments… (M5 step 1, ROADMAP M5, ACCEPTANCE F1, F2, F3):
// anchored comment threads and reply messages attached to exact text spans
// `[start, end)` (in Unicode scalar values at the core boundary).
//
// Comment threads survive typing before/inside/after, block splits, joins,
// scene reordering, and undo. Deleting referenced text marks the thread
// as an orphan (`orphaned = true`) with its original quote and replies kept,
// with a reattach option (Acceptance F1, F2).
//
// Writers can view comments inline as highlights on script text or in a dedicated
// review panel/dialog; toggling views never creates duplicate comments (Acceptance F3).

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";
import { charToUtf16Offset, selectionAnchor } from "./tags";

export interface CommentMessage {
  id: string;
  thread_id: string;
  author: string;
  text: string;
  created_at: string;
  edited_at: string | null;
}

export interface CommentThread {
  id: string;
  document_id: string;
  block_id: string;
  start: number;
  end: number;
  quote: string;
  author: string;
  created_at: string;
  resolved: boolean;
  orphaned: boolean;
}

export interface CommentThreadView extends CommentThread {
  messages: CommentMessage[];
  scene_id: string | null;
  scene_number: string | null;
  heading: string;
  document_title: string;
}

export interface CommentsState {
  threads: CommentThreadView[];
  planning_version: number;
  can_undo: boolean;
  can_redo: boolean;
}

interface CommentsPluginState {
  threads: CommentThreadView[];
  documentId: string | null;
  decos: DecorationSet;
  showInline: boolean;
}

export const commentsPluginKey = new PluginKey<CommentsPluginState>("cirth-comments");

function buildCommentDecorations(doc: PMNode, threads: CommentThreadView[], documentId: string | null, showInline: boolean): DecorationSet {
  if (!showInline || !documentId || !threads.length) return DecorationSet.empty;
  const byBlock = new Map<string, CommentThreadView[]>();
  for (const t of threads) {
    if (t.orphaned || t.document_id !== documentId) continue;
    let list = byBlock.get(t.block_id);
    if (!list) byBlock.set(t.block_id, (list = []));
    list.push(t);
  }
  if (!byBlock.size) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    const bid = node.attrs.id as string | undefined;
    if (!bid) return;
    const list = byBlock.get(bid);
    if (!list) return;
    const text = node.textContent;
    for (const t of list) {
      const fromU16 = charToUtf16Offset(text, t.start);
      const toU16 = charToUtf16Offset(text, t.end);
      if (fromU16 >= 0 && toU16 > fromU16 && toU16 <= text.length) {
        const firstMsg = t.messages[0]?.text || t.quote;
        const authorPrefix = t.author ? `${t.author}: ` : "";
        decos.push(
          Decoration.inline(pos + 1 + fromU16, pos + 1 + toU16, {
            class: `cirth-comment-mark${t.resolved ? " cirth-comment-resolved" : ""}`,
            "data-thread-id": t.id,
            title: `Comment: ${authorPrefix}${firstMsg}${t.resolved ? " (Resolved)" : ""}`,
          }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export function commentsPlugin(): Plugin<CommentsPluginState> {
  return new Plugin<CommentsPluginState>({
    key: commentsPluginKey,
    state: {
      init: (): CommentsPluginState => ({ threads: [], documentId: null, decos: DecorationSet.empty, showInline: true }),
      apply(tr, prev, _oldState, newState): CommentsPluginState {
        const meta = tr.getMeta(commentsPluginKey) as
          | { threads?: CommentThreadView[]; documentId?: string | null; showInline?: boolean }
          | undefined;
        if (meta) {
          const threads = meta.threads !== undefined ? meta.threads : prev.threads;
          const documentId = meta.documentId !== undefined ? meta.documentId : prev.documentId;
          const showInline = meta.showInline !== undefined ? meta.showInline : prev.showInline;
          return {
            threads,
            documentId,
            showInline,
            decos: buildCommentDecorations(newState.doc, threads, documentId, showInline),
          };
        }
        if (tr.docChanged) {
          return {
            ...prev,
            decos: buildCommentDecorations(newState.doc, prev.threads, prev.documentId, prev.showInline),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return commentsPluginKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
}

export interface CommentsDialogOptions {
  getView: () => EditorView | null;
  getDocumentId: () => string | null;
  jumpToBlock: (blockId: string) => void;
  onCommentsChanged?: (threads: CommentThreadView[]) => void;
}

export interface CommentsDialog {
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  refresh: () => Promise<void>;
  openNewThreadPrompt: () => void;
  toggleInlineView: () => void;
  getInlineView: () => boolean;
}

export function createCommentsDialog(opts: CommentsDialogOptions): CommentsDialog {
  let overlay: HTMLElement | null = null;
  let dialog: HTMLElement | null = null;
  let state: CommentsState = { threads: [], planning_version: 0, can_undo: false, can_redo: false };
  let activeFilter: "all" | "open" | "resolved" | "orphaned" = "all";
  let showInline = true;
  let searchFilter = "";

  function ensureElements(): { overlay: HTMLElement; dialog: HTMLElement } {
    if (overlay && dialog) return { overlay, dialog };
    overlay = document.createElement("div");
    overlay.id = "comments-overlay";
    overlay.className = "cirth-dialog-overlay";
    overlay.hidden = true;

    dialog = document.createElement("div");
    dialog.id = "comments-dialog";
    dialog.className = "cirth-dialog cirth-comments-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Comments and Review");
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    dialog.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        e.stopPropagation();
        await handleUndo(e.shiftKey);
      }
    });

    return { overlay, dialog };
  }

  async function handleUndo(redo: boolean) {
    try {
      await invoke("planning_undo", { redo });
      await refresh();
      announce(redo ? "Redone" : "Undone");
    } catch (e) {
      announce(`Undo failed: ${e}`);
    }
  }

  async function loadState(): Promise<void> {
    const docId = opts.getDocumentId();
    state = await invoke<CommentsState>("comments_state", { documentId: docId });
    updateEditorDecorations();
    if (opts.onCommentsChanged) opts.onCommentsChanged(state.threads);
  }

  function updateEditorDecorations(): void {
    const view = opts.getView();
    if (!view) return;
    const docId = opts.getDocumentId();
    view.dispatch(view.state.tr.setMeta(commentsPluginKey, { threads: state.threads, documentId: docId, showInline }));
  }

  function render(): void {
    const { dialog: d } = ensureElements();
    d.innerHTML = "";

    // Header
    const head = document.createElement("div");
    head.className = "cirth-comments-header";
    const title = document.createElement("h2");
    title.textContent = "Comments & Review";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cirth-btn cirth-dialog-close";
    closeBtn.setAttribute("aria-label", "Close comments dialog");
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => close();

    head.appendChild(title);
    head.appendChild(closeBtn);
    d.appendChild(head);

    // Toolbar
    const bar = document.createElement("div");
    bar.className = "cirth-comments-toolbar";

    // New comment from selection button
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.id = "comments-new-btn";
    newBtn.className = "cirth-btn cirth-btn-primary";
    newBtn.textContent = "+ Add Comment to Selection";
    newBtn.onclick = () => openNewThreadPrompt();
    bar.appendChild(newBtn);

    // Toggle inline view (Acceptance F3)
    const toggleInlineBtn = document.createElement("button");
    toggleInlineBtn.type = "button";
    toggleInlineBtn.id = "comments-toggle-inline-btn";
    toggleInlineBtn.className = `cirth-btn ${showInline ? "cirth-btn-active" : ""}`;
    toggleInlineBtn.textContent = showInline ? "Inline Highlights: ON" : "Inline Highlights: OFF";
    toggleInlineBtn.onclick = () => {
      toggleInlineView();
      render();
    };
    bar.appendChild(toggleInlineBtn);

    // Undo / Redo buttons
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "cirth-btn";
    undoBtn.textContent = "Undo";
    undoBtn.disabled = !state.can_undo;
    undoBtn.onclick = async () => handleUndo(false);
    bar.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "cirth-btn";
    redoBtn.textContent = "Redo";
    redoBtn.disabled = !state.can_redo;
    redoBtn.onclick = async () => handleUndo(true);
    bar.appendChild(redoBtn);

    d.appendChild(bar);

    // Filter tabs & search
    const filterRow = document.createElement("div");
    filterRow.className = "cirth-comments-filter-row";

    const filterTabs = document.createElement("div");
    filterTabs.className = "cirth-comments-tabs";
    const counts = {
      all: state.threads.length,
      open: state.threads.filter((t) => !t.resolved && !t.orphaned).length,
      resolved: state.threads.filter((t) => t.resolved).length,
      orphaned: state.threads.filter((t) => t.orphaned).length,
    };

    for (const key of ["all", "open", "resolved", "orphaned"] as const) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `cirth-comments-tab ${activeFilter === key ? "active" : ""}`;
      tab.textContent = `${key.charAt(0).toUpperCase() + key.slice(1)} (${counts[key]})`;
      tab.onclick = () => {
        activeFilter = key;
        render();
      };
      filterTabs.appendChild(tab);
    }
    filterRow.appendChild(filterTabs);

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "cirth-input cirth-comments-search";
    searchInput.placeholder = "Filter comments or quote…";
    searchInput.setAttribute("aria-label", "Filter comments or quote");
    searchInput.value = searchFilter;
    searchInput.oninput = () => {
      searchFilter = searchInput.value.trim().toLowerCase();
      renderList();
    };
    filterRow.appendChild(searchInput);

    d.appendChild(filterRow);

    // List container
    const listContainer = document.createElement("div");
    listContainer.id = "comments-list-container";
    listContainer.className = "cirth-comments-list";
    d.appendChild(listContainer);

    renderList();
  }

  function renderList(): void {
    const list = dialog?.querySelector("#comments-list-container");
    if (!list) return;
    list.innerHTML = "";

    let filtered = state.threads.filter((t) => {
      if (activeFilter === "open") return !t.resolved && !t.orphaned;
      if (activeFilter === "resolved") return t.resolved;
      if (activeFilter === "orphaned") return t.orphaned;
      return true;
    });

    if (searchFilter) {
      filtered = filtered.filter((t) => {
        const matchesQuote = t.quote.toLowerCase().includes(searchFilter);
        const matchesMessages = t.messages.some((m) => m.text.toLowerCase().includes(searchFilter) || m.author.toLowerCase().includes(searchFilter));
        const matchesHeading = t.heading.toLowerCase().includes(searchFilter);
        return matchesQuote || matchesMessages || matchesHeading;
      });
    }

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "cirth-comments-empty";
      empty.textContent = activeFilter === "all" ? "No comments in this document." : `No ${activeFilter} comments.`;
      list.appendChild(empty);
      return;
    }

    for (const t of filtered) {
      const card = document.createElement("div");
      card.className = `cirth-comment-card ${t.resolved ? "resolved" : ""} ${t.orphaned ? "orphaned" : ""}`;
      card.setAttribute("data-thread-id", t.id);

      // Card Header
      const header = document.createElement("div");
      header.className = "cirth-comment-card-head";

      const locInfo = document.createElement("span");
      locInfo.className = "cirth-comment-loc";
      locInfo.textContent = t.heading ? `${t.scene_number ? t.scene_number + " " : ""}${t.heading}` : "Scene";
      header.appendChild(locInfo);

      const statusBadge = document.createElement("span");
      statusBadge.className = `cirth-comment-badge ${t.orphaned ? "badge-orphan" : t.resolved ? "badge-resolved" : "badge-open"}`;
      statusBadge.textContent = t.orphaned ? "Orphaned" : t.resolved ? "Resolved" : "Open";
      header.appendChild(statusBadge);

      card.appendChild(header);

      // Quote & Anchor preview
      const quoteBox = document.createElement("blockquote");
      quoteBox.className = "cirth-comment-quote";
      quoteBox.textContent = `“${t.quote}”`;
      card.appendChild(quoteBox);

      // Orphan alert & Reattach action
      if (t.orphaned) {
        const orphanWarn = document.createElement("div");
        orphanWarn.className = "cirth-comment-orphan-warning";
        orphanWarn.innerHTML = "<span>Referenced text was deleted or cut.</span>";

        const reattachBtn = document.createElement("button");
        reattachBtn.type = "button";
        reattachBtn.className = "cirth-btn cirth-btn-sm cirth-btn-primary";
        reattachBtn.textContent = "Reattach to Current Selection";
        reattachBtn.onclick = async () => {
          const anchor = selectionAnchor(opts.getView(), opts.getDocumentId());
          if (!anchor) {
            announce("Select replacement text in the editor first");
            alert("Please highlight text in the script editor to reattach this comment thread.");
            return;
          }
          await invoke("comments_reattach", {
            threadId: t.id,
            blockId: anchor.block_id,
            start: anchor.start,
            end: anchor.end,
            quote: anchor.quote,
          });
          await refresh();
          announce("Comment thread reattached");
        };
        orphanWarn.appendChild(reattachBtn);
        card.appendChild(orphanWarn);
      }

      // Messages Thread
      const messagesDiv = document.createElement("div");
      messagesDiv.className = "cirth-comment-messages";
      for (const m of t.messages) {
        const mRow = document.createElement("div");
        mRow.className = "cirth-comment-msg";

        const mHead = document.createElement("div");
        mHead.className = "cirth-comment-msg-head";
        const authorSpan = document.createElement("strong");
        authorSpan.textContent = m.author || "Anonymous";
        const timeSpan = document.createElement("span");
        timeSpan.className = "cirth-comment-msg-time";
        timeSpan.textContent = formatTimestamp(m.created_at);
        mHead.appendChild(authorSpan);
        mHead.appendChild(timeSpan);
        mRow.appendChild(mHead);

        const mBody = document.createElement("div");
        mBody.className = "cirth-comment-msg-body";
        mBody.textContent = m.text;
        mRow.appendChild(mBody);

        messagesDiv.appendChild(mRow);
      }
      card.appendChild(messagesDiv);

      // Reply box
      const replyRow = document.createElement("div");
      replyRow.className = "cirth-comment-reply-row";
      const replyInput = document.createElement("input");
      replyInput.type = "text";
      replyInput.className = "cirth-input cirth-comment-reply-input";
      replyInput.placeholder = "Write a reply…";
      replyInput.setAttribute("aria-label", `Reply to thread on ${t.quote}`);

      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "cirth-btn cirth-btn-sm";
      replyBtn.textContent = "Reply";
      replyBtn.onclick = async () => {
        const text = replyInput.value.trim();
        if (!text) return;
        await invoke("comments_add_reply", {
          threadId: t.id,
          author: "",
          text,
        });
        replyInput.value = "";
        await refresh();
      };
      replyInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          replyBtn.click();
        }
      };

      replyRow.appendChild(replyInput);
      replyRow.appendChild(replyBtn);
      card.appendChild(replyRow);

      // Footer Actions: Jump to text, Resolve/Reopen, Delete thread
      const footer = document.createElement("div");
      footer.className = "cirth-comment-card-footer";

      if (!t.orphaned) {
        const jumpBtn = document.createElement("button");
        jumpBtn.type = "button";
        jumpBtn.className = "cirth-btn cirth-btn-sm";
        jumpBtn.textContent = "Jump to text";
        jumpBtn.onclick = () => {
          opts.jumpToBlock(t.block_id);
          close();
        };
        footer.appendChild(jumpBtn);
      }

      const resolveBtn = document.createElement("button");
      resolveBtn.type = "button";
      resolveBtn.className = "cirth-btn cirth-btn-sm";
      resolveBtn.textContent = t.resolved ? "Reopen thread" : "Resolve thread";
      resolveBtn.onclick = async () => {
        await invoke("comments_set_resolved", {
          threadId: t.id,
          resolved: !t.resolved,
        });
        await refresh();
      };
      footer.appendChild(resolveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "cirth-btn cirth-btn-sm cirth-btn-danger";
      deleteBtn.textContent = "Delete thread";
      deleteBtn.onclick = async () => {
        if (confirm("Delete this comment thread and its replies?")) {
          await invoke("comments_delete_thread", { threadId: t.id });
          await refresh();
        }
      };
      footer.appendChild(deleteBtn);

      card.appendChild(footer);
      list.appendChild(card);
    }
  }

  function formatTimestamp(iso: string): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  function openNewThreadPrompt(): void {
    const anchor = selectionAnchor(opts.getView(), opts.getDocumentId());
    if (!anchor) {
      announce("Select text in the editor first to add a comment");
      alert("Please highlight text in the screenplay editor to attach a comment thread.");
      return;
    }

    const text = prompt(`Comment on “${anchor.quote}”:`);
    if (text === null || !text.trim()) return;

    invoke("comments_add_thread", {
      documentId: anchor.document_id,
      blockId: anchor.block_id,
      start: anchor.start,
      end: anchor.end,
      quote: anchor.quote,
      author: "",
      text: text.trim(),
    }).then(async () => {
      await refresh();
      announce("Comment added");
    }).catch((err) => {
      announce(`Failed to add comment: ${err}`);
    });
  }

  async function open(): Promise<void> {
    const { overlay: o } = ensureElements();
    await loadState();
    render();
    o.hidden = false;
    announce("Comments and Review opened");
  }

  function close(): void {
    if (overlay) overlay.hidden = true;
    opts.getView()?.focus();
  }

  function isOpen(): boolean {
    return !!overlay && !overlay.hidden;
  }

  async function refresh(): Promise<void> {
    await loadState();
    if (isOpen()) render();
  }

  function toggleInlineView(): void {
    showInline = !showInline;
    updateEditorDecorations();
    announce(showInline ? "Inline comment highlights visible" : "Inline comment highlights hidden");
  }

  function getInlineView(): boolean {
    return showInline;
  }

  return {
    open,
    close,
    isOpen,
    refresh,
    openNewThreadPrompt,
    toggleInlineView,
    getInlineView,
  };
}
