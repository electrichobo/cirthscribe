// Accessibility helpers shared by every view:
// - announce(): one polite live region for things a screen reader should hear
//   (moves, block-type changes, saves that the user asked for, failures). The
//   background save status is deliberately not live, so typing is not
//   interrupted by "Storing… Stored…" on every keystroke.
// - Display preferences: whole-window size (native webview zoom) and high
//   contrast, stored app-wide by the Rust side.
// - Panel cycling with F6 / Shift+F6 between the regions of the current view.
// - Focus keys, so re-rendered lists put focus back on the same item.

import { invoke } from "@tauri-apps/api/core";

let region: HTMLElement | null = null;
let alertRegion: HTMLElement | null = null;

function live(kind: "polite" | "assertive"): HTMLElement {
  const r = document.createElement("div");
  r.className = "sr-only";
  r.id = kind === "polite" ? "announce" : "announce-alert";
  r.setAttribute("aria-live", kind);
  r.setAttribute("aria-atomic", "true");
  document.body.append(r);
  return r;
}

/** Create the live regions up front: screen readers can miss the first
 *  message of a region that appears at the same moment. */
export function installLiveRegions() {
  region ??= live("polite");
  alertRegion ??= live("assertive");
}

/** Say something to screen readers (and keep it readable for tests). */
export function announce(msg: string, urgent = false) {
  installLiveRegions();
  const r = urgent ? alertRegion! : region!;
  // Clearing first makes a repeated message be read again.
  r.textContent = "";
  window.setTimeout(() => (r.textContent = msg), 30);
}

export type Panel = "nav" | "board" | "toolbar" | "status";
export const PANEL_LABEL: Record<Panel, string> = { nav: "Scene list", board: "Board", toolbar: "Toolbar", status: "Status bar" };

// Toolbar controls return focus to the script after a mouse action, but keep
// it after a keyboard action (in the script Tab changes the block type, so a
// keyboard user must not be dropped there: macOS check N18).
let lastPointer = -1e9;
for (const t of ["pointerdown", "mousedown"]) document.addEventListener(t, () => (lastPointer = performance.now()), true);
export const usedPointer = () => performance.now() - lastPointer < 1500;

export interface UiPrefs {
  scale: number;
  contrast: "system" | "high";
  /** Panels of the script view; hidden ones take no space. */
  panels: Record<Panel, boolean>;
  /** Typewriter mode: the typing line stays centred (view only). */
  typewriter: boolean;
  /** Script font and size on screen only; pages and exports keep Courier Prime 12 pt. */
  editor_font: ScreenFont;
  editor_size: number;
}

