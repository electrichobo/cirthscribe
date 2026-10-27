// Focus mode: full screen with only the script page. Every other panel is
// hidden (body[data-focus]); Escape, the View menu or Ctrl/Cmd+Shift+F
// leaves. The window goes full screen only if it was not already, the menu
// bar is hidden on Windows and Linux (Rust, focus_window), and leaving full
// screen from the OS (macOS green button) ends focus mode too. Session-only:
// never stored.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { announce } from "./a11y";

export function createFocusMode(focusEditor: () => void) {
  const win = getCurrentWindow();
  let on = false;
  let madeFullscreen = false;
  let reachedFullscreen = false;

  async function enter() {
    if (on || document.body.dataset.view !== "editor") return;
    on = true;
    document.body.dataset.focus = "on";
    madeFullscreen = false;
    reachedFullscreen = false;
    try {
      madeFullscreen = await invoke<boolean>("focus_window", { on: true, restore: false });
      reachedFullscreen = await win.isFullscreen();
    } catch {
      // Full screen unavailable (some Linux window managers): the panels are still hidden.
    }
    focusEditor();
    announce("Focus mode. Press Escape to leave.");
  }

  async function leave() {
    if (!on) return;
    on = false;
    delete document.body.dataset.focus;
    const restore = madeFullscreen;
    madeFullscreen = false;
    await invoke("focus_window", { on: false, restore }).catch(() => undefined);
    focusEditor();
    announce("Focus mode off");
    // macOS: leaving full screen animates for a moment, and keyboard focus did
    // not come back to the page (Cmd+Shift shortcuts were dropped). Ask again
    // once it has settled. A guess at the cause, not yet verified on a Mac.
    const wasFull = reachedFullscreen;
    reachedFullscreen = false;
    if (wasFull)
      setTimeout(() => {
        // Only if still in the script and nothing else took focus meanwhile.
        if (on || document.body.dataset.view !== "editor") return;
        const a = document.activeElement;
        if (a && a !== document.body && !a.closest(".ProseMirror")) return;
        void invoke("focus_window", { on: false, restore: false }).then(focusEditor).catch(() => undefined);
      }, 800);
  }

  // Leaving full screen from outside the app ends focus mode as well.
  void win.onResized(async () => {
    if (on && madeFullscreen && reachedFullscreen && !(await win.isFullscreen().catch(() => true))) {
      madeFullscreen = false;
      await leave();
    }
  });

  return {
    get on() {
      return on;
    },
    enter,
    leave,
    toggle: () => (on ? leave() : enter()),
  };
}
