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
