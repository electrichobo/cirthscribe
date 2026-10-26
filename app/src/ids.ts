// Keeps block and scene ids unique and present after every transaction.
//
// Rules:
// - A block without an id gets one.
// - When an id appears twice (copy/paste, split), the block that sits where
//   the original was before the transaction keeps it; the others get new ids.
//   If none sits there, the first occurrence keeps it. So the first half of a
//   split keeps the id, and cut + paste keeps it.
// - Headings always carry a sceneId (same duplicate rule); other blocks never do.

import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { newId } from "./schema";

export const idsKey = new PluginKey("cirth-ids");

type Attr = "id" | "sceneId";

function firstPositions(doc: PMNode, attr: Attr): Map<string, number> {
  const m = new Map<string, number>();
  doc.forEach((n, pos) => {
    const v = n.attrs[attr];
    if (v && !m.has(v)) m.set(v, pos);
  });
  return m;
}

/** For each value that occurs more than once, the position that keeps it. */
function keepers(doc: PMNode, attr: Attr, old: Map<string, number>, mapPos: (p: number) => number): Map<string, number> {
  const all = new Map<string, number[]>();
  doc.forEach((n, pos) => {
    const v = n.attrs[attr];
    if (v) all.set(v, [...(all.get(v) ?? []), pos]);
  });
  const out = new Map<string, number>();
  for (const [v, ps] of all) {
    if (ps.length < 2) continue;
    const o = old.get(v);
    const mapped = o === undefined ? undefined : mapPos(o);
    out.set(v, mapped !== undefined && ps.includes(mapped) ? mapped : ps[0]);
  }
  return out;
}

export function idsPlugin(): Plugin {
  return new Plugin({
    key: idsKey,
    appendTransaction(trs: readonly Transaction[], oldState, newState) {
      if (!trs.some((t) => t.docChanged)) return null;
      const mapPos = (p: number) => trs.reduce((acc, t) => t.mapping.map(acc, 1), p);
      const doc = newState.doc;
      const keepId = keepers(doc, "id", firstPositions(oldState.doc, "id"), mapPos);
      const keepScene = keepers(doc, "sceneId", firstPositions(oldState.doc, "sceneId"), mapPos);
      const tr = newState.tr;
      doc.forEach((n, pos) => {
        let { id, sceneId } = n.attrs as { id: string | null; sceneId: string | null };
        let changed = false;
        if (!id || (keepId.has(id) && keepId.get(id) !== pos)) {
          id = newId();
          changed = true;
        }
        if (n.attrs.kind === "heading") {
          if (!sceneId || (keepScene.has(sceneId) && keepScene.get(sceneId) !== pos)) {
            sceneId = newId();
            changed = true;
          }
        } else if (sceneId) {
          sceneId = null;
          changed = true;
        }
        if (changed) tr.setNodeMarkup(pos, undefined, { ...n.attrs, id, sceneId });
      });
      return tr.docChanged ? tr : null;
    },
  });
}
