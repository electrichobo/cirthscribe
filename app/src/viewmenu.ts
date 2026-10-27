// The toolbar's View dropdown (like File Explorer's View > Show): focus mode
// and check items for the panels. It runs the same actions as the native
// View menu, so both stay in step through the stored preferences.
// Keyboard: Enter, Space or Down opens; Up/Down move; Enter or Space
// toggles (the menu stays open); Escape closes and returns to the button.

import { PANEL_LABEL, currentPrefs, onPanelsChanged, togglePanel, type Panel } from "./a11y";

const PANELS: Panel[] = ["nav", "board", "status", "toolbar"];

export function createViewMenu(button: HTMLButtonElement, toggleFocus: () => void, toggleTypewriter: () => void) {
  const menu = document.createElement("div");
  menu.id = "view-menu";
  menu.className = "popup-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "View");
  menu.hidden = true;
  button.after(menu);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "view-menu");

  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>("[role^=menuitem]")];

  function render() {
    const keep = (document.activeElement as HTMLElement | null)?.dataset.panel;
    const focusItem = document.createElement("button");
    focusItem.type = "button";
    focusItem.setAttribute("role", "menuitem");
    focusItem.dataset.panel = "focus";
    focusItem.textContent = "Focus mode";
    focusItem.addEventListener("click", () => {
      close(false);
      toggleFocus();
    });
    const typewriter = document.createElement("button");
    typewriter.type = "button";
    typewriter.setAttribute("role", "menuitemcheckbox");
    typewriter.setAttribute("aria-checked", String(currentPrefs().typewriter));
    typewriter.dataset.panel = "typewriter";
    typewriter.textContent = "Typewriter mode";
    typewriter.addEventListener("click", () => toggleTypewriter());
    const sep = document.createElement("div");
    sep.setAttribute("role", "separator");
    const checks = PANELS.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitemcheckbox");
      b.setAttribute("aria-checked", String(currentPrefs().panels[p]));
      b.dataset.panel = p;
      b.textContent = PANEL_LABEL[p];
      b.addEventListener("click", () => void togglePanel(p));
      return b;
    });
    menu.replaceChildren(focusItem, typewriter, sep, ...checks);
    for (const b of items()) b.tabIndex = -1;
    if (keep && !menu.hidden) items().find((b) => b.dataset.panel === keep)?.focus();
  }

  function open() {
    render();
    menu.style.left = `${button.offsetLeft}px`;
    menu.style.top = `${button.offsetTop + button.offsetHeight + 2}px`;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    items()[0]?.focus();
  }

  function close(returnFocus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    // Hiding the toolbar hides this button; focus then goes nowhere useful.
    if (returnFocus && button.offsetParent) button.focus();
  }

  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && menu.hidden) {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== button) close(false);
  });
  onPanelsChanged(() => {
    if (!menu.hidden) render();
  });

  return { open, close };
}
