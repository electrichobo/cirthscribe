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
//
// 0.8.2 (owner, 2026-11-03): comments are called Feedback, and each thread is
// feedback, a suggestion or a note. None of them ever changes the script. A
// line with feedback shows a small icon at the right edge of the page; the
// icon opens a pop-up with that line's threads. The toolbar's Feedback button
// shows or hides the icons and highlights; Tools > Feedback… is the full list.
// Select text and right-click to add feedback, a suggestion or a note.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";
import { confirmDialog } from "./confirm";
import { icon } from "./icons";
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
  /** "comment" (feedback), "suggestion" or "note". */
  kind: ThreadKind;
}

export type ThreadKind = "comment" | "suggestion" | "note";
export const KIND_LABEL: Record<string, string> = { comment: "Feedback", suggestion: "Suggestion", note: "Note" };

// Clicking a line's icon: the Feedback dialog sets what happens (opens its pop-up).
let pinHandler: (blockId: string, pin: HTMLElement) => void = () => undefined;
export function setPinHandler(f: (blockId: string, pin: HTMLElement) => void) {
  pinHandler = f;
}

/** The icon beside a line with feedback (one per line, with a count when there are several). */
function pinFor(blockId: string, threads: CommentThreadView[]): HTMLElement {
  const open = threads.filter((t) => !t.resolved);
  const pin = document.createElement("span");
  pin.className = `fb-pin${open.length ? "" : " fb-resolved"}`;
  pin.contentEditable = "false";
  pin.dataset.blockId = blockId;
  pin.setAttribute("role", "button");
  pin.tabIndex = -1;
  const kinds = [...new Set(threads.map((t) => KIND_LABEL[t.kind] ?? "Feedback"))].join(", ");
  pin.setAttribute("aria-label", `${threads.length} ${kinds.toLowerCase()} on this line${open.length ? "" : " (resolved)"}`);
  pin.title = `${kinds}: ${threads[0].messages[0]?.text ?? threads[0].quote}`.slice(0, 160);
  pin.append(icon("comment"));
  if (threads.length > 1) {
    const n = document.createElement("span");
    n.className = "fb-count";
    n.textContent = String(threads.length);
    pin.append(n);
  }
  return pin;
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
            class: `cirth-comment-mark kind-${t.kind || "comment"}${t.resolved ? " cirth-comment-resolved" : ""}`,
            "data-thread-id": t.id,
            title: `Feedback: ${authorPrefix}${firstMsg}${t.resolved ? " (Resolved)" : ""}`,
          }),
        );
      }
    }
    // The line's icon, at the end of its text; CSS puts it in the right margin.
    const key = list.map((t) => `${t.id}:${t.resolved}:${t.messages.length}`).join("|");
    decos.push(Decoration.widget(pos + node.nodeSize - 1, () => pinFor(bid, list), { side: 1, key: `fb-${bid}-${key}`, ignoreSelection: true }));
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
      handleDOMEvents: {
        // A line's icon opens its feedback without moving the caret.
        mousedown(_view, e) {
          const pin = (e.target as HTMLElement).closest?.(".fb-pin") as HTMLElement | null;
          if (!pin?.dataset.blockId) return false;
          e.preventDefault();
          pinHandler(pin.dataset.blockId, pin);
          return true;
        },
      },
    },
  });
}

export interface CommentsDialogOptions {
  getView: () => EditorView | null;
  getDocumentId: () => string | null;
  jumpToBlock: (blockId: string) => void;
  onCommentsChanged?: (threads: CommentThreadView[]) => void;
  /** Make a change (a core command). The main window runs it; Feedback in its own window sends it there (ADR 0004). */
  write?: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Main window: move Feedback into a window of its own. */
  popOut?: () => void;
  /** Its own window: closing it puts Feedback back. */
  onClose?: () => void;
}

export interface CommentsDialog {
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  refresh: () => Promise<void>;
  openNewThreadPrompt: (kind?: ThreadKind) => void;
  closePopover: () => void;
  /** Right-click inside a selected text: the add-feedback menu (true if shown). */
  selectionMenu: (view: EditorView, e: MouseEvent) => boolean;
  toggleInlineView: () => void;
  getInlineView: () => boolean;
}

