// Character sides dialog (M4 step 6; ROADMAP §M4):
// For one or more chosen characters, export the scenes they appear in,
// as pages for actors and auditions.
//
// Invariants (ROADMAP, PRODUCT_SPEC §6):
// - Options: their scenes only (scenes_only), or full pages with the other
//   scenes struck through (cross_out).
// - Each scene keeps its locked scene numbers and page labels from baseline pagination.
// - A dual-dialogue pair stays whole when either speaker's sides are made.
// - Built on the production PDF.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { announce } from "./a11y";

export interface SidesCharacter {
  name: string;
  speeches: number;
  scenes: number;
  has_dual: boolean;
}

export interface SidesOptions {
  document_id?: string | null;
  characters: string[];
  mode: "scenes_only" | "cross_out";
  include_title_page: boolean;
  all_pages: boolean;
  watermark?: string | null;
  custom_header?: string | null;
}

export interface SidesExportResult {
  path: string;
  pages: number;
  scenes_included: number;
  characters: string[];
  mode: string;
  bytes: number;
}

export function createCharacterSides(host: {
  documentId: () => string;
}) {
  let dialog: HTMLDialogElement | null = null;
  let allCharacters: SidesCharacter[] = [];
  let selectedCharacters = new Set<string>();

  function ensureDialog(): HTMLDialogElement {
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "sides-dialog";
    dialog.className = "sides form-dialog";
    dialog.setAttribute("aria-labelledby", "sides-title");

    dialog.innerHTML = `
      <div class="sides-head">
        <div class="sides-title-row">
          <h2 id="sides-title">Character Sides</h2>
          <span class="form-note">Export scenes for actors and auditions</span>
        </div>
        <button type="button" id="sides-close" class="btn-icon" aria-label="Close">✕</button>
      </div>

      <div class="sides-body">
        <div class="sides-column sides-col-chars">
          <div class="sides-section-head">
            <h3>Select Characters</h3>
            <div class="sides-select-actions">
              <button type="button" id="sides-select-all" class="btn btn-sm">All</button>
              <button type="button" id="sides-clear-all" class="btn btn-sm">None</button>
            </div>
          </div>
          <div class="sides-filter-wrap">
            <input type="search" id="sides-char-filter" placeholder="Filter characters…" class="sides-input">
          </div>
          <div id="sides-char-list" class="sides-char-list" role="group" aria-label="Characters"></div>
        </div>

        <div class="sides-column sides-col-options">
          <div class="sides-section-head">
            <h3>Sides Format & Options</h3>
          </div>

          <div class="sides-group" role="radiogroup" aria-label="Format mode">
            <label class="sides-radio-label">
              <input type="radio" name="sides-mode" value="scenes_only" checked>
              <span>
                <strong>Active scenes only</strong>
                <span class="form-note">Only prints the scenes containing the selected character(s).</span>
              </span>
            </label>
            <label class="sides-radio-label">
              <input type="radio" name="sides-mode" value="cross_out">
              <span>
                <strong>Crossed out (struck through)</strong>
                <span class="form-note">Full pages with uncalled scenes crossed out for context.</span>
              </span>
            </label>
          </div>

          <div class="sides-checkboxes">
            <label class="sides-check-label">
              <input type="checkbox" id="sides-title-page" checked>
              <span>Include Title Page with sides summary banner</span>
            </label>
            <label class="sides-check-label" id="sides-all-pages-wrap">
              <input type="checkbox" id="sides-all-pages">
              <span>Include all script pages in crossed out mode</span>
            </label>
          </div>

          <div class="sides-inputs-wrap">
            <label class="sides-field">
              <span>Watermark text (optional)</span>
              <input type="text" id="sides-watermark" class="sides-input" placeholder="e.g. AUDITION COPY, CONFIDENTIAL">
            </label>
            <label class="sides-field">
              <span>Custom header (optional)</span>
              <input type="text" id="sides-custom-header" class="sides-input" placeholder="Default: SIDES: [CHARACTERS]">
            </label>
          </div>

          <div class="sides-preview-note">
            <span class="swatch">ℹ</span>
            <span id="sides-preview-summary">Select at least one character to export sides.</span>
          </div>
        </div>
      </div>

      <div class="sides-footer">
        <span id="sides-status" class="sides-status"></span>
        <div class="sides-footer-actions">
          <button type="button" id="sides-cancel" class="btn">Cancel</button>
          <button type="button" id="sides-export-btn" class="btn primary" disabled>Export PDF…</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Event listeners
    dialog.querySelector("#sides-close")!.addEventListener("click", () => dialog?.close());
    dialog.querySelector("#sides-cancel")!.addEventListener("click", () => dialog?.close());

    dialog.querySelector("#sides-select-all")!.addEventListener("click", () => {
      allCharacters.forEach((c) => selectedCharacters.add(c.name));
      renderCharList();
      updatePreview();
    });

    dialog.querySelector("#sides-clear-all")!.addEventListener("click", () => {
      selectedCharacters.clear();
      renderCharList();
      updatePreview();
    });

    dialog.querySelector("#sides-char-filter")!.addEventListener("input", () => {
      renderCharList();
    });

    dialog.querySelectorAll("input[name='sides-mode']").forEach((r) => {
      r.addEventListener("change", () => updatePreview());
    });

    dialog.querySelector("#sides-export-btn")!.addEventListener("click", () => handleExport());

    return dialog;
  }

  function renderCharList() {
    if (!dialog) return;
    const listEl = dialog.querySelector("#sides-char-list")!;
    const filterInput = dialog.querySelector("#sides-char-filter") as HTMLInputElement;
    const query = filterInput ? filterInput.value.trim().toUpperCase() : "";

    listEl.innerHTML = "";
    const filtered = allCharacters.filter((c) => !query || c.name.toUpperCase().includes(query));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="form-note sides-empty">No characters found.</div>`;
      return;
    }

    for (const char of filtered) {
      const row = document.createElement("label");
      row.className = "sides-char-row";
      const isChecked = selectedCharacters.has(char.name);

      const dualBadge = char.has_dual ? `<span class="badge badge-dual" title="Participates in dual dialogue">dual</span>` : "";

      row.innerHTML = `
        <input type="checkbox" data-char="${escapeHtml(char.name)}" ${isChecked ? "checked" : ""}>
        <span class="sides-char-info">
          <strong>${escapeHtml(char.name)}</strong>
          ${dualBadge}
          <span class="form-note">${char.speeches} speech${char.speeches === 1 ? "" : "es"} · ${char.scenes} scene${char.scenes === 1 ? "" : "s"}</span>
        </span>
      `;

      row.querySelector("input")!.addEventListener("change", (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
          selectedCharacters.add(char.name);
        } else {
          selectedCharacters.delete(char.name);
        }
        updatePreview();
      });

      listEl.appendChild(row);
    }
  }

  function updatePreview() {
    if (!dialog) return;
    const exportBtn = dialog.querySelector("#sides-export-btn") as HTMLButtonElement;
    const summaryEl = dialog.querySelector("#sides-preview-summary")!;
    const mode = (dialog.querySelector("input[name='sides-mode']:checked") as HTMLInputElement)?.value ?? "scenes_only";

    const count = selectedCharacters.size;
    if (count === 0) {
      exportBtn.disabled = true;
      summaryEl.textContent = "Select at least one character to export sides.";
    } else {
      exportBtn.disabled = false;
      const names = Array.from(selectedCharacters).join(", ");
      const modeText = mode === "scenes_only" ? "Active scenes only" : "Crossed out";
      summaryEl.textContent = `Ready to export sides for ${count} character${count === 1 ? "" : "s"} (${names}) · ${modeText}.`;
    }
  }

  async function handleExport() {
    if (!dialog || selectedCharacters.size === 0) return;
    const statusEl = dialog.querySelector("#sides-status") as HTMLElement;
    const exportBtn = dialog.querySelector("#sides-export-btn") as HTMLButtonElement;

    const mode = (dialog.querySelector("input[name='sides-mode']:checked") as HTMLInputElement)?.value as "scenes_only" | "cross_out";
    const includeTitle = (dialog.querySelector("#sides-title-page") as HTMLInputElement)?.checked ?? true;
    const allPages = (dialog.querySelector("#sides-all-pages") as HTMLInputElement)?.checked ?? false;
    const watermark = (dialog.querySelector("#sides-watermark") as HTMLInputElement)?.value.trim() || null;
    const customHeader = (dialog.querySelector("#sides-custom-header") as HTMLInputElement)?.value.trim() || null;

    const chars = Array.from(selectedCharacters);
    const charsSlug = chars.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");

    try {
      statusEl.textContent = "Selecting destination…";
      const dest = await save({
        title: "Export Character Sides",
        defaultPath: `sides-${charsSlug}.pdf`,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });

      if (!dest) {
        statusEl.textContent = "";
        return;
      }

      exportBtn.disabled = true;
      statusEl.textContent = "Generating Character Sides PDF…";

      const opts: SidesOptions = {
        document_id: host.documentId(),
        characters: chars,
        mode,
        include_title_page: includeTitle,
        all_pages: allPages,
        watermark,
        custom_header: customHeader,
      };

      const result = await invoke<SidesExportResult>("export_sides", {
        documentId: host.documentId(),
        options: opts,
        path: dest,
      });

      statusEl.textContent = `Saved ${result.pages} page${result.pages === 1 ? "" : "s"} (${result.scenes_included} scenes, ${result.bytes} bytes).`;
      announce(`Character sides exported: ${result.pages} pages`);
    } catch (err) {
      console.error("Failed to export sides:", err);
      statusEl.textContent = `Export failed: ${err}`;
    } finally {
      exportBtn.disabled = false;
    }
  }

  async function load() {
    ensureDialog();
    try {
      const docId = host.documentId();
      allCharacters = await invoke<SidesCharacter[]>("sides_characters", { documentId: docId });
      renderCharList();
      updatePreview();
    } catch (err) {
      console.error("Failed to load characters for sides:", err);
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return {
    open: async (preselectChar?: string) => {
      const d = ensureDialog();
      await load();
      if (preselectChar) {
        selectedCharacters.clear();
        selectedCharacters.add(preselectChar);
        renderCharList();
        updatePreview();
      }
      if (!d.open) d.showModal();
    },
    close: () => {
      dialog?.close();
    },
    exportSides: async (opts: SidesOptions, path: string) => {
      return invoke<SidesExportResult>("export_sides", {
        documentId: host.documentId(),
        options: opts,
        path,
      });
    },
    characters: () => allCharacters,
  };
}
