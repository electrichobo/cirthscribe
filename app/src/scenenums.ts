// Locked scene numbers in the editor: the number in both margins of each
// numbered heading, and omitted scenes marked and dimmed. Numbers come from
// Rust with each pagination (cirth_core::numbering); the editor never
// computes or stores them. Unlocked scripts show none.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export interface SceneNumber {
  scene_id: string;
  number: string;
  omitted: boolean;
}

export const sceneNumbersKey = new PluginKey<DecorationSet>("cirth-scene-numbers");

function badge(text: string, side: "left" | "right"): HTMLElement {
  const el = document.createElement("span");
  el.className = `scene-num scene-num-${side}`;
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  return el;
}

export function buildSceneNumberDecorations(doc: PMNode, numbers: Map<string, SceneNumber>): DecorationSet {
  if (!numbers.size) return DecorationSet.empty;
  const decos: Decoration[] = [];
  let omitted = false;
  doc.forEach((node, pos) => {
    if (node.attrs.kind === "heading") {
      const n = node.attrs.sceneId ? numbers.get(node.attrs.sceneId) : undefined;
      omitted = !!n?.omitted;
      if (n) {
        decos.push(Decoration.widget(pos + 1, () => badge(n.number, "left"), { side: -1, key: `l${n.scene_id}${n.number}` }));
        decos.push(Decoration.widget(pos + 1, () => badge(n.number, "right"), { side: -1, key: `r${n.scene_id}${n.number}` }));
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: n.omitted ? "numbered omitted-heading" : "numbered", "data-scene-number": n.number }));
      }
    } else if (omitted) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "in-omitted-scene" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export function sceneNumbersPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: sceneNumbersKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(sceneNumbersKey) as DecorationSet | undefined;
        return next ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => sceneNumbersKey.getState(state) },
  });
}
