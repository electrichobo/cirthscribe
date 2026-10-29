// Non-destructive block alternatives (takes and alternate lines).
// ADR 0005 & M5 Step 2:
// Multiple takes per block; the canonical editor and document model always project
// the currently active take (Acceptance F4). Inactive takes are preserved safely.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface BlockAlternative {
  id: string;
  document_id: string;
  block_id: string;
  take_index: number;
  text: string;
  label: string;
  author: string;
  created_at: string;
  is_active: boolean;
}

export interface BlockTakesView {
  document_id: string;
  block_id: string;
  active_take_index: number;
  total_takes: number;
  takes: BlockAlternative[];
}

interface AlternativesPluginState {
  takesByBlock: Map<string, BlockAlternative[]>;
  documentId: string | null;
  decos: DecorationSet;
}

export const alternativesPluginKey = new PluginKey<AlternativesPluginState>("cirth-alternatives");

export interface AlternativesManagerOptions {
  getView: () => EditorView | null;
  getDocumentId: () => string | null;
  onTakeChanged?: (blockId: string, takeIndex: number) => void;
}

export interface AlternativesManager {
  refresh: () => Promise<void>;
  addTakePrompt: (blockId?: string) => Promise<void>;
  setActiveTake: (blockId: string, takeIndex: number) => Promise<void>;
  deleteTake: (blockId: string, takeIndex: number) => Promise<void>;
  getTakesForBlock: (blockId: string) => Promise<BlockTakesView | null>;
  getCurrentBlockId: () => string | null;
}

function buildAlternativeDecorations(
  doc: PMNode,
  takesByBlock: Map<string, BlockAlternative[]>,
  mgr: AlternativesManager,
): DecorationSet {
  if (!takesByBlock.size) return DecorationSet.empty;
  const decos: Decoration[] = [];

  doc.forEach((node, pos) => {
    const bid = node.attrs.id as string | undefined;
    if (!bid) return;
    const takes = takesByBlock.get(bid);
    if (!takes || takes.length <= 1) return;

    const active = takes.find((t) => t.is_active) ?? takes[0];
    const total = takes.length;
    const currentNum = (active?.take_index ?? 0) + 1;

    // Widget badge attached to the start of the block
    decos.push(
      Decoration.widget(
        pos + 1,
        () => {
          const wrap = document.createElement("span");
          wrap.className = "cirth-take-widget";
          wrap.setAttribute("contenteditable", "false");

          const badge = document.createElement("button");
          badge.type = "button";
          badge.className = "cirth-take-badge";
          badge.setAttribute("aria-label", `Take ${currentNum} of ${total}: ${active.label}. Click to switch take.`);
          badge.title = `Take ${currentNum} of ${total} (${active.label}). Click to switch.`;
          badge.textContent = `Take ${currentNum}/${total} ▾`;

          badge.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            openTakePicker(badge, bid, takes, mgr);
          };

          wrap.appendChild(badge);
          return wrap;
        },
        { side: -1, key: `alt-${bid}-${currentNum}-${total}` },
      ),
    );
  });

  return DecorationSet.create(doc, decos);
}

let activePicker: HTMLElement | null = null;

function closeTakePicker() {
  if (activePicker) {
    activePicker.remove();
    activePicker = null;
  }
}

document.addEventListener("click", (e) => {
  if (activePicker && !activePicker.contains(e.target as Node)) {
    closeTakePicker();
  }
});

