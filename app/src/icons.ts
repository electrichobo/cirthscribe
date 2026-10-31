// Kolbítar Icon Registry & Vector SVG System
// Drawn on a uniform 24 x 24 grid with 2 px margins (docs/ART_ASSETS.md).
// Uses currentColor and stroke-width="1.8" so icons automatically adopt
// Light, Dark, Midnight, OLED, High Contrast, and Windows Contrast themes.
// When production art arrives, icons can be replaced 1-to-1 in PATHS.

const PATHS: Record<string, string> = {
  // Navigation & Core Actions
  home: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6.5 10v9.5h11V10"/><path d="M10 19.5v-5h4v5"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9h9.5a5.5 5.5 0 0 1 0 11H10"/>',
  redo: '<path d="M15 13.5 19.5 9 15 4.5"/><path d="M19.5 9H10a5.5 5.5 0 0 0 0 11h4"/>',
  save: '<path d="M5 4h11l4 4v12H5z"/><path d="M8 4v5h8V4M8 20v-7h8v7"/>',
  save_as: '<path d="M4 4h10l3 3v4M4 4v16h8"/><path d="M7 4v4h5V4M15 15h6M18 12v6"/>',
  import: '<path d="M4 14v5h16v-5M12 4v11M8 11l4 4 4-4"/>',
  export: '<path d="M4 14v5h16v-5M12 15V4M8 8l4-4 4 4"/>',
  find: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m14.5 14.5 5 5"/>',
  focus: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',

  // Panels & Views
  scenes: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5.5" cy="6.5" r="1"/><circle cx="5.5" cy="12" r="1"/><circle cx="5.5" cy="17.5" r="1"/>',
  board: '<rect x="4" y="4.5" width="7" height="6.5" rx="1"/><rect x="13" y="4.5" width="7" height="6.5" rx="1"/><rect x="4" y="13" width="7" height="6.5" rx="1"/><rect x="13" y="13" width="7" height="6.5" rx="1"/>',
  notes: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  timeline: '<path d="M4 12h16"/><circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="13" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/>',
  bible: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4.5H6.5A2.5 2.5 0 0 0 4 7z"/><path d="M8 8h6M8 11h4"/>',
  storyscry: '<path d="M5 19h14M7 16V9M12 16V5M17 16v-4"/>',
  stripboard: '<rect x="4" y="4" width="16" height="3.5" rx="1"/><rect x="4" y="9.5" width="16" height="3.5" rx="1"/><rect x="4" y="15" width="16" height="3.5" rx="1"/>',
  tags: '<path d="m14 4 6 6-9.5 9.5a2 2 0 0 1-2.8 0L4.5 16.3a2 2 0 0 1 0-2.8z"/><circle cx="16.5" cy="7.5" r="1" fill="currentColor"/>',

  // Formatting & Styling
  bold: '<path d="M6 5h6a3.5 3.5 0 0 1 0 7H6zM6 12h7a3.5 3.5 0 0 1 0 7H6z"/>',
  italic: '<path d="M14 5h5M10 19h5M15 5l-4 14"/>',
  underline: '<path d="M6 4v7a6 6 0 0 0 12 0V4M4 20h16"/>',
  colour: '<path d="M7 16 12 4.5 17 16M8.8 12h6.4"/><path d="M4.5 20h15" class="swatch" stroke-width="3"/>',
  highlight: '<path d="m13.5 5 5.5 5.5-7.5 7.5H6v-5.5z"/><path d="m11 7.5 5.5 5.5"/><path d="M4.5 20.5h15" class="swatch" stroke-width="3"/>',
  font: '<text x="2.5" y="17" font-size="13" font-family="Georgia, serif" fill="currentColor" stroke="none">Aa</text>',
  comment: '<path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M8 9.5h8M8 12.5h5"/>',

  // Revisions & Production
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M6 15a9 9 0 0 1 9-6h1"/>',
  take: '<rect x="4" y="6" width="16" height="13" rx="1.5"/><path d="m4 10 3.5-4h4L8 10h4l3.5-4h3l-3.5 4"/>',
  snapshot: '<path d="M5 7h14v12H5zM8 4h8M12 10v6M9 13h6"/>',
  grammar: '<path d="M4 19.5h16M13.5 5.5l5 5-9 9H5v-4.5z"/>',
  ai: '<path d="m12 3 2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z"/>',
  tour: '<circle cx="12" cy="12" r="8.5"/><path d="m14.5 9.5-2 6-4-1 2-6z"/>',

  // Free Writing & Files
  folder: '<path d="M4 5h5l2 2h9v12H4z"/>',
  folder_new: '<path d="M4 5h5l2 2h9v5M4 5v14h9"/><path d="M18 14v6M15 17h6"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M6 7v13h12V7M10 11v6M14 11v6"/>',
  restore: '<path d="M4.5 9h5V4M5 9a8 8 0 1 1-1 7"/>',
  flow: '<path d="M7 15a4 4 0 1 1 0-8c2.5 0 4.5 3.5 5 5s2.5 5 5 5a4 4 0 1 0 0-8c-2.5 0-4.5 3.5-5 5s-2.5 5-5 5z"/>',

  // Status & Arrows
  arrow_up: '<path d="m6 15 6-6 6 6"/>',
  arrow_down: '<path d="m6 9 6 6 6-6"/>',
  arrow_left: '<path d="m15 6-6 6 6 6"/>',
  arrow_right: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.41 1.41M14 11a4 4 0 0 0-5.66 0L5.51 13.8a4 4 0 0 0 5.66 5.66l1.41-1.41"/>',
  unlink: '<path d="m3 3 18 18M10 13a4 4 0 0 0 5.66 0l1.41-1.41M14 11a4 4 0 0 0-5.66 0L5.51 13.8a4 4 0 0 0 5.66 5.66"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  warning: '<path d="m12 4 8.5 15H3.5z"/><path d="M12 9v5M12 16.5h.01"/>',
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
