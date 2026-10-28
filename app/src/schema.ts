// Editor schema: one textblock node type with a `kind` attribute. Changing a
// block's type changes the attribute, so identity (attrs.id) survives.

import { Schema, type Node as PMNode, type Mark } from "prosemirror-model";

export const KINDS = [
  "heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
  "section",
  "lyric",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  heading: "Scene heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  shot: "Shot",
  section: "Section",
  lyric: "Lyric",
};

const isKind = (k: string | null): k is Kind => !!k && (KINDS as readonly string[]).includes(k);

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    block: {
      content: "text*",
      marks: "_",
      group: "block",
      attrs: {
        id: { default: null },
        kind: { default: "action" },
        sceneId: { default: null },
        dual: { default: false },
        breakBefore: { default: false },
      },
      parseDOM: [
        {
          tag: "p[data-kind]",
          getAttrs: (el) => {
            const e = el as HTMLElement;
            const kind = e.getAttribute("data-kind");
            return {
              id: e.getAttribute("data-id"),
              kind: isKind(kind) ? kind : "action",
              sceneId: e.getAttribute("data-scene-id"),
              dual: e.hasAttribute("data-dual"),
              breakBefore: e.hasAttribute("data-break"),
            };
          },
        },
        // Anything else from outside (Word, browsers, Docs) arrives as action.
        { tag: "p", attrs: { kind: "action" } },
        { tag: "h1,h2,h3,h4,h5,h6,li,blockquote,pre", attrs: { kind: "action" } },
      ],
      toDOM: (node) => {
        const a = node.attrs;
        const attrs: Record<string, string> = { "data-kind": a.kind, class: `b b-${a.kind}` };
        if (a.id) attrs["data-id"] = a.id;
        if (a.sceneId) attrs["data-scene-id"] = a.sceneId;
        if (a.dual) attrs["data-dual"] = "";
        if (a.breakBefore) attrs["data-break"] = "";
        return ["p", attrs, 0];
      },
    },
    text: {},
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }, { style: "font-weight=700" }],
      toDOM: () => ["strong", 0],
    },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }], toDOM: () => ["u", 0] },
    // Writer's markup, on screen only (owner decision 2026-10-27): never
    // printed or exported. Values are palette names (TEXT_COLORS,
    // HIGHLIGHTS); colours from other apps' pasted HTML are not taken over.
    color: {
      attrs: { value: {} },
      parseDOM: [{ tag: "span[data-color]", getAttrs: (el) => ({ value: (el as HTMLElement).dataset.color }) }],
      toDOM: (m) => ["span", { "data-color": m.attrs.value, class: `tc tc-${m.attrs.value}` }, 0],
    },
    highlight: {
      attrs: { value: {} },
      parseDOM: [{ tag: "mark[data-highlight]", getAttrs: (el) => ({ value: (el as HTMLElement).dataset.highlight }) }],
      toDOM: (m) => ["mark", { "data-highlight": m.attrs.value, class: `hl hl-${m.attrs.value}` }, 0],
    },
    // Text added or changed in a revision set (revisions.ts), by set id.
    // Not inclusive: typing next to revised text outside revision mode is
    // not revised. No parseDOM: pasted text is only revised if revision
    // mode tags it.
    revision: {
      attrs: { set: {} },
      inclusive: false,
      toDOM: (m) => ["span", { "data-rev": m.attrs.set, class: "rev" }, 0],
    },
  },
});

/** Palette for the on-screen markup marks (names are stored; colours come from the theme). */
export const TEXT_COLORS = ["red", "orange", "green", "blue", "purple"] as const;
export const HIGHLIGHTS = ["yellow", "green", "blue", "pink", "orange"] as const;

// Domain types mirrored from cirth-core (serde field names).
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  highlight?: string;
  /** Revision set id (revisions.ts). */
  revision?: string;
}
export interface Block {
  id: string;
  kind: Kind;
  runs: Run[];
  scene_id?: string | null;
  dual?: boolean;
  break_before?: boolean;
}
export interface Beat {
  id: string;
  /** One authored line; cards show it above the summary. */
  logline: string;
  summary: string;
  scene_id: string | null;
  pos: number;
}

const has = (marks: readonly Mark[], name: string) => marks.some((m) => m.type.name === name);

export function nodeToBlock(n: PMNode): Block {
  const runs: Run[] = [];
  n.forEach((t) => {
    const r: Run = { text: t.text ?? "" };
    if (has(t.marks, "strong")) r.bold = true;
    if (has(t.marks, "em")) r.italic = true;
    if (has(t.marks, "underline")) r.underline = true;
    const color = t.marks.find((m) => m.type.name === "color");
    if (color) r.color = color.attrs.value;
    const hl = t.marks.find((m) => m.type.name === "highlight");
    if (hl) r.highlight = hl.attrs.value;
    const rev = t.marks.find((m) => m.type.name === "revision");
    if (rev) r.revision = rev.attrs.set;
    runs.push(r);
  });
  if (runs.length === 0) runs.push({ text: "" });
  const b: Block = { id: n.attrs.id, kind: n.attrs.kind, runs };
  if (n.attrs.kind === "heading") b.scene_id = n.attrs.sceneId;
  if (n.attrs.dual) b.dual = true;
  if (n.attrs.breakBefore) b.break_before = true;
  return b;
}

export function blockToNode(b: Block): PMNode {
  const content = b.runs
    .filter((r) => r.text.length > 0)
    .map((r) => {
      const marks = [];
      if (r.bold) marks.push(schema.marks.strong.create());
      if (r.italic) marks.push(schema.marks.em.create());
      if (r.underline) marks.push(schema.marks.underline.create());
      if (r.color) marks.push(schema.marks.color.create({ value: r.color }));
      if (r.highlight) marks.push(schema.marks.highlight.create({ value: r.highlight }));
      if (r.revision) marks.push(schema.marks.revision.create({ set: r.revision }));
      return schema.text(r.text, marks);
    });
  return schema.nodes.block.create(
    { id: b.id, kind: b.kind, sceneId: b.scene_id ?? null, dual: !!b.dual, breakBefore: !!b.break_before },
    content,
  );
}

export function docFromBlocks(blocks: Block[]): PMNode {
  const nodes = blocks.length ? blocks.map(blockToNode) : [schema.nodes.block.create({ kind: "action" })];
  return schema.nodes.doc.create(null, nodes);
}

export function newId(): string {
  return crypto.randomUUID();
}