function openTakePicker(
  anchorEl: HTMLElement,
  blockId: string,
  takes: BlockAlternative[],
  mgr: AlternativesManager,
) {
  closeTakePicker();

  const menu = document.createElement("div");
  menu.className = "cirth-take-dropdown cirth-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Alternate takes");

  const head = document.createElement("div");
  head.className = "cirth-take-dropdown-head";
  head.textContent = "Alternate Takes";
  menu.appendChild(head);

  for (const t of takes) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `cirth-take-item ${t.is_active ? "active" : ""}`;
    item.setAttribute("role", "menuitem");

    const check = document.createElement("span");
    check.className = "cirth-take-check";
    check.textContent = t.is_active ? "✓ " : "  ";

    const labelSpan = document.createElement("strong");
    labelSpan.textContent = `Take ${t.take_index + 1}: ${t.label}`;

    const previewSpan = document.createElement("span");
    previewSpan.className = "cirth-take-preview";
    const snippet = t.text.length > 40 ? t.text.slice(0, 40) + "…" : t.text;
    previewSpan.textContent = `“${snippet}”`;

    item.appendChild(check);
    item.appendChild(labelSpan);
    item.appendChild(document.createElement("br"));
    item.appendChild(previewSpan);

    item.onclick = async (e) => {
      e.stopPropagation();
      closeTakePicker();
      if (!t.is_active) {
        await mgr.setActiveTake(blockId, t.take_index);
      }
    };

    menu.appendChild(item);
  }

  // Divider
  const hr = document.createElement("hr");
  hr.className = "cirth-menu-divider";
  menu.appendChild(hr);

  // + Add take button
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "cirth-take-add-btn cirth-btn cirth-btn-sm";
  addBtn.textContent = "+ Add Alternate Take…";
  addBtn.onclick = async (e) => {
    e.stopPropagation();
    closeTakePicker();
    await mgr.addTakePrompt(blockId);
  };
  menu.appendChild(addBtn);

  // Delete inactive takes if any
  const inactiveTakes = takes.filter((t) => !t.is_active);
  if (inactiveTakes.length > 0) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "cirth-take-del-btn cirth-btn cirth-btn-sm cirth-btn-danger";
    delBtn.textContent = "Delete Inactive Takes…";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      closeTakePicker();
      const choice = inactiveTakes[0];
      if (confirm(`Delete Take ${choice.take_index + 1} (${choice.label})?`)) {
        await mgr.deleteTake(blockId, choice.take_index);
      }
    };
    menu.appendChild(delBtn);
  }

  document.body.appendChild(menu);
  activePicker = menu;

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.zIndex = "1000";
}

