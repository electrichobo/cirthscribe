// 3-way merge and conflict integration dialog (Milestone 5 step 5).
//
// Displays Base (ancestor), Current ("Ours"), and Incoming ("Theirs") side-by-side
// for concurrent speech and scene edits without silent loss or concatenation (Acceptance F5).
// Enforces an explicit baseline decision when locked-page baselines diverge (Acceptance F6).

export interface MergeConflict {
  id: string;
  kind: 'block' | 'scene' | 'locked_pages' | 'bible';
  document_id: string;
  scene_id?: string;
  block_id?: string;
  context_label: string;
  base_text?: string;
  ours_text?: string;
  theirs_text?: string;
}

export interface LockedPageDivergence {
  document_id: string;
  document_title: string;
  ours_locked: boolean;
  ours_summary: string;
  theirs_locked: boolean;
  theirs_summary: string;
  base_locked: boolean;
  base_summary: string;
}

export interface MergePreview {
  source_branch_id: string;
  source_branch_name: string;
  target_branch_id: string;
  target_branch_name: string;
  base_snapshot_id?: string;
  base_label?: string;
  conflicts: MergeConflict[];
  locked_page_divergence?: LockedPageDivergence;
  auto_mergeable_count: number;
  can_auto_merge: boolean;
}

export interface ConflictResolution {
  conflict_id: string;
  choice: 'keep_ours' | 'take_theirs' | 'custom';
  custom_text?: string;
}

export interface MergeDialogController {
  open: (incomingBranchId: string, baseSnapshotId?: string) => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  getPreview: () => MergePreview | null;
  getResolutions: () => Record<string, ConflictResolution>;
  setResolution: (conflictId: string, choice: 'keep_ours' | 'take_theirs' | 'custom', customText?: string) => void;
  apply: () => Promise<void>;
}

