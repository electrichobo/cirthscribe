// Help > Keyboard Shortcuts…: every shortcut, grouped, and the way to change
// them (M3 W5). "Change" waits for the next key combination; Escape cancels,
// Backspace removes the shortcut. Keys another command had move to this one
// and the writer is told. Fixed keys are listed but cannot be changed.
// Stored per user (preferences: keys); bindings.ts holds the registry.

import { announce, currentPrefs, setPrefs } from "./a11y";
import { BINDINGS, FIXED, assign, comboOf, display, effective, refusal } from "./bindings";

export function createShortcutsDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "shortcuts-dialog";
  dialog.className = "about";
  dialog.setAttribute("aria-labelledby", "shortcuts-title");
  const h = document.createElement("h2");
  h.id = "shortcuts-title";
  h.textContent = "Keyboard shortcuts";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "Change a shortcut, then press the new keys. Escape cancels; Backspace removes the shortcut.";
  const status = document.createElement("p");
  status.id = "shortcuts-status";
  status.className = "form-note";
  status.setAttribute("role", "status");
  const body = document.createElement("div");
  body.className = "about-body";
  const resetAll = document.createElement("button");
  resetAll.type = "button";
  resetAll.id = "shortcuts-reset-all";
  resetAll.textContent = "Reset all to defaults";
  const close = document.createElement("button");
  close.type = "button";
  close.id = "shortcuts-close";
  close.textContent = "Close";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(resetAll, close);
  dialog.append(h, note, status, body, actions);
  document.body.append(dialog);

  /** The command whose new keys are being waited for. */
  let capturing: string | null = null;

  async function save(keys: Record<string, string>) {
    await setPrefs({ keys });
    draw();
  }

  function stopCapture() {
    capturing = null;
    document.body.removeAttribute("data-capturing-keys");
  }

  function draw() {
    const eff = effective(currentPrefs().keys ?? {});
    const groups = [...new Set(BINDINGS.map((b) => b.group))];
    body.replaceChildren();
    for (const g of groups) {
      const h3 = document.createElement("h3");
      h3.textContent = g;
      const table = document.createElement("table");
      table.className = "shortcut-table";
      for (const b of BINDINGS.filter((x) => x.group === g)) {
        const tr = table.insertRow();
        tr.dataset.command = b.id;
        tr.insertCell().textContent = b.label;
        const k = tr.insertCell();
        k.className = "keys";
        const keys = eff.get(b.id)!;
        k.textContent = capturing === b.id ? "Press the new keys…" : keys.length ? keys.map(display).join(" or ") : "None";
        const cell = tr.insertCell();
        cell.className = "shortcut-actions";
        const change = document.createElement("button");
        change.type = "button";
        change.className = "shortcut-change";
        change.textContent = capturing === b.id ? "Cancel" : "Change";
        change.setAttribute("aria-label", `${capturing === b.id ? "Cancel changing" : "Change"} the shortcut for ${b.label}`);
        change.addEventListener("click", () => {
          if (capturing === b.id) {
            stopCapture();
            status.textContent = "Not changed.";
          } else {
            capturing = b.id;
            document.body.setAttribute("data-capturing-keys", "");
            status.textContent = `Press the new keys for ${b.label}.`;
            announce(`Press the new keys for ${b.label}. Escape cancels.`);
          }
          draw();
          body.querySelector<HTMLButtonElement>(`tr[data-command="${b.id}"] .shortcut-change`)?.focus();
        });
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "shortcut-reset";
        reset.textContent = "Reset";
        reset.disabled = !(b.id in (currentPrefs().keys ?? {}));
        reset.setAttribute("aria-label", `Reset the shortcut for ${b.label} to ${b.defaults.map(display).join(" or ")}`);
        reset.addEventListener("click", () => {
          const r = assign(currentPrefs().keys ?? {}, b.id, b.defaults[0]);
          status.textContent = `${b.label}: ${display(b.defaults[0])}.${r.took ? ` ${r.took.label} has no shortcut now.` : ""}`;
          void save(r.overrides);
        });
        cell.append(change, reset);
      }
      body.append(h3, table);
    }
    const h3 = document.createElement("h3");
    h3.textContent = "Fixed";
    const fixed = document.createElement("table");
    fixed.className = "shortcut-table";
    for (const [what, keys] of FIXED) {
      const tr = fixed.insertRow();
      tr.insertCell().textContent = what;
      const k = tr.insertCell();
      k.className = "keys";
      k.textContent = keys.replace(/Mod\+/g, display("Mod+").slice(0, -1) + "+");
      tr.insertCell();
    }
    body.append(h3, fixed);
  }

  // The next key combination while waiting: before the app's own shortcuts.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!capturing || !dialog.open) return;
      const combo = comboOf(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      const id = capturing;
      const b = BINDINGS.find((x) => x.id === id)!;
      if (combo === "Escape") {
        stopCapture();
        status.textContent = "Not changed.";
        draw();
        return;
      }
      if (combo === "Backspace" || combo === "Delete") {
        stopCapture();
        status.textContent = `${b.label} has no shortcut now.`;
        void save(assign(currentPrefs().keys ?? {}, id, "").overrides);
        return;
      }
      const why = refusal(combo);
      if (why) {
        status.textContent = `${why}. Press other keys, or Escape.`;
        announce(status.textContent);
        return;
      }
      stopCapture();
      const r = assign(currentPrefs().keys ?? {}, id, combo);
      status.textContent = `${b.label}: ${display(combo)}.${r.took ? ` It was ${r.took.label}'s shortcut; ${r.took.label} has ${effective(r.overrides).get(r.took.id)!.length ? "its other keys" : "no shortcut"} now.` : ""}`;
      announce(status.textContent);
      void save(r.overrides).then(() => body.querySelector<HTMLButtonElement>(`tr[data-command="${id}"] .shortcut-change`)?.focus());
    },
    true,
  );
  resetAll.addEventListener("click", () => {
    stopCapture();
    status.textContent = "Every shortcut is back to its default.";
    announce(status.textContent);
    void save({});
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    stopCapture();
    status.textContent = "";
  });

  return {
    open() {
      draw();
      if (!dialog.open) dialog.showModal();
      close.focus();
    },
    close: () => dialog.close(),
  };
}
