// View > Tools > Breakdown Tags… (M4 step 3, ADR 0005, ACCEPTANCE E1, E2):
// production breakdown tags anchored to exact character spans `[start, end)`
// (in Unicode scalar values at the core boundary, converted to/from UTF-16
// code units in ProseMirror).
//
// Each tag points to a project bible entry (`entity_id`), so aliases such as
// "the red ledger" and "the ledger" belong to one prop. Suggested tags (bible
// names and aliases found in action lines) are listed for the writer to accept
// or reject, never applied automatically. When a tag's text or block is deleted,
// the tag becomes an orphan (`orphaned = true`) for the writer to review
// (reattach to the current selection or delete), never silently dropped.
//
// Every tag change is a `PlanningOp` (`PutTag`, `DeleteTag`, `PutEntity`, `Reject`)
// undone in the dialog (`Undo` button or Ctrl/Cmd+Z while the dialog has focus,
// ADR 0003). On screen, tagged spans carry a subtle underline with a category
// attribute (`span.cirth-tag-mark`) that never prints or alters pagination.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { announce } from "./a11y";
import type { Entity } from "./bible";

export interface Tag {
  id: string;
  document_id: string;
  block_id: string;
  /** Start offset in Unicode scalar values (`char` index). */
  start: number;
  /** End offset in Unicode scalar values (`char` index). */
  end: number;
  quote: string;
  category: string;
  entity_id: string;
  note: string;
  orphaned: boolean;
}

export interface TagView extends Tag {
  entity_name: string;
  scene_id: string | null;
  scene_number: string | null;
  heading: string;
  document_title: string;
}

export interface TagSuggestion {
  document_id: string;
  scene_id: string | null;
  block_id: string;
  start: number;
  end: number;
  quote: string;
  category: string;
  entity_id: string;
  entity_name: string;
}

export interface TagsState {
  tags: TagView[];
  suggestions: TagSuggestion[];
  categories: [string, string][];
  entities: Entity[];
  places: Record<string, { document_id: string; document_title: string; heading: string }>;
}

export type TagOp =
  | { PutTag: Tag }
  | { DeleteTag: string }
  | { PutEntity: Entity }
  | { Reject: { kind: string; name: string; on: boolean } };

export interface SelectionAnchor {
  document_id: string;
  block_id: string;
  start: number;
  end: number;
  quote: string;
}

/** Convert a UTF-16 code-unit index in `text` to a Unicode scalar (`char`) index. */
export function utf16ToCharOffset(text: string, utf16Offset: number): number {
  let chars = 0;
  let u = 0;
  for (const ch of text) {
    if (u >= utf16Offset) break;
    u += ch.length;
    chars++;
  }
  return chars;
}

/** Convert a Unicode scalar (`char`) index in `text` to a UTF-16 code-unit index. */
export function charToUtf16Offset(text: string, charOffset: number): number {
  let chars = 0;
  let u = 0;
  for (const ch of text) {
    if (chars >= charOffset) break;
    u += ch.length;
    chars++;
  }
  return u;
}

/** Extract the current single-block selection from the editor as a Unicode-scalar anchor. */
export function selectionAnchor(view: EditorView | null, documentId: string | null): SelectionAnchor | null {
  if (!view || !documentId) return null;
  const { $from, $to, empty } = view.state.selection;
  if (empty || $from.depth < 1 || $to.depth < 1) return null;
  const block = $from.node(1);
  if (block !== $to.node(1) || block.type.name !== "block" || !block.attrs.id) return null;
  const blockStart = $from.start(1);
  const fromU16 = $from.pos - blockStart;
  const toU16 = $to.pos - blockStart;
  if (fromU16 >= toU16) return null;
  const text = block.textContent;
  const quote = text.slice(fromU16, toU16);
  if (!quote.trim()) return null;
  const start = utf16ToCharOffset(text, fromU16);
  const end = utf16ToCharOffset(text, toU16);
  if (start >= end) return null;
  return {
    document_id: documentId,
    block_id: block.attrs.id as string,
    start,
    end,
    quote,
  };
}

interface TagsPluginState {
  tags: TagView[];
  documentId: string | null;
  decos: DecorationSet;
}

export const tagsPluginKey = new PluginKey<TagsPluginState>("cirth-tags");