export function createMergeDialog(
  container: HTMLElement,
  options: {
    invoke: (cmd: string, args?: any) => Promise<any>;
    onMerged?: (doc: any) => void;
    announce?: (msg: string) => void;
  }
): MergeDialogController {
  let preview: MergePreview | null = null;
  let resolutions: Record<string, ConflictResolution> = {};

  const dialog = document.createElement('dialog');
  dialog.id = 'merge-dialog';
  dialog.className = 'about merge-dialog hidden';
  dialog.setAttribute('aria-labelledby', 'merge-dialog-title');

  dialog.innerHTML = `
    <div class="cirth-modal-content cirth-merge-content" role="document">
      <header class="cirth-modal-header dialog-head">
        <h2 id="merge-dialog-title">Merge Branch</h2>
        <button type="button" class="btn btn-close cirth-modal-close" aria-label="Close merge dialog">&times;</button>
      </header>
      <div id="merge-dialog-status" class="sr-only" role="status" aria-live="polite"></div>
      <div class="cirth-merge-body">
        <div id="merge-summary-banner" class="cirth-merge-banner"></div>
        <div id="merge-baseline-warning" class="cirth-merge-warning hidden"></div>
        <div id="merge-conflicts-list" class="cirth-merge-conflicts-list"></div>
      </div>
      <footer class="cirth-modal-footer dialog-foot">
        <button type="button" id="merge-cancel-btn" class="btn btn-cancel">Cancel</button>
        <button type="button" id="merge-apply-btn" class="btn btn-apply" disabled>Apply Merge</button>
      </footer>
    </div>
  `;

  container.appendChild(dialog);

  const statusEl = dialog.querySelector('#merge-dialog-status') as HTMLElement;
  const summaryBanner = dialog.querySelector('#merge-summary-banner') as HTMLElement;
  const baselineWarning = dialog.querySelector('#merge-baseline-warning') as HTMLElement;
  const conflictsList = dialog.querySelector('#merge-conflicts-list') as HTMLElement;
  const applyBtn = dialog.querySelector('#merge-apply-btn') as HTMLButtonElement;
  const closeBtn = dialog.querySelector('.cirth-modal-close') as HTMLButtonElement;
  const cancelBtn = dialog.querySelector('#merge-cancel-btn') as HTMLButtonElement;

  function announce(msg: string) {
    if (statusEl) statusEl.textContent = msg;
    if (options.announce) options.announce(msg);
  }

  function close() {
    dialog.classList.add('hidden');
    if (dialog.open) {
      dialog.close();
    }
    preview = null;
    resolutions = {};
    conflictsList.innerHTML = '';
  }

  function isOpen(): boolean {
    return dialog.open && !dialog.classList.contains('hidden');
  }

  function checkCanApply(): boolean {
    if (!preview) return false;
    for (const c of preview.conflicts) {
      if (!resolutions[c.id]) {
        return false;
      }
    }
    return true;
  }

  function updateApplyButton() {
    applyBtn.disabled = !checkCanApply();
  }

  function setResolution(conflictId: string, choice: 'keep_ours' | 'take_theirs' | 'custom', customText?: string) {
    resolutions[conflictId] = {
      conflict_id: conflictId,
      choice,
      custom_text: customText,
    };
    renderConflictCardState(conflictId);
    updateApplyButton();
  }

  function renderConflictCardState(conflictId: string) {
    const card = conflictsList.querySelector(`[data-conflict-id="${conflictId}"]`) as HTMLElement;
    if (!card) return;
    const res = resolutions[conflictId];
    const buttons = card.querySelectorAll('.cirth-choice-btn');
    buttons.forEach((btn) => {
      const choice = (btn as HTMLElement).dataset.choice;
      if (res && res.choice === choice) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });

    const customTextarea = card.querySelector('.cirth-custom-textarea-wrap') as HTMLElement;
    if (customTextarea) {
      if (res && res.choice === 'custom') {
        customTextarea.classList.remove('hidden');
      } else {
        customTextarea.classList.add('hidden');
      }
    }
  }

  function renderPreview() {
    if (!preview) return;

    const titleEl = dialog.querySelector('#merge-dialog-title');
    if (titleEl) {
      titleEl.textContent = `Merge Branch: "${preview.source_branch_name}" → "${preview.target_branch_name}"`;
    }

    const baseNote = preview.base_label ? `Base common ancestor: "${preview.base_label}"` : 'Base: common fork point';
    summaryBanner.innerHTML = `
      <div class="cirth-banner-title">${baseNote}</div>
      <div class="cirth-banner-stats">
        <span class="badge ${preview.conflicts.length > 0 ? 'badge-warning' : 'badge-success'}">
          ${preview.conflicts.length} conflict(s) require decision
        </span>
        <span class="badge badge-info">
          ${preview.auto_mergeable_count} non-conflicting change(s) auto-merging
        </span>
      </div>
    `;

    // Locked-page baseline divergence warning (Acceptance F6)
    if (preview.locked_page_divergence) {
      const div = preview.locked_page_divergence;
      baselineWarning.classList.remove('hidden');
      baselineWarning.innerHTML = `
        <div class="cirth-warning-icon" aria-hidden="true">⚠️</div>
        <div class="cirth-warning-content">
          <strong>Locked-page production baseline divergence (Acceptance F6)</strong>
          <p>The incoming branch has a different production page lock than the current branch for script "${escapeHtml(div.document_title)}". An explicit baseline decision is required before structural changes can merge.</p>
          <div class="cirth-baseline-diff">
            <div><span class="label">Current branch:</span> ${escapeHtml(div.ours_summary)}</div>
            <div><span class="label">Incoming branch:</span> ${escapeHtml(div.theirs_summary)}</div>
          </div>
        </div>
      `;
    } else {
      baselineWarning.classList.add('hidden');
      baselineWarning.innerHTML = '';
    }

    conflictsList.innerHTML = '';

    if (preview.conflicts.length === 0) {
      conflictsList.innerHTML = `
        <div class="cirth-empty-conflicts">
          <p>No conflicting edits detected between branches. All incoming changes will merge automatically.</p>
        </div>
      `;
    } else {
      for (const c of preview.conflicts) {
        const card = document.createElement('div');
        card.className = 'cirth-conflict-card';
        card.dataset.conflictId = c.id;

        const isLock = c.kind === 'locked_pages';

        card.innerHTML = `
          <div class="cirth-conflict-header">
            <span class="cirth-conflict-kind badge ${isLock ? 'badge-warning' : 'badge-neutral'}">${c.kind.replace('_', ' ').toUpperCase()}</span>
            <span class="cirth-conflict-context">${escapeHtml(c.context_label)}</span>
          </div>
          <div class="cirth-3way-grid">
            <div class="cirth-diff-col cirth-base-col">
              <div class="cirth-col-title">Base (Ancestor)</div>
              <div class="cirth-col-body">${escapeHtml(c.base_text || '(None / Not present)')}</div>
            </div>
            <div class="cirth-diff-col cirth-ours-col">
              <div class="cirth-col-title">Current Branch ("Ours")</div>
              <div class="cirth-col-body">${escapeHtml(c.ours_text || '(Deleted)')}</div>
            </div>
            <div class="cirth-diff-col cirth-theirs-col">
              <div class="cirth-col-title">Incoming Branch ("Theirs")</div>
              <div class="cirth-col-body">${escapeHtml(c.theirs_text || '(Deleted)')}</div>
            </div>
          </div>
          <div class="cirth-conflict-choices" role="group" aria-label="Resolution for ${escapeHtml(c.context_label)}">
            <button type="button" class="cirth-btn cirth-choice-btn" data-choice="keep_ours" data-conflict-id="${c.id}">
              ${isLock ? 'Keep Current Baseline' : 'Keep Current ("Ours")'}
            </button>
            <button type="button" class="cirth-btn cirth-choice-btn" data-choice="take_theirs" data-conflict-id="${c.id}">
              ${isLock ? 'Adopt Incoming Baseline' : 'Take Incoming ("Theirs")'}
            </button>
            <button type="button" class="cirth-btn cirth-choice-btn" data-choice="custom" data-conflict-id="${c.id}">
              ${isLock ? 'Unlock Pages' : 'Custom Edit…'}
            </button>
          </div>
          <div class="cirth-custom-textarea-wrap hidden">
            <label for="custom-input-${c.id}">Custom Resolution Text:</label>
            <textarea id="custom-input-${c.id}" class="cirth-custom-textarea" rows="3">${isLock ? 'unlock' : escapeHtml(c.theirs_text || c.ours_text || '')}</textarea>
          </div>
        `;

        conflictsList.appendChild(card);
      }
    }

    // Attach choice button handlers
    conflictsList.querySelectorAll('.cirth-choice-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const confId = target.dataset.conflictId!;
        const choice = target.dataset.choice as 'keep_ours' | 'take_theirs' | 'custom';
        const card = target.closest('.cirth-conflict-card') as HTMLElement;
        const textarea = card?.querySelector('.cirth-custom-textarea') as HTMLTextAreaElement;
        const customText = choice === 'custom' ? (textarea?.value || '') : undefined;
        setResolution(confId, choice, customText);
      });
    });

    // Attach custom textarea input handlers
    conflictsList.querySelectorAll('.cirth-custom-textarea').forEach((ta) => {
      ta.addEventListener('input', (e) => {
        const target = e.currentTarget as HTMLTextAreaElement;
        const card = target.closest('.cirth-conflict-card') as HTMLElement;
        const confId = card?.dataset.conflictId;
        if (confId && resolutions[confId]?.choice === 'custom') {
          resolutions[confId].custom_text = target.value;
        }
      });
    });

    updateApplyButton();
  }

  async function open(incomingBranchId: string, baseSnapshotId?: string) {
    try {
      announce('Computing 3-way merge diff...');
      resolutions = {};
      preview = await options.invoke('merge_preview', {
        incomingBranchId,
        baseSnapshotId: baseSnapshotId || null,
      });

      renderPreview();
      dialog.classList.remove('hidden');
      if (!dialog.open) {
        dialog.showModal();
      }
      announce(`Merge preview ready: ${preview?.conflicts.length || 0} conflicts require resolution.`);
    } catch (e: any) {
      announce(`Failed to preview merge: ${e}`);
      alert(`Cannot preview merge: ${e}`);
    }
  }

  async function apply() {
    if (!preview || !checkCanApply()) return;

    try {
      applyBtn.disabled = true;
      announce('Applying merge resolutions...');

      const resolutionsList = Object.values(resolutions);
      const opened = await options.invoke('merge_apply', {
        incomingBranchId: preview.source_branch_id,
        baseSnapshotId: preview.base_snapshot_id || null,
        resolutions: resolutionsList,
      });

      if (options.onMerged) {
        await options.onMerged(opened);
      }

      announce('Merge applied successfully.');
      close();
    } catch (e: any) {
      applyBtn.disabled = false;
      announce(`Merge failed: ${e}`);
      alert(`Merge failed: ${e}`);
    }
  }

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  applyBtn.addEventListener('click', apply);

  return {
    open,
    close,
    isOpen,
    getPreview: () => preview,
    getResolutions: () => resolutions,
    setResolution,
    apply,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
