// Temporary toolbar icons, drawn for Kolbítar as simple strokes on a
// 24 x 24 grid (docs/ART_ASSETS.md). One colour (currentColor), so they
// follow light, dark and high-contrast themes. The owner's icon set will
// replace these; names match ART_ASSETS.md where one exists.

const PATHS: Record<string, string> = {
  home: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6.5 10v9.5h11V10"/><path d="M10 19.5v-5h4v5"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9h9.5a5.5 5.5 0 0 1 0 11H10"/>',
  redo: '<path d="M15 13.5 19.5 9 15 4.5"/><path d="M19.5 9H10a5.5 5.5 0 0 0 0 11h4"/>',
  scenes: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5.5" cy="6.5" r="1"/><circle cx="5.5" cy="12" r="1"/><circle cx="5.5" cy="17.5" r="1"/>',
  board: '<rect x="4" y="4.5" width="7" height="6.5" rx="1"/><rect x="13" y="4.5" width="7" height="6.5" rx="1"/><rect x="4" y="13" width="7" height="6.5" rx="1"/><rect x="13" y="13" width="7" height="6.5" rx="1"/>',
  find: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m14.5 14.5 5 5"/>',
  focus: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  colour: '<path d="M7 16 12 4.5 17 16M8.8 12h6.4"/><path d="M4.5 20h15" class="swatch" stroke-width="3"/>',
  highlight: '<path d="m13.5 5 5.5 5.5-7.5 7.5H6v-5.5z"/><path d="m11 7.5 5.5 5.5"/><path d="M4.5 20.5h15" class="swatch" stroke-width="3"/>',
  font: '<text x="2.5" y="17" font-size="13" font-family="Georgia, serif" fill="currentColor" stroke="none">Aa</text>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
};

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon", `icon-${name}`);
  svg.innerHTML = PATHS[name] ?? "";
  return svg;
}

/** A native select shown as an icon: the select sits invisibly over the
 *  icon, so it keeps its keyboard behaviour, list and accessible name. The
 *  wrapper's data-value lets CSS colour the icon's swatch bar. */
export function iconSelect(name: string, select: HTMLSelectElement): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = `icon-select icon-select-${name}`;
  wrap.title = select.title;
  wrap.append(icon(name), select);
  const show = () => (wrap.dataset.value = select.value);
  select.addEventListener("change", show);
  show();
  return wrap;
}

/** An icon-only button with a visible tooltip and a name for screen readers. */
export function iconButton(id: string, name: string, label: string, title = label): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.className = "tool";
  b.title = title;
  b.setAttribute("aria-label", label);
  b.append(icon(name));
  return b;
}
