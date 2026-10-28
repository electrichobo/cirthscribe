// Keyboard shortcuts (M3 W5): one registry of the commands a writer can
// rebind, their default keys, and the keys that stay fixed. One dispatcher
// (main.ts) reads it; Help > Keyboard Shortcuts… edits it. Changes are
// stored per user (preferences: `keys`, only what differs from the default).
//
// A binding is written "Mod+Shift+S": Mod is Ctrl on Windows and Linux and
// Cmd on macOS. Keys are letters (A-Z), digits, F1-F12, Enter, Space or
// punctuation such as . = -.

export const isMac = navigator.platform.toLowerCase().includes("mac");

export type Scope = "app" | "script";
export interface Binding {
  /** The command id (the same id as its menu item). */
  id: string;
  group: string;
  label: string;
  /** The menu item's text without its shortcut (null: not in a menu). */
  menu: string | null;
  /** "script": only while the caret is in the script (formatting). */
  scope: Scope;
  /** Default keys; the first is shown. */
  defaults: string[];
}

const KIND_MENU: [string, string][] = [
  ["heading", "Scene Heading"],
  ["action", "Action"],
  ["character", "Character"],
  ["parenthetical", "Parenthetical"],
  ["dialogue", "Dialogue"],
  ["transition", "Transition"],
  ["shot", "Shot"],
  ["section", "Section"],
  ["lyric", "Lyric"],
];

export const BINDINGS: Binding[] = [
  { id: "open", group: "Project", label: "Open", menu: "Open…", scope: "app", defaults: ["Mod+O"] },
  { id: "save", group: "Project", label: "Save", menu: "Save", scope: "app", defaults: ["Mod+S"] },
  { id: "save_as", group: "Project", label: "Save As", menu: "Save As…", scope: "app", defaults: ["Mod+Shift+S"] },
  { id: "export", group: "Project", label: "Export", menu: "Export…", scope: "app", defaults: ["Mod+E"] },
  { id: "project_tree", group: "Project", label: "Episodes and documents", menu: "Episodes and Documents…", scope: "app", defaults: ["Mod+Shift+O"] },
  { id: "find", group: "Writing", label: "Find and replace", menu: "Find and Replace…", scope: "app", defaults: ["Mod+F"] },
  { id: "spell_suggest", group: "Writing", label: "Spelling suggestions", menu: "Suggestions", scope: "app", defaults: ["Mod+."] },
  { id: "bold", group: "Writing", label: "Bold", menu: "Bold", scope: "script", defaults: ["Mod+B"] },
  { id: "italic", group: "Writing", label: "Italic", menu: "Italic", scope: "script", defaults: ["Mod+I"] },
  { id: "underline", group: "Writing", label: "Underline", menu: "Underline", scope: "script", defaults: ["Mod+U"] },
  { id: "dual", group: "Writing", label: "Dual dialogue", menu: "Dual Dialogue", scope: "script", defaults: ["Mod+D"] },
  { id: "page_break", group: "Writing", label: "Page break before", menu: "Page Break Before", scope: "script", defaults: ["Mod+Enter"] },
  ...KIND_MENU.map(([k, name], i): Binding => ({ id: `kind_${k}`, group: "Elements", label: name, menu: name, scope: "script", defaults: [`Mod+${i + 1}`] })),
  { id: "goto_page", group: "Moving around", label: "Go to page", menu: "Page…", scope: "app", defaults: ["Mod+G"] },
  { id: "goto_scene", group: "Moving around", label: "Go to scene", menu: "Scene…", scope: "app", defaults: ["Mod+Shift+G"] },
  { id: "focus_mode", group: "View", label: "Focus mode", menu: "Focus Mode", scope: "app", defaults: ["Mod+Shift+F"] },
  { id: "view_typewriter", group: "View", label: "Typewriter mode", menu: "Typewriter Mode", scope: "app", defaults: ["Mod+Shift+T"] },
  { id: "full_screen", group: "View", label: "Full screen", menu: "Full Screen", scope: "app", defaults: ["F11"] },
  { id: "ui_larger", group: "View", label: "Larger interface", menu: "Larger Interface", scope: "app", defaults: ["Mod+=", "Mod+Shift+="] },
  { id: "ui_smaller", group: "View", label: "Smaller interface", menu: "Smaller Interface", scope: "app", defaults: ["Mod+-"] },
  { id: "ui_reset", group: "View", label: "Actual size", menu: "Actual Size", scope: "app", defaults: ["Mod+0"] },
];