export function createAlternativesManager(opts: AlternativesManagerOptions): AlternativesManager {
  let takesByBlock = new Map<string, BlockAlternative[]>();

  const mgr: AlternativesManager = {
    async refresh(): Promise<void> {
      const docId = opts.getDocumentId();
      if (!docId) {
        takesByBlock.clear();
        updateDecorations();
        return;
      }
      try {
        const alts = await invoke<BlockAlternative[]>("alternatives_for_document", { documentId: docId });
        takesByBlock.clear();
        for (const a of alts) {
          let list = takesByBlock.get(a.block_id);
          if (!list) takesByBlock.set(a.block_id, (list = []));
          list.push(a);
        }
        updateDecorations();
      } catch (e) {
        console.error("Failed to load alternatives:", e);
      }
    },

    getCurrentBlockId(): string | null {
      const view = opts.getView();
      if (!view) return null;
      const $from = view.state.selection.$from;
      const node = $from.depth >= 1 ? $from.node(1) : null;
      return (node?.attrs?.id as string) || null;
    },

    async getTakesForBlock(blockId: string): Promise<BlockTakesView | null> {
      const docId = opts.getDocumentId();
      try {
        return await invoke<BlockTakesView>("alternatives_for_block", {
          documentId: docId,
          blockId,
        });
      } catch {
        return null;
      }
    },

    async addTakePrompt(blockId?: string): Promise<void> {
      const bid = blockId || mgr.getCurrentBlockId();
      if (!bid) {
        alert("Please click inside a dialogue or action line to add an alternate take.");
        return;
      }

      const text = prompt("Enter alternate line / take text:");
      if (text === null || !text.trim()) return;

      const label = prompt("Take label (e.g. 'Take 2', 'Humorous', 'Understated'):", "Alternate");
      if (label === null) return;

      const docId = opts.getDocumentId();
      try {
        const view = await invoke<BlockTakesView>("alternatives_add_take", {
          documentId: docId,
          blockId: bid,
          text: text.trim(),
          label: label.trim() || "Alternate",
          author: "",
        });
        announce(`Alternate take added for block. Total takes: ${view.total_takes}`);
        await mgr.refresh();
      } catch (e) {
        alert(`Failed to add alternate take: ${e}`);
      }
    },

    async setActiveTake(blockId: string, takeIndex: number): Promise<void> {
      const docId = opts.getDocumentId();
      try {
        const viewData = await invoke<BlockTakesView>("alternatives_set_active_take", {
          documentId: docId,
          blockId,
          takeIndex,
        });
        const activeTake = viewData.takes.find((t) => t.is_active);
        if (activeTake) {
          // Update editor node text for seamless projection
          const view = opts.getView();
          if (view) {
            let targetPos: number | null = null;
            let targetNode: PMNode | null = null;
            view.state.doc.forEach((n, p) => {
              if (n.attrs.id === blockId) {
                targetPos = p;
                targetNode = n;
              }
            });
            if (targetPos !== null && targetNode !== null) {
              const tr = view.state.tr.replaceWith(
                targetPos + 1,
                targetPos + (targetNode as PMNode).nodeSize - 1,
                view.state.schema.text(activeTake.text),
              );
              view.dispatch(tr);
            }
          }
        }
        announce(`Switched to Take ${takeIndex + 1}`);
        if (opts.onTakeChanged) opts.onTakeChanged(blockId, takeIndex);
        await mgr.refresh();
      } catch (e) {
        alert(`Failed to switch take: ${e}`);
      }
    },

    async deleteTake(blockId: string, takeIndex: number): Promise<void> {
      const docId = opts.getDocumentId();
      try {
        await invoke<BlockTakesView>("alternatives_delete_take", {
          documentId: docId,
          blockId,
          takeIndex,
        });
        announce(`Take ${takeIndex + 1} deleted`);
        await mgr.refresh();
      } catch (e) {
        alert(`Failed to delete take: ${e}`);
      }
    },
  };

  function updateDecorations() {
    const view = opts.getView();
    if (!view) return;
    const docId = opts.getDocumentId();
    view.dispatch(
      view.state.tr.setMeta(alternativesPluginKey, {
        takesByBlock,
        documentId: docId,
        mgr,
      }),
    );
  }

  return mgr;
}

export function alternativesPlugin(mgrRef: { current: AlternativesManager | null }): Plugin<AlternativesPluginState> {
  return new Plugin<AlternativesPluginState>({
    key: alternativesPluginKey,
    state: {
      init: (): AlternativesPluginState => ({
        takesByBlock: new Map(),
        documentId: null,
        decos: DecorationSet.empty,
      }),
      apply(tr, prev, _oldState, newState): AlternativesPluginState {
        const meta = tr.getMeta(alternativesPluginKey) as
          | { takesByBlock?: Map<string, BlockAlternative[]>; documentId?: string | null; mgr?: AlternativesManager }
          | undefined;
        if (meta) {
          const takes = meta.takesByBlock !== undefined ? meta.takesByBlock : prev.takesByBlock;
          const docId = meta.documentId !== undefined ? meta.documentId : prev.documentId;
          const mgr = meta.mgr || mgrRef.current;
          return {
            takesByBlock: takes,
            documentId: docId,
            decos: mgr ? buildAlternativeDecorations(newState.doc, takes, mgr) : DecorationSet.empty,
          };
        }
        if (tr.docChanged && mgrRef.current) {
          return {
            ...prev,
            decos: buildAlternativeDecorations(newState.doc, prev.takesByBlock, mgrRef.current),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return alternativesPluginKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
}