export function createCommentsDialog(opts: CommentsDialogOptions): CommentsDialog {
  const write = opts.write ?? ((command: string, args: Record<string, unknown>) => invoke(command, args));
  let overlay: HTMLElement | null = null;
  let dialog: HTMLElement | null = null;
  let state: CommentsState = { threads: [], planning_version: 0, can_undo: false, can_redo: false };
  let activeFilter: "all" | "open" | "resolved" | "orphaned" = "all";
  let showInline = true;
  try {
    showInline = localStorage.getItem("cirth.feedbackShown") !== "false";
  } catch {
    // shown, by default
  }
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
    dialog.setAttribute("aria-label", "Feedback");
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
      await write("planning_undo", { redo });
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
    title.textContent = "Feedback";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cirth-btn cirth-dialog-close";
    closeBtn.setAttribute("aria-label", "Close Feedback");
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => close();

    head.appendChild(title);
    if (opts.popOut) {
      const pop = document.createElement("button");
      pop.type = "button";
      pop.id = "comments-popout";
      pop.className = "cirth-btn cirth-btn-sm";
      pop.textContent = "Pop Out";
      pop.title = "Open Feedback in a window of its own, beside the script";
      pop.onclick = () => opts.popOut?.();
      head.appendChild(pop);
    }
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
    newBtn.textContent = "+ Add Feedback to Selection";
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
    searchInput.placeholder = "Filter feedback or quote…";
    searchInput.setAttribute("aria-label", "Filter feedback or quote");
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

  /** One thread as a card: in the Feedback window, and in the pop-up beside a line. */
  function threadCard(t: CommentThreadView, inPopover = false): HTMLElement {
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

    const kindBadge = document.createElement("span");
    kindBadge.className = `cirth-comment-kind kind-${t.kind || "comment"}`;
    kindBadge.textContent = KIND_LABEL[t.kind] ?? "Feedback";
    header.appendChild(kindBadge);

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
          alert("Select text in the script to reattach this feedback.");
          return;
        }
        await write("comments_reattach", {
          threadId: t.id,
          blockId: anchor.block_id,
          start: anchor.start,
          end: anchor.end,
          quote: anchor.quote,
        });
        await refresh();
        announce("Feedback reattached");
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
      await write("comments_add_reply", {
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
        if (inPopover) closePopover();
        else close();
      };
      footer.appendChild(jumpBtn);
    }

    const resolveBtn = document.createElement("button");
    resolveBtn.type = "button";
    resolveBtn.className = "cirth-btn cirth-btn-sm";
    resolveBtn.textContent = t.resolved ? "Reopen thread" : "Resolve thread";
    resolveBtn.onclick = async () => {
      await write("comments_set_resolved", {
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
      if (await confirmDialog("Delete this feedback?", "The feedback and its replies are removed. The script is not changed.", "Delete")) {
        await write("comments_delete_thread", { threadId: t.id });
        await refresh();
      }
    };
    footer.appendChild(deleteBtn);

    card.appendChild(footer);
    return card;
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
      empty.textContent = activeFilter === "all" ? "No feedback in this document." : `No ${activeFilter} feedback.`;
      list.appendChild(empty);
      return;
    }

    for (const t of filtered) {
      list.appendChild(threadCard(t));
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

  /** Add feedback, a suggestion or a note to the selected text (it never changes the script). */
  function openNewThreadPrompt(kind: ThreadKind = "comment"): void {
    const anchor = selectionAnchor(opts.getView(), opts.getDocumentId());
    if (!anchor) {
      announce("Select text in the script first, then add feedback to it", true);
      return;
    }
    const dlg = document.getElementById("feedback-add-dialog") as HTMLDialogElement | null ?? document.body.appendChild(document.createElement("dialog"));
    dlg.id = "feedback-add-dialog";
    dlg.className = "about form-dialog";
    dlg.setAttribute("aria-label", `Add ${KIND_LABEL[kind].toLowerCase()}`);
    const text = document.createElement("textarea");
    text.id = "feedback-add-text";
    text.rows = 4;
    text.placeholder = kind === "suggestion" ? "What you suggest instead (the script is never changed)" : kind === "note" ? "A note to keep with this text" : "Your feedback";
    text.setAttribute("aria-label", text.placeholder);
    const add = document.createElement("button");
    add.type = "button";
    add.id = "feedback-add-save";
    add.className = "primary";
    add.textContent = `Add ${KIND_LABEL[kind]}`;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dlg.close();
    const h = document.createElement("h2");
    h.textContent = `${KIND_LABEL[kind]} on “${anchor.quote.length > 60 ? anchor.quote.slice(0, 60) + "…" : anchor.quote}”`;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    actions.append(cancel, add);
    dlg.replaceChildren(h, text, actions);
    add.onclick = async () => {
      if (!text.value.trim()) return text.focus();
      try {
        await write("comments_add_thread", {
          documentId: anchor.document_id,
          blockId: anchor.block_id,
          start: anchor.start,
          end: anchor.end,
          quote: anchor.quote,
          author: "",
          text: text.value.trim(),
          kind,
        });
        dlg.close();
        await refresh();
        announce(`${KIND_LABEL[kind]} added`);
        opts.getView()?.focus();
      } catch (err) {
        announce(`Could not add ${KIND_LABEL[kind].toLowerCase()}: ${err}`, true);
      }
    };
    dlg.showModal();
    text.focus();
  }

  // The pop-up beside a line: that line's feedback, opened from its icon.
  let popover: HTMLElement | null = null;
  let popoverBlock: string | null = null;
  function closePopover() {
    popover?.remove();
    popover = null;
    popoverBlock = null;
  }
  function openPopover(blockId: string, pin: HTMLElement) {
    closePopover();
    const threads = state.threads.filter((t) => t.block_id === blockId && !t.orphaned);
    if (!threads.length) return;
    const pop = document.createElement("div");
    pop.id = "feedback-pop";
    pop.className = "feedback-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Feedback on this line");
    const head = document.createElement("div");
    head.className = "feedback-pop-head";
    const title = document.createElement("strong");
    title.textContent = threads.length === 1 ? KIND_LABEL[threads[0].kind] ?? "Feedback" : `${threads.length} on this line`;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "feedback-pop-close";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Close");
    x.onclick = () => {
      closePopover();
      opts.getView()?.focus();
    };
    head.append(title, x);
    pop.append(head, ...threads.map((t) => threadCard(t, true)));
    document.body.append(pop);
    const r = pin.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))}px`;
    pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 120)}px`;
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePopover();
        opts.getView()?.focus();
      }
    });
    popover = pop;
    popoverBlock = blockId;
    (pop.querySelector("input, button:not(.feedback-pop-close)") as HTMLElement | null)?.focus();
  }
  // Right-click inside a selection: add feedback, a suggestion or a note to it.
  const selMenu = document.createElement("div");
  selMenu.id = "feedback-menu";
  selMenu.className = "feedback-menu";
  selMenu.setAttribute("role", "menu");
  selMenu.hidden = true;
  document.body.append(selMenu);
  function closeSelMenu() {
    selMenu.hidden = true;
  }
  function selectionMenu(view: EditorView, e: MouseEvent): boolean {
    const { from, to, empty } = view.state.selection;
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (empty || !hit || hit.pos < from || hit.pos > to) return false;
    e.preventDefault();
    const items: [string, string, () => void][] = [
      ["comment", "Add Feedback…", () => openNewThreadPrompt("comment")],
      ["suggestion", "Add Suggestion…", () => openNewThreadPrompt("suggestion")],
      ["note", "Add Note…", () => openNewThreadPrompt("note")],
      ["copy", "Copy", () => void navigator.clipboard?.writeText(view.state.doc.textBetween(from, to, "\n")).catch(() => undefined)],
    ];
    selMenu.replaceChildren(
      ...items.map(([id, label, run]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.dataset.add = id;
        b.textContent = label;
        b.onclick = () => {
          closeSelMenu();
          run();
        };
        return b;
      }),
    );
    selMenu.hidden = false;
    selMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    selMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;
    (selMenu.firstElementChild as HTMLElement | null)?.focus();
    selMenu.onkeydown = (k) => {
      const bs = [...selMenu.querySelectorAll<HTMLElement>("button")];
      const i = bs.indexOf(document.activeElement as HTMLElement);
      if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        k.preventDefault();
        bs[(i + (k.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]?.focus();
      } else if (k.key === "Escape") {
        closeSelMenu();
        view.focus();
      }
    };
    return true;
  }
  document.addEventListener("mousedown", (e) => {
    if (!selMenu.hidden && !selMenu.contains(e.target as Node)) closeSelMenu();
  });

  setPinHandler((blockId, pin) => (popoverBlock === blockId ? closePopover() : openPopover(blockId, pin)));
  document.addEventListener("mousedown", (e) => {
    if (popover && !popover.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".fb-pin")) closePopover();
  });

  async function open(): Promise<void> {
    const { overlay: o } = ensureElements();
    await loadState();
    render();
    o.hidden = false;
    announce("Feedback opened");
  }

  function close(): void {
    if (overlay) overlay.hidden = true;
    opts.getView()?.focus();
    opts.onClose?.();
  }

  function isOpen(): boolean {
    return !!overlay && !overlay.hidden;
  }

  async function refresh(): Promise<void> {
    await loadState();
    if (isOpen()) render();
    if (popover && popoverBlock) {
      const block = popoverBlock;
      const pin = document.querySelector<HTMLElement>(`.fb-pin[data-block-id="${CSS.escape(block)}"]`);
      if (pin) openPopover(block, pin);
      else closePopover();
    }
  }

  function toggleInlineView(): void {
    showInline = !showInline;
    try {
      localStorage.setItem("cirth.feedbackShown", String(showInline));
    } catch {
      // this session only
    }
    if (!showInline) closePopover();
    updateEditorDecorations();
    announce(showInline ? "Feedback shown beside the script" : "Feedback hidden from the script");
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
    closePopover,
    selectionMenu,
    toggleInlineView,
    getInlineView,
  };
}
