// Page markers in the editor, drawn from the Rust page map. The editor never
// measures pages itself; markers carry the document version they came from
// and are shown as stale until a newer map arrives.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export interface PageStart {
  page: number;
  /** Printed page number: "12", or "12A" / "11-12" when pages are locked. */
  label?: string;
  block_id: string;
  offset: number; // Unicode scalar values
}

export const pageKey = new PluginKey<DecorationSet>("cirth-pages");

/** Unicode scalar offset -> UTF-16 offset within a string. */
export function scalarToUtf16(text: string, scalars: number): number {
  let u = 0;
  let n = 0;
  for (const ch of text) {
    if (n === scalars) break;
    u += ch.length;
    n++;
  }
  return u;
}

function marker(page: string, inline: boolean, stale: boolean): HTMLElement {
  const el = document.createElement(inline ? "span" : "div");
  el.className = `page-mark${inline ? " inline" : ""}${stale ? " stale" : ""}`;
  el.contentEditable = "false";
  el.setAttribute("aria-label", `Page ${page} starts here`);
  el.textContent = inline ? `⟂ p.${page}` : `page ${page}`;
  return el;
}

export function buildDecorations(doc: PMNode, starts: PageStart[], stale: boolean): DecorationSet {
  const byId = new Map<string, { pos: number; node: PMNode }>();
  doc.forEach((node, pos) => byId.set(node.attrs.id, { pos, node }));
  const decos: Decoration[] = [];
  for (const s of starts) {
    if (s.page === 1) continue;
    const hit = byId.get(s.block_id);
    if (!hit) continue;
    if (s.offset === 0) {
      decos.push(Decoration.widget(hit.pos, () => marker(s.label ?? String(s.page), false, stale), { side: -1, key: `p${s.page}-${stale}` }));
    } else {
      const off = scalarToUtf16(hit.node.textContent, s.offset);
      decos.push(Decoration.widget(hit.pos + 1 + off, () => marker(s.label ?? String(s.page), true, stale), { side: -1, key: `pi${s.page}-${stale}` }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export function pageMarksPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pageKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(pageKey) as DecorationSet | undefined;
        return next ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => pageKey.getState(state) },
  });
}
