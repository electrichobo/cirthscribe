// A small in-app confirmation dialog (the native one needs a permission the
// app does not grant). Resolves true only on the confirm button.

export function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "about form-dialog";
    dialog.id = "confirm-dialog";
    dialog.setAttribute("aria-label", title);
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.className = "form-note";
    p.textContent = body;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.id = "confirm-cancel";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.id = "confirm-ok";
    ok.textContent = confirmLabel;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    actions.append(cancel, ok);
    dialog.append(h, p, actions);
    document.body.append(dialog);
    const done = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    dialog.showModal();
    cancel.focus(); // the safe choice has focus
  });
}
