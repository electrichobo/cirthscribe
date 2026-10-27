// How the side panels make room for the script page (owner, 2026-10-27):
// - "normal": scene list 260 px and board 320 px beside the script;
// - "compact": both narrower (200 / 260 px) when that is what lets the page fit;
// - "overlay": still too narrow, so the panels leave the layout and float
//   over the script instead of squeezing it. The island's scene-list and
//   board buttons open them; Escape, going back to the script, or the same
//   button closes them.
// The page width is the screenplay page (8.5 in) times the editor zoom. Which
// panels are shown at all is still the stored preference (View menu);
// floating open/closed is temporary and never stored.

import { currentPrefs, onPanelsChanged, announce } from "./a11y";

export type LayoutMode = "normal" | "compact" | "overlay";
type Side = "nav" | "board";

const WIDTHS = { normal: { nav: 260, board: 320 }, compact: { nav: 200, board: 260 } };
const PAGE_PX = 8.5 * 96;
const SLACK = 24; // scrollbar and breathing room

export function createLayoutMode(opts: { zoom: () => number; panes: HTMLElement; panels: Record<Side, HTMLElement>; onChange: () => void; focusScript: () => void }) {
  let mode: LayoutMode = "normal";
  const floating: Record<Side, boolean> = { nav: false, board: false };

  function compute(): LayoutMode {
    const p = currentPrefs().panels;
    if (!p.nav && !p.board) return "normal";
    const need = PAGE_PX * opts.zoom() + SLACK;
    const width = opts.panes.clientWidth || window.innerWidth;
    const room = (w: { nav: number; board: number }) => width - (p.nav ? w.nav : 0) - (p.board ? w.board : 0);
    if (room(WIDTHS.normal) >= need) return "normal";
    if (room(WIDTHS.compact) >= need) return "compact";
    return "overlay";
  }

  function apply() {
    const next = compute();
    if (next !== mode) {
      mode = next;
      if (mode !== "overlay") floating.nav = floating.board = false;
    }
    document.body.dataset.layout = mode;
    for (const side of ["nav", "board"] as Side[]) document.body.toggleAttribute(`data-float-${side}`, mode === "overlay" && floating[side]);
    opts.onChange();
  }

  /** Overlay mode: open or close one floating panel (the other closes). */
  function toggleFloat(side: Side) {
    const open = !floating[side];
    floating.nav = floating.board = false;
    floating[side] = open;
    apply();
    if (open) {
      const first = opts.panels[side].querySelector<HTMLElement>('[tabindex="0"], button, textarea, input');
      first?.focus();
    }
    announce(`${side === "nav" ? "Scene list" : "Board"} ${open ? "open over the script" : "closed"}`);
  }

  function closeFloats() {
    if (!floating.nav && !floating.board) return;
    floating.nav = floating.board = false;
    apply();
  }

  window.addEventListener("resize", apply);
  onPanelsChanged(apply);
  // Going back to the script (click or focus) closes a floating panel; so
  // does Escape inside one.
  for (const side of ["nav", "board"] as Side[]) {
    opts.panels[side].addEventListener("keydown", (e) => {
      if (mode !== "overlay" || !floating[side] || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeFloats();
        opts.focusScript();
      } else if (e.key === "Tab") {
        // Tab cycles inside the floating panel: leaving by Tab would drop
        // focus into the script, where Tab changes the block type (macOS
        // check N19). Escape is the way out.
        e.preventDefault();
        const stops = [...opts.panels[side].querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]")].filter(
          (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
        );
        if (!stops.length) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        stops[(at + (e.shiftKey ? stops.length - 1 : 1) + stops.length) % stops.length].focus();
      }
    });
  }
  opts.panes.addEventListener("focusin", (e) => {
    if (mode === "overlay" && !opts.panels.nav.contains(e.target as Node) && !opts.panels.board.contains(e.target as Node)) closeFloats();
  });
  apply();

  return {
    get mode() {
      return mode;
    },
    isFloating: (side: Side) => mode === "overlay" && floating[side],
    toggleFloat,
    closeFloats,
    apply,
  };
}
