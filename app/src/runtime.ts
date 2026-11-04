// The runtime rail (View > Runtime Estimate): a thin strip along the right of
// the script showing the script's estimated running time and where the caret
// is in it, at the usual rule of thumb of one page per minute. It is an
// estimate and says so. Pages come from the core's page map; the web view
// never measures them. Clicking the rail goes to that point in the script.

import type { EditorView } from "prosemirror-view";
import type { PageStart } from "./pagemarks";
import { announce } from "./a11y";

const scalarToUtf16 = (s: string, n: number) => {
  let u = 0;
  for (const ch of s) {
    if (n-- <= 0) break;
    u += ch.length;
  }
  return u;
};

export function createRuntimeRail(hooks: { view: () => EditorView | null; starts: () => PageStart[]; open: () => boolean }) {
  const rail = document.createElement("div");
  rail.id = "runtime-rail";
  rail.className = "runtime-rail";
  rail.setAttribute("role", "group");
  rail.setAttribute("aria-label", "Estimated running time");
  const track = document.createElement("div");
  track.className = "runtime-track";
  const fill = document.createElement("div");
  fill.className = "runtime-fill";
  const marker = document.createElement("div");
  marker.className = "runtime-marker";
  const ticks = document.createElement("div");
  ticks.className = "runtime-ticks";
  const label = document.createElement("div");
  label.className = "runtime-label";
  label.id = "runtime-label";
  track.append(fill, ticks, marker);
  rail.append(label, track);

  let positions: number[] = []; // document position where each page starts
  let current = 0;

  /** Page starts as editor positions (after each pagination). */
  function locate() {
    const view = hooks.view();
    const starts = hooks.starts();
    positions = [];
    if (!view || !starts.length) return;
    const at = new Map<string, { pos: number; text: string }>();
    view.state.doc.forEach((n, pos) => at.set(n.attrs.id, { pos, text: n.textContent }));
    for (const s of starts) {
      const b = at.get(s.block_id);
      positions.push(b ? b.pos + 1 + scalarToUtf16(b.text, s.offset) : positions.at(-1) ?? 0);
    }
  }

  function draw() {
    const pages = positions.length;
    rail.hidden = !hooks.open() || pages === 0;
    if (rail.hidden) return;
    const view = hooks.view();
    const caret = view?.state.selection.from ?? 0;
    let page = 0;
    while (page + 1 < pages && positions[page + 1] <= caret) page++;
    current = page;
    // Minutes are pages (an estimate); the caret is placed within its page by position.
    const next = page + 1 < pages ? positions[page + 1] : (view?.state.doc.content.size ?? caret);
    const within = next > positions[page] ? Math.min(1, (caret - positions[page]) / (next - positions[page])) : 0;
    const total = pages;
    const at = page + within;
    const pct = (100 * at) / total;
    fill.style.height = `${pct}%`;
    marker.style.top = `${pct}%`;
    label.textContent = `≈${Math.round(at)}′`;
    const text = `About ${Math.max(1, Math.round(at))} of ${total} minutes (estimate, one page a minute)`;
    rail.title = text;
    marker.setAttribute("aria-label", text);
    // Ticks every 10 minutes (every 5 for short scripts).
    const step = total > 40 ? 10 : 5;
    ticks.replaceChildren(
      ...Array.from({ length: Math.floor(total / step) }, (_, i) => {
        const t = document.createElement("span");
        t.className = "runtime-tick";
        t.style.top = `${(100 * (i + 1) * step) / total}%`;
        t.dataset.min = String((i + 1) * step);
        return t;
      }),
    );
  }

  // Clicking the rail goes to that point (to the start of that page).
  track.addEventListener("click", (e) => {
    const view = hooks.view();
    if (!view || !positions.length) return;
    const r = track.getBoundingClientRect();
    const page = Math.min(positions.length - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * positions.length)));
    const pos = Math.min(positions[page], view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection((view.state.selection.constructor as typeof import("prosemirror-state").Selection).near(view.state.doc.resolve(pos))).scrollIntoView());
    view.focus();
    announce(`Page ${page + 1}, about ${page + 1} minutes in (estimate)`);
  });

  let frame = 0;
  return {
    el: rail,
    /** After pagination: the pages changed. */
    paginated() {
      locate();
      draw();
    },
    /** After the caret moves or text changes (drawn once per frame). */
    moved() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    },
    get page() {
      return current;
    },
  };
}