function buildTagDecorations(doc: PMNode, tags: TagView[], documentId: string | null): DecorationSet {
  if (!documentId || !tags.length) return DecorationSet.empty;
  const byBlock = new Map<string, TagView[]>();
  for (const t of tags) {
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
        decos.push(
          Decoration.inline(pos + 1 + fromU16, pos + 1 + toU16, {
            class: "cirth-tag-mark",
            "data-tag-id": t.id,
            "data-tag-category": t.category,
            title: `${t.category}: ${t.entity_name}${t.note ? " — " + t.note : ""}`,
          }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export function tagsPlugin(): Plugin<TagsPluginState> {
  return new Plugin<TagsPluginState>({
    key: tagsPluginKey,
    state: {
      init: (): TagsPluginState => ({ tags: [], documentId: null, decos: DecorationSet.empty }),
      apply(tr, prev, _oldState, newState): TagsPluginState {
        const meta = tr.getMeta(tagsPluginKey) as { tags: TagView[]; documentId: string | null } | undefined;
        if (meta) {
          return {
            tags: meta.tags,
            documentId: meta.documentId,
            decos: buildTagDecorations(newState.doc, meta.tags, meta.documentId),
          };
        }
        if (tr.docChanged) {
          return {
            ...prev,
            decos: prev.decos.map(tr.mapping, tr.doc),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return tagsPluginKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export function createBreakdownTags(hooks: {
  state: () => Promise<TagsState>;
  apply: (op: TagOp) => Promise<boolean>;
  undo: () => Promise<boolean>;
  addCategory: (label: string) => Promise<[string, string]>;
  selection: () => SelectionAnchor | null;
  currentDocument: () => string | null;
  decorate: (tags: TagView[]) => void;
  go: (documentId: string, blockId: string, start: number, end: number) => void;
  newId: () => string;
}) {
  const dialog = el("dialog", { id: "tags-dialog", className: "about tags-dialog" });
  dialog.setAttribute("aria-labelledby", "tags-title");

  const h = el("h2", { id: "tags-title" }, "Breakdown Tags");
  const status = el("p", { id: "tags-status", className: "form-note" });
  status.setAttribute("role", "status");

  // Filter bar
  const filterCat = el("select", { id: "tags-filter-category" });
  filterCat.setAttribute("aria-label", "Filter by category");
  const filterScope = el("select", { id: "tags-filter-scope" });
  filterScope.setAttribute("aria-label", "Filter by status or scope");
  filterScope.append(
    new Option("All tags in project", "all"),
    new Option("This script only", "document"),
    new Option("Orphaned tags only", "orphaned"),
  );
  const searchInput = el("input", {
    type: "search",
    id: "tags-search",
    placeholder: "Filter by name, quote or scene…",
  });
  searchInput.setAttribute("aria-label", "Filter tags by text");

  // Custom category adder
  const newCatInput = el("input", {
    type: "text",
    id: "tags-new-category-name",
    placeholder: "New category name…",
  });
  newCatInput.setAttribute("aria-label", "New category name");
  const newCatBtn = el("button", { type: "button", id: "tags-add-category" }, "Add Category");

  const toolbar = el(
    "div",
    { className: "tags-toolbar" },
    filterCat,
    filterScope,
    searchInput,
    newCatInput,
    newCatBtn,
  );

  const selPanel = el("section", { className: "tags-selection-box", id: "tags-selection-box" });
  const left = el("div", { className: "tags-left" });
  const right = el("div", { className: "tags-right" });
  const cols = el("div", { className: "tags-cols" }, left, right);

  const undoBtn = el("button", { type: "button", id: "tags-undo", disabled: true }, "Undo");
  const closeBtn = el("button", { type: "button", id: "tags-close" }, "Close");
  dialog.append(h, status, selPanel, toolbar, cols, el("div", { className: "dialog-actions" }, undoBtn, closeBtn));
  document.body.append(dialog);

  let st: TagsState = { tags: [], suggestions: [], categories: [], entities: [], places: {} };
  let activeSel: SelectionAnchor | null = null;
  let steps = 0;

  const say = (msg: string) => {
    status.textContent = msg;
    announce(msg);
  };

  const catLabel = (key: string): string => st.categories.find(([k]) => k === key)?.[1] ?? key;

  async function runOp(op: TagOp, msg: string): Promise<boolean> {
    if (await hooks.apply(op)) {
      steps++;
      undoBtn.disabled = false;
      say(msg);
      await reload();
      return true;
    }
    say("Could not save tag change.");
    return false;
  }

  async function reload() {
    st = await hooks.state();
    hooks.decorate(st.tags);
    syncCategoryFilter();
    drawSelectionBox();
    drawLists();
  }

  function syncCategoryFilter() {
    const prev = filterCat.value || "all";
    filterCat.replaceChildren(new Option("All categories", "all"));
    for (const [k, label] of st.categories) {
      filterCat.add(new Option(label, k));
    }
    filterCat.value = [...filterCat.options].some((o) => o.value === prev) ? prev : "all";
  }

  function matchingEntities(category: string): Entity[] {
    if (category === "cast") {
      return st.entities.filter((e) => e.kind === "cast" || e.kind === "character");
    }
    return st.entities.filter((e) => e.kind === category);
  }

  function drawSelectionBox() {
    selPanel.replaceChildren();
    if (!activeSel) {
      selPanel.append(
        el(
          "p",
          { className: "form-note", id: "tags-no-selection" },
          "Select words in a single paragraph of the script before opening Breakdown Tags to tag that span, or review existing and suggested tags below.",
        ),
      );
      return;
    }
    const quoteBadge = el("strong", { id: "tags-selection-quote" }, `“${activeSel.quote}”`);
    const catSelect = el("select", { id: "tags-create-category" });
    catSelect.setAttribute("aria-label", "Tag category");
    for (const [k, label] of st.categories) catSelect.add(new Option(label, k));
    if (filterCat.value !== "all") catSelect.value = filterCat.value;

    const entitySelect = el("select", { id: "tags-create-entity" });
    entitySelect.setAttribute("aria-label", "Bible entry for tag");
    const newNameInput = el("input", {
      type: "text",
      id: "tags-create-name",
      value: activeSel.quote,
      placeholder: "Entry name in the bible",
    });
    newNameInput.setAttribute("aria-label", "New bible entry name");
    const aliasInput = el("input", {
      type: "text",
      id: "tags-create-aliases",
      placeholder: "Aliases (comma-separated, optional)",
    });
    aliasInput.setAttribute("aria-label", "Entry aliases");
    const noteInput = el("input", {
      type: "text",
      id: "tags-create-note",
      placeholder: "Production note (optional)",
    });
    noteInput.setAttribute("aria-label", "Tag note");

    const populateEntities = () => {
      const cat = catSelect.value;
      const list = matchingEntities(cat);
      entitySelect.replaceChildren(new Option("+ New bible entry…", ""));
      for (const e of list) {
        const aliases = e.aliases.length ? ` (${e.aliases.join(", ")})` : "";
        entitySelect.add(new Option(`${e.name}${aliases}`, e.id));
      }
      // Pre-select an existing entry if its name or alias matches `activeSel.quote` case-insensitively.
      const qLower = activeSel!.quote.trim().toLowerCase();
      const hit = list.find(
        (e) => e.name.toLowerCase() === qLower || e.aliases.some((a) => a.toLowerCase() === qLower),
      );
      entitySelect.value = hit ? hit.id : "";
      newNameInput.hidden = !!entitySelect.value;
      aliasInput.hidden = !!entitySelect.value;
    };
    catSelect.addEventListener("change", populateEntities);
    entitySelect.addEventListener("change", () => {
      const isNew = !entitySelect.value;
      newNameInput.hidden = !isNew;
      aliasInput.hidden = !isNew;
    });
    populateEntities();

    const addBtn = el("button", { type: "button", id: "tags-create-submit", className: "primary" }, "Tag Selection");
    addBtn.addEventListener("click", async () => {
      if (!activeSel) return;
      const category = catSelect.value;
      let entityId = entitySelect.value;
      let entityLabel = "";
      if (!entityId) {
        const name = newNameInput.value.trim() || activeSel.quote.trim();
        if (!name) return say("Enter a name for the bible entry.");
        entityId = hooks.newId();
        entityLabel = name;
        const extraAliases = aliasInput.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (activeSel.quote.trim().toLowerCase() !== name.toLowerCase()) {
          extraAliases.push(activeSel.quote.trim());
        }
        const entity: Entity = {
          id: entityId,
          kind: category,
          name,
          aliases: extraAliases,
          description: "",
          fields: [],
          scope: null,
        };
        if (!(await runOp({ PutEntity: entity }, `Added ${name} to the bible`))) return;
      } else {
        const existing = st.entities.find((e) => e.id === entityId);
        entityLabel = existing?.name ?? "entry";
        // If the selected text is not yet the entry's name or alias, add it as an alias so future suggestions recognize it.
        if (existing) {
          const qTrim = activeSel.quote.trim();
          const known = [existing.name, ...existing.aliases].some((n) => n.toLowerCase() === qTrim.toLowerCase());
          if (!known && qTrim) {
            await runOp(
              { PutEntity: { ...existing, aliases: [...existing.aliases, qTrim] } },
              `Added “${qTrim}” as an alias of ${existing.name}`,
            );
          }
        }
      }
      const tag: Tag = {
        id: hooks.newId(),
        document_id: activeSel.document_id,
        block_id: activeSel.block_id,
        start: activeSel.start,
        end: activeSel.end,
        quote: activeSel.quote,
        category,
        entity_id: entityId,
        note: noteInput.value.trim(),
        orphaned: false,
      };
      await runOp({ PutTag: tag }, `Tagged “${activeSel.quote}” as ${catLabel(category)} (${entityLabel})`);
    });

    selPanel.append(
      el("div", { className: "tags-selection-row" }, el("span", {}, "Selected text: "), quoteBadge),
      el("div", { className: "tags-selection-controls" }, catSelect, entitySelect, newNameInput, aliasInput, noteInput, addBtn),
    );
  }

  function drawLists() {
    left.replaceChildren();
    right.replaceChildren();

    const catFilter = filterCat.value;
    const scopeFilter = filterScope.value;
    const curDoc = hooks.currentDocument();
    const query = searchInput.value.trim().toLowerCase();

    const filteredTags = st.tags.filter((t) => {
      if (catFilter !== "all" && t.category !== catFilter) return false;
      if (scopeFilter === "document" && curDoc && t.document_id !== curDoc) return false;
      if (scopeFilter === "orphaned" && !t.orphaned) return false;
      if (query) {
        const hay = `${t.entity_name} ${t.quote} ${t.heading} ${t.note} ${catLabel(t.category)}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const orphanCount = st.tags.filter((t) => t.orphaned).length;
    const tagHeadingText = `Tags (${filteredTags.length}${orphanCount ? ` · ${orphanCount} orphaned` : ""})`;
    left.append(el("h3", {}, tagHeadingText));

    const tagList = el("ul", { className: "bible-list tags-list", id: "tags-list" });
    tagList.setAttribute("aria-label", "Breakdown tags");
    if (!filteredTags.length) {
      tagList.append(el("li", { className: "form-note" }, "No tags match the current filter."));
    }
    for (const t of filteredTags) {
      const li = el("li", { className: `tags-item${t.orphaned ? " tags-item-orphaned" : ""}` });
      li.dataset.tagId = t.id;
      li.dataset.category = t.category;
      li.dataset.orphaned = t.orphaned ? "true" : "false";

      const sceneLabel = t.scene_number ? `Scene ${t.scene_number}` : t.heading || t.document_title || "Script";
      const badge = el(
        "span",
        { className: "tags-badge" },
        t.orphaned ? `⚠ Orphaned · ${catLabel(t.category)}` : catLabel(t.category),
      );
      const titleSpan = el(
        "span",
        { className: "tags-item-main" },
        `${t.entity_name} — “${t.quote}” `,
        el("span", { className: "bible-meta" }, `(${sceneLabel})`),
      );
      const rowTop = el("div", { className: "tags-item-top" }, badge, titleSpan);
      if (t.note) rowTop.append(el("span", { className: "tags-item-note" }, ` · ${t.note}`));

      const actions = el("div", { className: "tags-item-actions" });
      if (!t.orphaned) {
        const goBtn = el("button", { type: "button", className: "tags-go" }, "Go to text");
        goBtn.addEventListener("click", () => {
          dialog.close();
          hooks.go(t.document_id, t.block_id, t.start, t.end);
        });
        actions.append(goBtn);
      } else if (activeSel) {
        const reattachBtn = el("button", { type: "button", className: "tags-reattach primary" }, "Reattach to selection");
        reattachBtn.addEventListener("click", () => {
          if (!activeSel) return;
          const updated: Tag = {
            id: t.id,
            document_id: activeSel.document_id,
            block_id: activeSel.block_id,
            start: activeSel.start,
            end: activeSel.end,
            quote: activeSel.quote,
            category: t.category,
            entity_id: t.entity_id,
            note: t.note,
            orphaned: false,
          };
          void runOp({ PutTag: updated }, `Reattached ${t.entity_name} to “${activeSel.quote}”`);
        });
        actions.append(reattachBtn);
      }
      const delBtn = el("button", { type: "button", className: "tags-delete" }, "Delete");
      delBtn.setAttribute("aria-label", `Delete tag ${t.entity_name} on ${t.quote}`);
      delBtn.addEventListener("click", () => {
        void runOp({ DeleteTag: t.id }, `Deleted tag “${t.quote}” (Undo brings it back)`);
      });
      actions.append(delBtn);

      li.append(rowTop, actions);
      tagList.append(li);
    }
    left.append(tagList);

    // Suggested tags from bible names and aliases in action text.
    const filteredSuggestions = st.suggestions.filter((s) => {
      if (catFilter !== "all" && s.category !== catFilter) return false;
      if (scopeFilter === "document" && curDoc && s.document_id !== curDoc) return false;
      if (query) {
        const hay = `${s.entity_name} ${s.quote} ${catLabel(s.category)}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    right.append(
      el("h3", {}, `Suggested from the Bible (${filteredSuggestions.length})`),
      el(
        "p",
        { className: "form-note" },
        "Whole-word matches of bible entries and their aliases in action lines. Suggestions are never applied automatically.",
      ),
    );
    const sugList = el("ul", { className: "bible-list tags-suggestions", id: "tags-suggestions" });
    sugList.setAttribute("aria-label", "Suggested breakdown tags");
    if (!filteredSuggestions.length) {
      sugList.append(el("li", { className: "form-note" }, "No untagged suggestions."));
    }
    for (const s of filteredSuggestions) {
      const li = el("li", { className: "tags-suggestion-item" });
      li.dataset.quote = s.quote;
      li.dataset.entityId = s.entity_id;
      const place = s.scene_id ? st.places[s.scene_id] : undefined;
      const whereText = place ? `${place.document_title} · ${place.heading}` : "Action line";
      const label = el(
        "span",
        { className: "tags-item-main" },
        el("span", { className: "tags-badge" }, catLabel(s.category)),
        ` ${s.entity_name} — “${s.quote}” `,
        el("span", { className: "bible-meta" }, `(${whereText})`),
      );
      const acceptBtn = el("button", { type: "button", className: "tags-accept" }, "Accept");
      acceptBtn.setAttribute("aria-label", `Accept suggested tag ${s.entity_name} for ${s.quote}`);
      acceptBtn.addEventListener("click", () => {
        const tag: Tag = {
          id: hooks.newId(),
          document_id: s.document_id,
          block_id: s.block_id,
          start: s.start,
          end: s.end,
          quote: s.quote,
          category: s.category,
          entity_id: s.entity_id,
          note: "",
          orphaned: false,
        };
        void runOp({ PutTag: tag }, `Accepted tag “${s.quote}” (${s.entity_name})`);
      });
      const rejectBtn = el("button", { type: "button", className: "tags-reject" }, "Reject");
      rejectBtn.setAttribute("aria-label", `Reject suggested tag ${s.entity_name} for ${s.quote}`);
      rejectBtn.addEventListener("click", () => {
        const kind = `tag:${s.category}`;
        const name = `${s.entity_id}:${s.block_id}:${s.quote.trim()}`.toUpperCase();
        void runOp({ Reject: { kind, name, on: true } }, `Rejected suggestion “${s.quote}”`);
      });
      li.append(label, el("div", { className: "tags-item-actions" }, acceptBtn, rejectBtn));
      sugList.append(li);
    }
    right.append(sugList);
  }

  filterCat.addEventListener("change", drawLists);
  filterScope.addEventListener("change", drawLists);
  searchInput.addEventListener("input", drawLists);

  newCatBtn.addEventListener("click", async () => {
    const label = newCatInput.value.trim();
    if (!label) return say("Type a category name first.");
    try {
      const [key, cleanLabel] = await hooks.addCategory(label);
      newCatInput.value = "";
      await reload();
      filterCat.value = key;
      drawSelectionBox();
      drawLists();
      say(`Category “${cleanLabel}” ready.`);
    } catch (e) {
      say(`Could not add category: ${e}`);
    }
  });

  undoBtn.addEventListener("click", async () => {
    if (!steps) return;
    if (await hooks.undo()) {
      steps--;
      undoBtn.disabled = steps === 0;
      say("Undone");
      await reload();
    }
  });

  dialog.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (steps > 0) {
        e.preventDefault();
        undoBtn.click();
      }
    }
  });

  closeBtn.addEventListener("click", () => dialog.close());

  return {
    async open() {
      steps = 0;
      undoBtn.disabled = true;
      status.textContent = "";
      activeSel = hooks.selection();
      await reload();
      if (!dialog.open) dialog.showModal();
      const firstInput =
        (selPanel.querySelector("#tags-create-category") as HTMLElement | null) ?? filterCat;
      firstInput.focus();
    },
    close: () => dialog.close(),
    reload,
    get data() {
      return st;
    },
  };
}