/** Keys that cannot be rebound: OS and editing conventions, and the keyboard-only routes. */
export const FIXED: [string, string][] = [
  ["Undo, redo", "Mod+Z, Mod+Shift+Z (Mod+Y on Windows and Linux)"],
  ["Cut, copy, paste, select all", "Mod+X, Mod+C, Mod+V, Mod+A"],
  ["Next or previous element type", "Tab, Shift+Tab"],
  ["New line", "Enter"],
  ["Leave focus mode, a popup or a field", "Escape"],
  ["Next or previous panel", "F6, Shift+F6"],
  ["Move a scene or card", "Alt+arrow keys (in the scene list or board)"],
];
const RESERVED = new Set(["Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+X", "Mod+C", "Mod+V", "Mod+A", "Tab", "Shift+Tab", "Enter", "Shift+Enter", "Escape", "F6", "Shift+F6"]);

const CODE_KEYS: Record<string, string> = { Period: ".", Comma: ",", Minus: "-", Equal: "=", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`", NumpadAdd: "=", NumpadSubtract: "-" };

/** The binding a key event makes ("Mod+Shift+S"), or null for a lone modifier. */
export function comboOf(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return null;
  let key: string;
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (e.key === " ") key = "Space";
  else if (e.key === "+") key = "=";
  else key = e.key;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** "Mod+Shift+S" as the writer reads it: "Ctrl+Shift+S" or "Cmd+Shift+S". */
export function display(combo: string): string {
  return combo.replace(/^Mod\+/, isMac ? "Cmd+" : "Ctrl+");
}

/** The keys in force for each command: the user's choice ("" = none), else the defaults. */
export function effective(overrides: Record<string, string>): Map<string, string[]> {
  return new Map(BINDINGS.map((b) => [b.id, b.id in overrides ? (overrides[b.id] ? [overrides[b.id]] : []) : b.defaults]));
}

/** The command a key combination runs, if any. */
export function commandFor(overrides: Record<string, string>, combo: string): Binding | undefined {
  const eff = effective(overrides);
  return BINDINGS.find((b) => eff.get(b.id)!.includes(combo));
}

/** Why a combination cannot be a shortcut, or null if it can. */
export function refusal(combo: string): string | null {
  if (RESERVED.has(combo)) return `${display(combo)} is fixed (see the list below)`;
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const fkey = /^F([1-9]|1[0-2])$/.test(key);
  if (!fkey && !mods.some((m) => m === "Mod" || m === "Ctrl" || m === "Alt")) return `${display(combo)} would type a character: use it with ${isMac ? "Cmd" : "Ctrl"} or Alt`;
  if (mods.includes("Alt") && /^Arrow/.test(key)) return `${display(combo)} moves scenes and cards`;
  return null;
}

/**
 * The overrides after giving `combo` to command `id` ("" removes its keys).
 * A command that had the same keys loses them; its name is returned so the
 * writer is told.
 */
export function assign(overrides: Record<string, string>, id: string, combo: string): { overrides: Record<string, string>; took: Binding | null } {
  const next = { ...overrides };
  let took: Binding | null = null;
  if (combo) {
    const other = commandFor(next, combo);
    if (other && other.id !== id) {
      // The other command keeps any further default keys it has.
      const rest = effective(next).get(other.id)!.filter((c) => c !== combo);
      next[other.id] = rest[0] ?? "";
      took = other;
    }
  }
  const b = BINDINGS.find((x) => x.id === id)!;
  if (combo === b.defaults[0]) delete next[id];
  else next[id] = combo;
  // Keep only what differs from the defaults.
  for (const x of BINDINGS) if (x.id in next && next[x.id] === x.defaults[0] && x.defaults.length === 1) delete next[x.id];
  return { overrides: next, took };
}

/** Menu item texts with their current keys, for the native menus. */
export function menuTexts(overrides: Record<string, string>): Record<string, string> {
  const eff = effective(overrides);
  const out: Record<string, string> = {};
  for (const b of BINDINGS) {
    if (!b.menu) continue;
    const keys = eff.get(b.id)![0];
    out[b.id] = keys ? `${b.menu} (${display(keys)})` : b.menu;
  }
  return out;
}
