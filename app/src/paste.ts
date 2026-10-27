// Plain-text clipboard handling.
//
// Paste: a single line is inserted as inline text. Several lines are parsed
// into typed blocks with simple screenplay heuristics (documented, not
// guessed silently): blank lines separate paragraphs; INT./EXT./EST./I/E
// starts a heading; an all-caps line followed directly by text is a
// character cue; "(...)" inside a speech is a parenthetical; following lines
// are dialogue; all-caps ending in "TO:" is a transition; everything else is
// action. Lines inside one action paragraph are joined with a space, because
// blocks do not contain line breaks.
//
// Copy: blocks are written as plain text separated by blank lines, with cues,
// headings and transitions in capitals (as they print).

import { DOMParser as PMDOMParser, Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { schema, type Kind } from "./schema";

const HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const isCaps = (s: string) => /\p{L}/u.test(s) && s === s.toUpperCase();

export function parsePlainText(text: string): { kind: Kind; text: string }[] {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const out: { kind: Kind; text: string }[] = [];
  for (const para of paras) {
    const lines = para.split("\n").map((l) => l.trim()).filter((l) => l.length);
    if (!lines.length) continue;
    const first = lines[0];
    if (HEADING.test(first) && lines.length === 1) {
      out.push({ kind: "heading", text: first });
    } else if (isCaps(first) && /TO:$/.test(first) && lines.length === 1) {
      out.push({ kind: "transition", text: first });
    } else if (isCaps(first) && lines.length > 1 && !HEADING.test(first)) {
      out.push({ kind: "character", text: first });
      let dialogue: string[] = [];
      const flush = () => {
        if (dialogue.length) out.push({ kind: "dialogue", text: dialogue.join(" ") });
        dialogue = [];
      };
      for (const l of lines.slice(1)) {
        if (/^\(.*\)$/.test(l)) {
          flush();
          out.push({ kind: "parenthetical", text: l });
        } else dialogue.push(l);
      }
      flush();
    } else {
      out.push({ kind: "action", text: lines.join(" ") });
    }
  }
  return out;
}

export function clipboardTextParser(text: string): Slice {
  const trimmed = text.replace(/\r\n?/g, "\n");
  if (!trimmed.includes("\n")) {
    return new Slice(trimmed ? Fragment.from(schema.text(trimmed)) : Fragment.empty, 0, 0);
  }
  const blocks = parsePlainText(trimmed).map((b) => schema.nodes.block.create({ kind: b.kind }, b.text ? schema.text(b.text) : null));
  if (!blocks.length) return Slice.empty;
  // Closed slice: pasted paragraphs keep their own types instead of merging
  // into the block at the cursor.
  return new Slice(Fragment.from(blocks), 0, 0);
}

/**
 * Insert typed blocks as whole blocks (ProseMirror's default fitting would
 * merge the first one into the block at the cursor). Rules: the selection is
 * deleted first; an empty current block is replaced; at the end of a block
 * the new blocks go after it; at the start, before it; in the middle, the
 * block is split and they go between the halves. One transaction, one undo.
 */
export function insertBlocks(view: EditorView, nodes: PMNode[]): boolean {
  if (!nodes.length) return false;
  const tr = view.state.tr.deleteSelection();
  const $pos = tr.selection.$from;
  const parent = $pos.parent;
  if (parent.type.name !== "block") return false;
  const start = $pos.before();
  const end = $pos.after();
  let at: number;
  if (parent.content.size === 0) {
    tr.replaceWith(start, end, nodes);
    at = start;
  } else if ($pos.parentOffset === parent.content.size) {
    tr.insert(end, nodes);
    at = end;
  } else if ($pos.parentOffset === 0) {
    tr.insert(start, nodes);
    at = start;
  } else {
    tr.split($pos.pos, 1, [{ type: schema.nodes.block, attrs: { ...parent.attrs, id: null, sceneId: null } }]);
    at = $pos.pos + 1;
    tr.insert(at, nodes);
  }
  const size = nodes.reduce((s, n) => s + n.nodeSize, 0);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + size - 1), -1));
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
  return true;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Bold, italic and underline from another app's HTML, laid onto the typed
 * blocks parsed from its plain text. Used only when the HTML's paragraphs
 * have the same text as those blocks, one for one; otherwise null (types
 * matter more than styling, so the plain-text result wins).
 */
function styledFrom(html: string, typed: { kind: Kind; text: string }[]): PMNode[] | null {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const paras: PMNode[] = [];
  PMDOMParser.fromSchema(schema).parse(dom.body).forEach((n) => {
    if (squash(n.textContent)) paras.push(n);
  });
  if (paras.length !== typed.length || paras.some((p, i) => squash(p.textContent) !== squash(typed[i].text))) return null;
  return paras.map((p, i) => schema.nodes.block.create({ kind: typed[i].kind }, p.content));
}

/**
 * handlePaste prop. Our own copies (HTML with block types) keep everything
 * (see below). Multi-line text from anywhere
 * else becomes typed blocks by the plain-text rules above, including rich
 * text from TextEdit, Word or a browser (WebKit offers RTF as HTML too),
 * keeping its inline styles when the paragraphs line up.
 */
export function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const html = data.getData("text/html");
  if (html.includes("data-kind")) {
    // Our own copy. Part of one block pastes inline (ProseMirror). Two or more
    // blocks go in as whole blocks with their types, like plain text, so the
    // first one is not merged into the block at the cursor (a cue pasted into
    // an empty action line stays a cue). The ids plugin keeps ids unique.
    const nodes: PMNode[] = [];
    PMDOMParser.fromSchema(schema)
      .parse(new DOMParser().parseFromString(html, "text/html").body, { preserveWhitespace: true })
      .forEach((n) => nodes.push(n));
    return nodes.length >= 2 && insertBlocks(view, nodes);
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  if (!text.includes("\n")) return false;
  const typed = parsePlainText(text);
  const nodes = (html && styledFrom(html, typed)) || typed.map((b) => schema.nodes.block.create({ kind: b.kind }, b.text ? schema.text(b.text) : null));
  return insertBlocks(view, nodes);
}

const PRINT_CAPS =new Set(["heading", "character", "transition", "shot"]);

export function clipboardTextSerializer(slice: Slice): string {
  const parts: string[] = [];
  slice.content.forEach((n: PMNode) => {
    if (n.isText) parts.push(n.text ?? "");
    else parts.push(PRINT_CAPS.has(n.attrs.kind) ? n.textContent.toUpperCase() : n.textContent);
  });
  return parts.join("\n\n");
}
