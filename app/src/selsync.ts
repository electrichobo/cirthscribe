// Keyboard commands must act on the caret the user sees.
//
// Chromium (WebView2) reports native caret moves (End, Home, arrows) through
// an asynchronous "selectionchange" event, and ProseMirror adopts the DOM
// selection only when that event runs. When the main thread is busy (for
// example right after a document opens) the event can arrive tens of
// milliseconds late, so a key pressed in between (End then Enter) ran against
// the old selection and split the block at the wrong place.
//
// Before any key is handled, read the DOM selection and, if it differs from
// the editor's, adopt it first. Uses only public ProseMirror API.

import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const selSync = { enabled: true, adopted: 0 };

export function adoptDomSelection(view: EditorView): boolean {
  if (!selSync.enabled || view.composing) return false;
  const cur = view.state.selection;
  if (!(cur instanceof TextSelection)) return false;
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return false;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return false;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    head = view.posAtDOM(sel.focusNode, sel.focusOffset);
  } catch {
    return false; // e.g. inside a widget decoration
  }
  if (anchor === cur.anchor && head === cur.head) return false;
  const doc = view.state.doc;
  if (anchor < 0 || head < 0 || anchor > doc.content.size || head > doc.content.size) return false;
  const $a = doc.resolve(anchor);
  const $h = doc.resolve(head);
  if (!$a.parent.inlineContent || !$h.parent.inlineContent) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.between($a, $h)).setMeta("addToHistory", false));
  selSync.adopted++;
  return true;
}
