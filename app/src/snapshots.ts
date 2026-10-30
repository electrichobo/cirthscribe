// File > Snapshots… (M5 step 3): named snapshots and checkpoints.
// Full point-in-time state packages stored immutably in SQLite.
// Non-destructive restore preserves history and takes a pre-restore checkpoint by default.

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface SnapshotSummary {
  id: string;
  label: string;
  description: string;
  created_at: string;
  author: string;
  head_version: number;
  scene_count: number;
  word_count: number;
  byte_size: number;
}

export function createSnapshotsDialog(hooks: {
  onRestored: (opened: any) => Promise<void>;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "snapshots-dialog";
  dialog.className = "about snapshots-dialog";
  dialog.setAttribute("aria-labelledby", "snapshots-title");

  const header = document.createElement("div");
  header.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "snapshots-title";
  h.textContent = "Snapshots and Checkpoints";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Snapshots capture full, immutable point-in-time states of the project. Restoring a snapshot restores the script non-destructively, taking an automatic checkpoint of your current state first.";

  header.append(h, note);

  // Snapshot creation row
  const createWrap = document.createElement("form");
  createWrap.className = "snap-create-row";
  createWrap.setAttribute("aria-label", "Create new snapshot");
  createWrap.onsubmit = (e) => {
    e.preventDefault();
    void doCreate();
  };

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.id = "snap-label-input";
  labelInput.className = "snap-input snap-label-input";
  labelInput.placeholder = "Snapshot name (e.g. End of Act I, Polish pass)…";
  labelInput.setAttribute("aria-label", "Snapshot name");
  labelInput.required = true;

  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.id = "snap-desc-input";
  descInput.className = "snap-input snap-desc-input";
  descInput.placeholder = "Notes or summary (optional)…";
  descInput.setAttribute("aria-label", "Snapshot description");

  const createBtn = document.createElement("button");
  createBtn.type = "submit";
  createBtn.id = "snap-create-btn";
  createBtn.className = "btn btn-primary";
  createBtn.textContent = "+ Create Snapshot";
  createBtn.setAttribute("aria-label", "Create snapshot");

  createWrap.append(labelInput, descInput, createBtn);

  // Status element
  const status = document.createElement("div");
  status.id = "snap-status";
  status.className = "form-note snap-status";
  status.setAttribute("role", "status");

  // List of snapshots
  const listWrap = document.createElement("div");
  listWrap.id = "snap-list-wrap";
  listWrap.className = "snap-list-wrap";
  listWrap.setAttribute("role", "region");
  listWrap.setAttribute("aria-label", "Existing snapshots");

  // Bottom action bar
  const footer = document.createElement("div");
  footer.className = "dialog-actions";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.id = "snap-close-btn";
  closeBtn.className = "btn";
  closeBtn.textContent = "Done";
  closeBtn.setAttribute("aria-label", "Close snapshots dialog");
  closeBtn.onclick = () => dialog.close();

  footer.append(closeBtn);

  dialog.append(header, createWrap, status, listWrap, footer);
  document.body.append(dialog);

  let snapshots: SnapshotSummary[] = [];

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = (bytes / 1024).toFixed(1);
    if (bytes < 1024 * 1024) return `${kb} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDate(iso: string): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function loadList() {
    try {
      snapshots = await invoke<SnapshotSummary[]>("snapshots_list");
      renderList();
    } catch (e) {
      status.textContent = `Could not load snapshots: ${e}`;
    }
  }

  function renderList() {
    listWrap.innerHTML = "";
    if (snapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "snap-empty form-note";
      empty.textContent = "No snapshots saved yet. Create one above to preserve your current draft.";
      listWrap.append(empty);
      return;
    }

    for (const snap of snapshots) {
      const card = document.createElement("div");
      card.className = "snap-card";
      card.dataset.id = snap.id;

      const main = document.createElement("div");
      main.className = "snap-main";

      const head = document.createElement("div");
      head.className = "snap-head";

      const title = document.createElement("span");
      title.className = "snap-title";
      title.textContent = snap.label;

      const badge = document.createElement("span");
      badge.className = "snap-tag";
      badge.textContent = `v${snap.head_version}`;

      head.append(title, badge);

      if (snap.description) {
        const desc = document.createElement("div");
        desc.className = "snap-desc";
        desc.textContent = snap.description;
        desc.title = snap.description;
        main.append(head, desc);
      } else {
        main.append(head);
      }

      const meta = document.createElement("div");
      meta.className = "snap-meta";

      const dateSpan = document.createElement("span");
      dateSpan.textContent = formatDate(snap.created_at);

      const statsSpan = document.createElement("span");
      statsSpan.textContent = `${snap.scene_count} scene${snap.scene_count === 1 ? "" : "s"} · ${snap.word_count} words · ${formatBytes(snap.byte_size)}`;

      meta.append(dateSpan, statsSpan);
      if (snap.author) {
        const authSpan = document.createElement("span");
        authSpan.textContent = `by ${snap.author}`;
        meta.append(authSpan);
      }
      main.append(meta);

      // Actions
      const actions = document.createElement("div");
      actions.className = "snap-actions";

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-restore";
      restoreBtn.textContent = "Restore";
      restoreBtn.setAttribute("aria-label", `Restore snapshot ${snap.label}`);
      restoreBtn.onclick = async () => {
        status.textContent = `Restoring snapshot "${snap.label}"…`;
        try {
          const opened = await invoke<any>("snapshots_restore", {
            id: snap.id,
            createCheckpoint: true,
            checkpointLabel: null,
          });
          announce(`Snapshot "${snap.label}" restored. Current state was saved as a checkpoint.`);
          status.textContent = `Snapshot "${snap.label}" restored successfully.`;
          await hooks.onRestored(opened);
          await loadList();
        } catch (e) {
          status.textContent = `Restore failed: ${e}`;
        }
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.setAttribute("aria-label", `Delete snapshot ${snap.label}`);
      deleteBtn.onclick = async () => {
        try {
          await invoke("snapshots_delete", { id: snap.id });
          announce(`Snapshot "${snap.label}" deleted.`);
          status.textContent = `Snapshot "${snap.label}" deleted.`;
          await loadList();
        } catch (e) {
          status.textContent = `Delete failed: ${e}`;
        }
      };

      actions.append(restoreBtn, deleteBtn);
      card.append(main, actions);
      listWrap.append(card);
    }
  }

  async function doCreate() {
    const label = labelInput.value.trim();
    if (!label) return;
    const desc = descInput.value.trim();
    createBtn.disabled = true;
    status.textContent = "Creating snapshot…";
    try {
      const snap = await invoke<SnapshotSummary>("snapshots_create", {
        label,
        description: desc,
        author: null,
      });
      announce(`Snapshot "${snap.label}" created.`);
      status.textContent = `Snapshot "${snap.label}" created.`;
      labelInput.value = "";
      descInput.value = "";
      await loadList();
    } catch (e) {
      status.textContent = `Could not create snapshot: ${e}`;
    } finally {
      createBtn.disabled = false;
    }
  }

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dialog.close();
    }
  });

  return {
    open: async () => {
      status.textContent = "";
      await loadList();
      dialog.showModal();
      labelInput.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    refresh: loadList,
  };
}