export type ScreenFont = "courier-prime" | "mono" | "serif" | "sans";
export const SCREEN_FONTS: Record<ScreenFont, { label: string; stack: string }> = {
  "courier-prime": { label: "Courier Prime (standard)", stack: '"Courier Prime", monospace' },
  mono: { label: "System monospace", stack: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace' },
  serif: { label: "Serif", stack: 'Georgia, "Times New Roman", "DejaVu Serif", serif' },
  sans: { label: "Sans serif", stack: 'system-ui, "Segoe UI", Helvetica, Arial, "DejaVu Sans", sans-serif' },
};

let prefs: UiPrefs = { scale: 1, contrast: "system", panels: { nav: true, board: true, toolbar: true, status: true }, typewriter: false, editor_font: "courier-prime", editor_size: 12 };
const panelListeners: (() => void)[] = [];

function applyPrefs() {
  if (prefs.contrast === "high") document.documentElement.dataset.contrast = "high";
  else delete document.documentElement.dataset.contrast;
  for (const [k, on] of Object.entries(prefs.panels)) document.body.toggleAttribute(`data-hide-${k}`, !on);
  document.body.toggleAttribute("data-typewriter", prefs.typewriter);
  const root = document.documentElement.style;
  root.setProperty("--script-font", (SCREEN_FONTS[prefs.editor_font] ?? SCREEN_FONTS["courier-prime"]).stack);
  root.setProperty("--script-size", `${prefs.editor_size}pt`);
  panelListeners.forEach((f) => f());
}

/** Called after panel visibility changes (the toolbar's View menu redraws). */
export function onPanelsChanged(f: () => void) {
  panelListeners.push(f);
}

export async function setScreenFont(font: ScreenFont) {
  const next = await setPrefs({ editor_font: font });
  announce(`Screen font: ${SCREEN_FONTS[next.editor_font].label}. Pages and exports are unchanged.`);
}

/** Screen text size in points (10 to 20, screen only); a function of the current size, or a number. */
export async function setScreenSize(pt: number | ((cur: number) => number)) {
  const next = await setPrefs((cur) => ({ editor_size: Math.min(20, Math.max(10, typeof pt === "function" ? pt(cur.editor_size) : pt)) }));
  announce(`Screen text size ${next.editor_size} points`);
}

/** +1 / -1 point, or 0 for the standard 12 pt. */
export const stepScreenSize = (dir: 1 | -1 | 0) => setScreenSize((cur) => (dir === 0 ? 12 : cur + dir));

export async function toggleTypewriter() {
  const next = await setPrefs((cur) => ({ typewriter: !cur.typewriter }));
  announce(next.typewriter ? "Typewriter mode on: the typing line stays centred" : "Typewriter mode off");
}

export async function togglePanel(p: Panel) {
  const next = await setPrefs((cur) => ({ panels: { ...cur.panels, [p]: !cur.panels[p] } }));
  announce(`${PANEL_LABEL[p]} ${next.panels[p] ? "shown" : "hidden"}`);
}

export async function loadPrefs(): Promise<UiPrefs> {
  try {
    prefs = await invoke<UiPrefs>("ui_prefs");
  } catch {
    // Defaults are fine; the window still works at 100%.
  }
  applyPrefs();
  return prefs;
}

// Changes run one at a time, each from the result of the last, so quick
// repeated presses (Ctrl+= Ctrl+=) all count.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function setPrefs(change: Partial<UiPrefs> | ((p: UiPrefs) => Partial<UiPrefs>)): Promise<UiPrefs> {
  return serial(async () => {
    const c = typeof change === "function" ? change(prefs) : change;
    prefs = await invoke<UiPrefs>("set_ui_prefs", { prefs: { ...prefs, ...c } });
    applyPrefs();
    return prefs;
  });
}

export const currentPrefs = () => prefs;

export async function stepScale(dir: 1 | -1 | 0) {
  const p = await setPrefs((cur) => ({ scale: dir === 0 ? 1 : Math.round((cur.scale + dir * 0.1) * 10) / 10 }));
  announce(`Interface size ${Math.round(p.scale * 100)} percent`);
}

export async function toggleContrast() {
  const p = await setPrefs((cur) => ({ contrast: cur.contrast === "high" ? "system" : "high" }));
  announce(p.contrast === "high" ? "High contrast on" : "High contrast off; following the system setting");
}

/** Focus the first focusable thing in a region (or the region itself). */
export function focusRegion(r: HTMLElement): boolean {
  if (r.hidden || r.offsetParent === null) return false;
  const shown = (e: HTMLElement | null) => !!e && e.getClientRects().length > 0;
  const first = (sel: string) => [...r.querySelectorAll<HTMLElement>(sel)].find(shown) ?? null;
  // The chosen list item, then the editor, then the first visible control.
  const pick = first('[tabindex="0"][data-roving]') ?? first(".ProseMirror") ?? first('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
  (pick ?? r).focus();
  return true;
}

/** F6 / Shift+F6: move between the visible regions, in order, wrapping. */
export function cycleRegions(regions: HTMLElement[], back: boolean) {
  const visible = regions.filter((r) => !r.hidden && r.offsetParent !== null);
  if (!visible.length) return;
  const at = visible.findIndex((r) => r.contains(document.activeElement));
  const n = visible.length;
  for (let step = 1; step <= n; step++) {
    const next = visible[(((at < 0 ? (back ? 0 : -1) : at) + (back ? -step : step)) % n + n) % n];
    if (focusRegion(next)) {
      announce(next.getAttribute("aria-label") ?? "");
      return;
    }
  }
}

/** A stable description of the focused control inside `root`, if any. */
export function focusKey(root: HTMLElement): string | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) return null;
  const item = a.closest<HTMLElement>("[data-item]");
  return item ? `${item.dataset.item}|${a.dataset.part ?? ""}` : null;
}

export function restoreFocus(root: HTMLElement, key: string | null) {
  if (!key) return;
  const [item, part] = key.split("|");
  const holder = root.querySelector<HTMLElement>(`[data-item="${CSS.escape(item)}"]`);
  const target = part ? holder?.querySelector<HTMLElement>(`[data-part="${CSS.escape(part)}"]`) : holder;
  (target ?? holder)?.focus();
}
