// The island's More (⋮) popover: focus and typewriter mode and check items
// for the panels (like File Explorer's View > Show), then the rarely used
// settings (page view, zoom, page size, spelling, Save, Free Writing). It
// runs the same actions as the native menus, so both stay in step through
// the stored preferences.
// Keyboard: Enter, Space or Down opens; Up/Down move between the items;
// Enter or Space toggles (the popover stays open); Tab reaches the settings;
// Escape closes and returns to the button.

import { PANEL_LABEL, currentPrefs, onPanelsChanged, togglePanel, type Panel } from "./a11y";

const PANELS: Panel[] = ["nav", "board", "status", "toolbar"];

export function createViewMenu(button: HTMLButtonElement, toggleFocus: () => void, toggleTypewriter: () => void, settings: HTMLElement) {
  // The popover holds a menu of toggles and a group of form controls.
  const menu = document.createElement("div");
  menu.id = "view-menu";
  menu.className = "popup-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "More options");
  menu.hidden = true;
  const list = document.createElement("div");
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", "View and panels");
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
    list.replaceChildren(focusItem, typewriter, sep, ...checks);
    // Insert the settings once: moving a focused control would drop focus
    // to the page (re-renders happen while open, e.g. on a resize).
    if (list.parentElement !== menu || settings.parentElement !== menu) menu.replaceChildren(list, settings);
    for (const b of items()) b.tabIndex = -1;
    if (keep && !menu.hidden) items().find((b) => b.dataset.panel === keep)?.focus();
  }

  function open() {
    render();
    menu.hidden = false;
    // Below the button, right-aligned with it (the button ends the island).
    // Measured after showing: a hidden element has no offset parent.
    const b = button.getBoundingClientRect();
    const host = (menu.offsetParent ?? document.body).getBoundingClientRect();
    menu.style.top = `${b.bottom - host.top + 4}px`;
    menu.style.left = "";
    menu.style.right = `${host.right - b.right}px`;
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
  // Tab cycles inside the popover: the menu (as one stop), then each
  // setting. Leaving by Tab would drop focus into the script, where Tab
  // changes the block type (macOS check N18). Escape is the way out.
  // Handled in the capture phase on the document: on Linux (WebKitGTK) a
  // focused <select> keeps Shift+Tab from reaching listeners on the popover,
  // and GTK may name the key ISO_Left_Tab.
  let lastTab = { at: 0, back: false };
  document.addEventListener(
    "keydown",
    (e) => {
      if (menu.hidden || !menu.contains(document.activeElement)) return;
      if (!(e.key === "Tab" || e.key === "ISO_Left_Tab" || e.keyCode === 9)) return;
      e.preventDefault();
      e.stopPropagation();
      const back = e.shiftKey || e.key === "ISO_Left_Tab";
      lastTab = { at: performance.now(), back };
      step(back);
    },
    true,
  );
  function step(back: boolean) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const controls = [...settings.querySelectorAll<HTMLElement>("select, input, button")].filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
    const ring: HTMLElement[] = [all[Math.max(at, 0)], ...controls];
    const i = at >= 0 ? 0 : Math.max(ring.indexOf(document.activeElement as HTMLElement), 0);
    ring[(i + (back ? ring.length - 1 : 1)) % ring.length]?.focus();
    // Some engines refuse focus on a control mid-keystroke: fall back to the first item.
    if (!menu.contains(document.activeElement)) all[0]?.focus();
  }
  // Safety net: if a Tab still moved focus out of the open popover, bring it back.
  document.addEventListener("focusin", (e) => {
    if (menu.hidden || menu.contains(e.target as Node) || performance.now() - lastTab.at > 300) return;
    items()[0]?.focus();
  });
  menu.addEventListener("keydown", (e) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (at < 0) {
      // In the settings: their own keys.
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? all[0] : all[all.length - 1])?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !button.contains(e.target as Node)) close(false);
  });
  onPanelsChanged(() => {
    if (!menu.hidden) render();
  });

  return { open, close };
}
