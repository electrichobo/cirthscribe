// File > Branches… (M5 step 4): Visual branch history and independent branch canon.
// Parallel narratives, alternative drafts, and what-if passes stored in isolated snapshots.
// Switching branches swaps the active working document tree, planning, comments, and bible (Acceptance C5).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";
import { confirmDialog } from "./confirm";
import type { SnapshotSummary } from "./snapshots";

export interface BranchSummary {
  id: string;
  name: string;
  parent_branch_id: string | null;
  fork_version: number;
  description: string;
  created_at: string;
  head_version: number;
  is_active: boolean;
  scene_count: number;
  word_count: number;
}

export function createBranchesDialog(hooks: {
  onSwitched: (opened: any) => Promise<void>;
  onBranchChanged?: (name: string) => void;
  onMergeBranch?: (branchId: string) => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "branches-dialog";
  dialog.className = "about branches-dialog";
  dialog.setAttribute("aria-labelledby", "branches-title");

  const header = document.createElement("div");
  header.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "branches-title";
  h.textContent = "Branches";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "A branch is a separate copy of your script for trying something different: another ending, a director's cut, a big rewrite. Writing in a branch never touches your main script. Like what you wrote? Bring it back. If not, delete the branch.";
  // Three plain steps, so the window explains itself.
  const steps = document.createElement("ol");
  steps.className = "branch-steps";
  for (const t of [
    "Name a new branch and choose Start Branch.",
    "Write in it as usual. The status bar shows which branch you are in.",
    "Switch back any time, bring its changes into another branch, or delete it.",
  ]) {
    const li = document.createElement("li");
    li.textContent = t;
    steps.append(li);
  }

  header.append(h, note, steps);

  // Branch creation form
  const createWrap = document.createElement("form");
  createWrap.className = "branch-create-row";
  createWrap.setAttribute("aria-label", "Start a new branch");
  createWrap.onsubmit = (e) => {
    e.preventDefault();
    void doCreate();
  };

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "branch-name-input";
  nameInput.className = "snap-input branch-name-input";
  nameInput.placeholder = "Name, e.g. Happy Ending";
  nameInput.setAttribute("aria-label", "Branch name");
  nameInput.required = true;

  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.id = "branch-desc-input";
  descInput.className = "snap-input branch-desc-input";
  descInput.placeholder = "What you want to try (optional)";
  descInput.setAttribute("aria-label", "Branch description");

  const fromSelect = document.createElement("select");
  fromSelect.id = "branch-from-select";
  fromSelect.className = "branch-from-select";
  fromSelect.setAttribute("aria-label", "Fork from source");

  const createBtn = document.createElement("button");
  createBtn.type = "submit";
  createBtn.id = "branch-create-btn";
  createBtn.className = "btn btn-primary";
  createBtn.textContent = "Start Branch";
  createBtn.setAttribute("aria-label", "Fork branch");

  createWrap.append(nameInput, descInput, fromSelect, createBtn);

  // Status element
  const status = document.createElement("div");
  status.id = "branch-status";
  status.className = "form-note branch-status";
  status.setAttribute("role", "status");

  // Branch cards list
  const list = document.createElement("div");
  list.id = "branches-list";
  list.className = "branches-list";
  list.setAttribute("role", "region");
  list.setAttribute("aria-label", "Branches");

  // Footer with close button
  const footer = document.createElement("div");
  footer.className = "dialog-actions";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => dialog.close();

  footer.append(closeBtn);

  dialog.append(header, createWrap, status, list, footer);
  document.body.appendChild(dialog);

  let branchesCache: BranchSummary[] = [];

  async function loadSources() {
    fromSelect.innerHTML = "";
    const currOpt = document.createElement("option");
    currOpt.value = "";
    currOpt.textContent = "Start from the script as it is now";
    fromSelect.appendChild(currOpt);

    try {
      const snaps = await invoke<SnapshotSummary[]>("snapshots_list");
      for (const s of snaps) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `Start from snapshot "${s.label}" (${s.scene_count} scenes)`;
        fromSelect.appendChild(opt);
      }
    } catch {
      // Non-critical if snapshots list cannot be populated
    }
  }

  async function loadList() {
    list.innerHTML = "";
    try {
      branchesCache = await invoke<BranchSummary[]>("branches_list");
    } catch (e) {
      status.textContent = `Could not load branches: ${e}`;
      return;
    }

    if (!branchesCache.length) {
      const empty = document.createElement("p");
      empty.className = "form-note";
      empty.textContent = "No branches yet: your main script is the only one.";
      list.appendChild(empty);
      return;
    }

    const activeBranch = branchesCache.find((b) => b.is_active);
    if (activeBranch && hooks.onBranchChanged) {
      hooks.onBranchChanged(activeBranch.name);
    }

    for (const branch of branchesCache) {
      const card = document.createElement("div");
      card.className = `branch-card${branch.is_active ? " active" : ""}`;
      card.setAttribute("data-branch-id", branch.id);

      const main = document.createElement("div");
      main.className = "branch-main";

      const titleRow = document.createElement("div");
      titleRow.className = "branch-title-row";

      const title = document.createElement("strong");
      title.className = "branch-name";
      title.textContent = branch.name;

      const badge = document.createElement("span");
      badge.className = `branch-badge ${branch.is_active ? "badge-active" : "badge-inactive"}`;
      badge.textContent = branch.is_active ? "You are here" : "Branch";

      titleRow.append(title, badge);

      const meta = document.createElement("div");
      meta.className = "branch-meta";

      const dateStr = branch.created_at ? branch.created_at.replace("T", " ").replace("Z", "") : "";
      const parentName = branch.parent_branch_id
        ? branchesCache.find((b) => b.id === branch.parent_branch_id)?.name || "parent"
        : null;
      const forkInfo = parentName
        ? `Started from ${parentName}`
        : "Your main script";

      meta.textContent = `${forkInfo} · ${branch.scene_count} scene${branch.scene_count === 1 ? "" : "s"} · ${branch.word_count.toLocaleString()} words${dateStr ? ` · started ${dateStr.slice(0, 16)}` : ""}`;

      main.append(titleRow, meta);

      if (branch.description) {
        const desc = document.createElement("p");
        desc.className = "branch-desc";
        desc.textContent = branch.description;
        main.append(desc);
      }

      const actions = document.createElement("div");
      actions.className = "branch-actions";

      if (!branch.is_active) {
        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "btn btn-switch";
        switchBtn.textContent = "Switch to This Branch";
        switchBtn.setAttribute("aria-label", `Switch to branch ${branch.name}`);
        switchBtn.onclick = async () => {
          status.textContent = `Switching to "${branch.name}"…`;
          try {
            const opened = await invoke<any>("branches_switch", { id: branch.id });
            announce(`Switched to branch "${branch.name}".`);
            status.textContent = `You are now writing in "${branch.name}".`;
            if (hooks.onBranchChanged) hooks.onBranchChanged(branch.name);
            await hooks.onSwitched(opened);
            await loadList();
          } catch (e) {
            status.textContent = `Could not switch: ${e}`;
          }
        };
        actions.append(switchBtn);

        const mergeBtn = document.createElement("button");
        mergeBtn.type = "button";
        mergeBtn.className = "btn btn-merge";
        mergeBtn.textContent = `Bring Changes Into "${branchesCache.find((b) => b.is_active)?.name ?? "this branch"}"…`;
        mergeBtn.setAttribute("aria-label", `Merge branch ${branch.name} into current branch`);
        mergeBtn.onclick = () => {
          dialog.close();
          if (hooks.onMergeBranch) {
            hooks.onMergeBranch(branch.id);
          }
        };
        actions.append(mergeBtn);

        if (branch.id !== "main" && branch.name.toLowerCase() !== "main") {
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "btn btn-delete";
          deleteBtn.textContent = "Delete";
          deleteBtn.setAttribute("aria-label", `Delete branch ${branch.name}`);
          deleteBtn.onclick = async () => {
            const ok = await confirmDialog(
              `Delete the branch "${branch.name}"?`,
              "Its script and everything written in it are removed. Your other branches are not changed. This cannot be undone.",
              "Delete Branch",
            );
            if (!ok) return;
            try {
              await invoke("branches_delete", { id: branch.id });
              announce(`Branch "${branch.name}" deleted.`);
              status.textContent = `Branch "${branch.name}" deleted.`;
              await loadList();
            } catch (e) {
              status.textContent = `Could not delete: ${e}`;
            }
          };
          actions.append(deleteBtn);
        }
      } else {
        const activeLabel = document.createElement("span");
        activeLabel.className = "branch-current-label";
        activeLabel.textContent = "You are writing here";
        actions.append(activeLabel);
      }

      card.append(main, actions);
      list.appendChild(card);
    }
  }

  async function doCreate() {
    const name = nameInput.value.trim();
    if (!name) return;
    const desc = descInput.value.trim();
    const snapId = fromSelect.value || null;

    status.textContent = `Starting "${name}"…`;
    try {
      const created = await invoke<BranchSummary>("branches_create", {
        name,
        description: desc,
        fromSnapshotId: snapId,
      });
      announce(`Branch "${created.name}" started.`);
      status.textContent = `Branch "${created.name}" started. Switch to it to write there.`;
      nameInput.value = "";
      descInput.value = "";
      await loadList();
    } catch (e) {
      status.textContent = `Could not start the branch: ${e}`;
    }
  }

  return {
    open: async () => {
      status.textContent = "";
      await loadSources();
      await loadList();
      dialog.showModal();
      nameInput.focus();
    },
    close: () => dialog.close(),
    list: async () => invoke<BranchSummary[]>("branches_list"),
    current: async () => invoke<string>("branches_current"),
    create: async (name: string, description: string, fromSnapshotId?: string) =>
      invoke<BranchSummary>("branches_create", {
        name,
        description,
        fromSnapshotId: fromSnapshotId ?? null,
      }),
    switch: async (id: string) => {
      const opened = await invoke<any>("branches_switch", { id });
      const branches = await invoke<BranchSummary[]>("branches_list");
      const b = branches.find((x) => x.id === id);
      const name = b ? b.name : id;
      if (hooks.onBranchChanged) hooks.onBranchChanged(name);
      await hooks.onSwitched(opened);
      return opened;
    },
    switchBranch: async (id: string) => {
      const opened = await invoke<any>("branches_switch", { id });
      if (hooks.onBranchChanged) {
        const brs = await invoke<BranchSummary[]>("branches_list");
        const active = brs.find((b) => b.is_active);
        if (active) hooks.onBranchChanged(active.name);
      }
      await hooks.onSwitched(opened);
      return opened;
    },
    deleteBranch: async (id: string) => invoke<void>("branches_delete", { id }),
  };
}
