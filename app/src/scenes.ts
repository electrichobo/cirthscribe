// Scene structure derived from the editor document (which mirrors the
// canonical store). Nothing here stores script text of its own.

import type { Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

export interface SceneInfo {
  sceneId: string;
  index: number; // display order, not identity
  heading: string;
  from: number; // doc position of the heading block
  to: number; // end of the scene's last block
}

export function scenesOf(doc: PMNode): SceneInfo[] {
  const out: SceneInfo[] = [];
  doc.forEach((n, pos) => {
    const end = pos + n.nodeSize;
    if (n.attrs.kind === "heading" && n.attrs.sceneId) {
      out.push({ sceneId: n.attrs.sceneId, index: out.length + 1, heading: n.textContent, from: pos, to: end });
    } else if (out.length) {
      out[out.length - 1].to = end;
    }
  });
  return out;
}

/**
 * MoveScene: move scene `sceneId` so it sits directly before scene
 * `beforeSceneId` (or at the end when null). One transaction, so one undo.
 * Block nodes move intact, so block and scene ids are unchanged.
 */
/** Put the scenes in `order` (every scene id once) in one transaction: one undo
 *  step restores the old order. Anything before the first scene stays first.
 *  Block and scene ids are kept. */
export function reorderScenes(state: EditorState, order: string[]): Transaction | null {
  const scenes = scenesOf(state.doc);
  if (scenes.length < 2 || order.length !== scenes.length || order.join() === scenes.map((s) => s.sceneId).join()) return null;
  const byId = new Map(scenes.map((s) => [s.sceneId, s]));
  if (!order.every((id) => byId.has(id))) return null;
  const start = scenes[0].from;
  const parts = order.map((id) => state.doc.slice(byId.get(id)!.from, byId.get(id)!.to).content);
  const content = parts.reduce((a, b) => a.append(b));
  return state.tr.replaceWith(start, state.doc.content.size, content).setMeta("cirth-move", "reorder").scrollIntoView();
}

export function moveScene(state: EditorState, sceneId: string, beforeSceneId: string | null): Transaction | null {
  const scenes = scenesOf(state.doc);
  const s = scenes.find((x) => x.sceneId === sceneId);
  if (!s || sceneId === beforeSceneId) return null;
  const target = beforeSceneId ? scenes.find((x) => x.sceneId === beforeSceneId) : null;
  if (beforeSceneId && !target) return null;
  const insertAt = target ? target.from : state.doc.content.size;
  if (insertAt === s.to || insertAt === s.from) return null; // already there
  const slice = state.doc.slice(s.from, s.to);
  const tr = state.tr;
  if (insertAt > s.from) {
    tr.insert(insertAt, slice.content);
    tr.delete(s.from, s.to);
  } else {
    tr.delete(s.from, s.to);
    tr.insert(insertAt, slice.content);
  }
  return tr.setMeta("cirth-move", sceneId).scrollIntoView();
}
