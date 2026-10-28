// Help > Keyboard Shortcuts…: every shortcut the app has, grouped. A list
// for now; remapping comes in workspace step W5.

const mod = navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl";

const GROUPS: [string, [string, string][]][] = [
  [
    "Project",
    [
      ["Open", `${mod}+O`],
      ["Save", `${mod}+S`],
      ["Save As", `${mod}+Shift+S`],
      ["Export", `${mod}+E`],
    ],
  ],
  [
    "Writing",
    [
      ["Undo, redo", `${mod}+Z, ${mod}+Shift+Z`],
      ["Next element type", "Tab"],
      ["Previous element type", "Shift+Tab"],
      ["Element by number (Scene Heading … Lyric)", `${mod}+1 to 9`],
      ["Bold, italic, underline", `${mod}+B, ${mod}+I, ${mod}+U`],
      ["Dual dialogue", `${mod}+D`],
      ["Page break before", `${mod}+Enter`],
      ["Spelling suggestions", `${mod}+.`],
      ["Find and replace", `${mod}+F`],
    ],
  ],
  [
    "Moving around",
    [
      ["Go to page", `${mod}+G`],
      ["Go to scene", `${mod}+Shift+G`],
      ["Next panel, previous panel", "F6, Shift+F6"],
      ["Move a scene or card", "Alt+arrows (in the scene list or board)"],
    ],
  ],
  [
    "View",
    [
      ["Focus mode", `${mod}+Shift+F`],
      ["Typewriter mode", `${mod}+Shift+T`],
      ["Full screen", "F11"],
      ["Larger, smaller interface, actual size", `${mod}+=, ${mod}+-, ${mod}+0`],
      ["Leave focus mode or a popup", "Escape"],
    ],
  ],
];

export function createShortcutsDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "shortcuts-dialog";
  dialog.className = "about";
  dialog.setAttribute("aria-labelledby", "shortcuts-title");
  const h = document.createElement("h2");
  h.id = "shortcuts-title";
  h.textContent = "Keyboard shortcuts";
  const body = document.createElement("div");
  body.className = "about-body";
  for (const [title, rows] of GROUPS) {
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const table = document.createElement("table");
    table.className = "shortcut-table";
    for (const [what, keys] of rows) {
      const tr = table.insertRow();
      tr.insertCell().textContent = what;
      const k = tr.insertCell();
      k.className = "keys";
      k.textContent = keys;
    }
    body.append(h3, table);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.id = "shortcuts-close";
  close.textContent = "Close";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(close);
  dialog.append(h, body, actions);
  document.body.append(dialog);
  close.addEventListener("click", () => dialog.close());

  return {
    open() {
      if (!dialog.open) dialog.showModal();
      close.focus();
    },
    close: () => dialog.close(),
  };
}
