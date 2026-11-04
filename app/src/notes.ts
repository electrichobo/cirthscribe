// Tools > Thoughts: a scratchpad saved with the project and tied to nothing
// else (no scene, block or document). It floats over the script and can be
// moved by its title bar (mouse) or with the arrow keys on the title bar, or
// popped out into its own window. Bullets, bold, italic and underline come
// from the Thoughts editor (thoughts.ts).
//
// Text is written to the working store half a second after typing stops and
// when the field loses focus; the project file gets it at the next save,
// autosave or close, like every other edit.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";
import { createThoughtsEditor } from "./thoughts";

const POS_KEY = "cirth.notesPos";

export function createNotesPanel(root: HTMLElement, hooks: { focusScript: () => void; close: () => void; popOut?: () => void }) {
  root.setAttribute("aria-label", "Thoughts");
  const bar = document.createElement("div");
  bar.className = "notes-bar";
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "notes-grip";
  grip.textContent = "Thoughts";
  grip.title = "Drag to move, or use the arrow keys";
  grip.setAttribute("aria-label", "Thoughts panel: arrow keys move it");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "notes-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Hide thoughts");
  closeBtn.title = "Hide thoughts (Tools > Thoughts)";
  if (hooks.popOut) {
    const pop = document.createElement("button");
    pop.type = "button";
    pop.className = "notes-popout";
    pop.id = "notes-popout";
    pop.textContent = "⧉";
    pop.setAttribute("aria-label", "Thoughts in their own window");
    pop.title = "Open Thoughts in a window of its own";
    pop.addEventListener("click", () => hooks.popOut?.());
    bar.append(grip, pop, closeBtn);
  } else {
    bar.append(grip, closeBtn);
  }
  const box = document.createElement("div");
  box.className = "thoughts";
  const state = document.createElement("span");
  state.className = "notes-state";
  state.setAttribute("aria-live", "off");
  root.append(bar, box, state);
  const text = createThoughtsEditor(box, () => {
    dirty = true;
    state.textContent = "";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), 500);
  });

  let dirty = false;
  let timer = 0;
  let saving: Promise<void> | null = null;

  async function flush(): Promise<void> {
    window.clearTimeout(timer);
    while (saving) await saving;
    if (!dirty) return;
    dirty = false;
    const value = text.value;
    saving = invoke("set_project_notes", { text: value })
      .then(() => {
        state.textContent = "Kept";
      })
      .catch((e) => {
        dirty = true;
        state.textContent = "NOT KEPT";
        announce(`Thoughts not kept: ${e}`, true);
      });
    try {
      await saving;
    } finally {
      saving = null;
    }
  }

  text.dom.addEventListener("blur", () => void flush());
  text.dom.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void flush();
      hooks.focusScript();
    }
  });
  closeBtn.addEventListener("click", () => {
    void flush();
    hooks.close();
  });

  // Position: inside the script area, remembered per user (a convenience).
  function place(x: number, y: number) {
    const host = root.offsetParent?.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const maxX = Math.max(0, (host?.width ?? window.innerWidth) - r.width);
    const maxY = Math.max(0, (host?.height ?? window.innerHeight) - r.height);
    const nx = Math.round(Math.min(Math.max(0, x), maxX));
    const ny = Math.round(Math.min(Math.max(0, y), maxY));
    root.style.left = `${nx}px`;
    root.style.top = `${ny}px`;
    root.style.right = "auto";
    try {
      localStorage.setItem(POS_KEY, JSON.stringify([nx, ny]));
    } catch {
      // the position lasts for this session
    }
  }
  function restorePlace() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (Array.isArray(p)) place(p[0], p[1]);
    } catch {
      // default corner
    }
  }
  grip.addEventListener("pointerdown", (e) => {
    const start = { x: e.clientX, y: e.clientY, left: root.offsetLeft, top: root.offsetTop };
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => place(start.left + m.clientX - start.x, start.top + m.clientY - start.y);
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  grip.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    place(root.offsetLeft + d[0], root.offsetTop + d[1]);
  });

  return {
    /** Show this project's notes (on open) or none (on Home). */
    async load(open: boolean) {
      window.clearTimeout(timer);
      dirty = false;
      text.set(open ? await invoke<string>("project_notes").catch(() => "") : "");
      state.textContent = "";
    },
    flush,
    /** Text typed in a pop-out notes window (ADR 0004). */
    set(value: string) {
      text.set(value);
      dirty = true;
      void flush();
    },
    shown() {
      restorePlace();
    },
    focus: () => text.focus(),
    get value() {
      return text.value;
    },
  };
}
