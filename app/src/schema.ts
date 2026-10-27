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
  },
});

// Domain types mirrored from cirth-core (serde field names).
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
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
