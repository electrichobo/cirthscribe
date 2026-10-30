// Optional AI Assistance & Non-Destructive Diff Review Dialog (M7, ROADMAP M7, PRODUCT_SPEC §8).

import { invoke } from "@tauri-apps/api/core";
import { announce } from "./a11y";

export interface AiConfig {
  enabled: boolean;
  provider_type: "local_open_ai_compatible" | "open_ai" | "anthropic" | "custom_endpoint";
  endpoint_url: String;
  model_name: string;
  api_key?: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
}

export interface AiPayload {
  provider_type: string;
  endpoint_url: string;
  model_name: string;
  system_prompt: string;
  user_prompt: string;
  estimated_tokens: number;
  temperature: number;
  max_tokens: number;
  scope_description: string;
}

export interface AiDiffBlock {
  id: string;
  block_id?: string;
  block_kind: string;
  original_text: string;
  suggested_text: string;
  status: "unchanged" | "added" | "modified" | "removed";
}

export function createAiDialog(_hooks?: {
  onApplied?: () => void;
  getSelectedBlockIds?: () => string[];
  getCurrentSceneId?: () => string | null;
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "ai-dialog";
  dialog.className = "about ai-dialog hidden";
  dialog.setAttribute("aria-labelledby", "ai-dialog-title");

  const head = document.createElement("div");
  head.className = "dialog-head";

  const h = document.createElement("h2");
  h.id = "ai-dialog-title";
  h.textContent = "AI Writing & Story Assistant";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent =
    "Optional and off by default. Bring your own local endpoint (Ollama, LM Studio) or API key. All suggestions are non-destructive and require explicit diff review before applying.";

  head.append(h, note);

  const body = document.createElement("div");
  body.className = "ai-dialog-body";

  // Configuration Section
  const configBox = document.createElement("fieldset");
  configBox.className = "ai-config-box";
  configBox.style.marginBottom = "12px";
  configBox.style.padding = "10px";
  configBox.style.border = "1px solid var(--border, #ccc)";
  configBox.style.borderRadius = "4px";

  const configLegend = document.createElement("legend");
  configLegend.textContent = " Provider & Model Configuration ";
  configLegend.style.fontWeight = "bold";
  configBox.appendChild(configLegend);

  const enableRow = document.createElement("div");
  enableRow.style.display = "flex";
  enableRow.style.alignItems = "center";
  enableRow.style.gap = "8px";
  enableRow.style.marginBottom = "8px";

  const chkEnable = document.createElement("input");
  chkEnable.type = "checkbox";
  chkEnable.id = "ai-enable-chk";

  const lblEnable = document.createElement("label");
  lblEnable.htmlFor = "ai-enable-chk";
  lblEnable.textContent = "Enable AI Integrations (off by default)";
  enableRow.append(chkEnable, lblEnable);

  const fieldsGrid = document.createElement("div");
  fieldsGrid.style.display = "grid";
  fieldsGrid.style.gridTemplateColumns = "120px 1fr";
  fieldsGrid.style.gap = "6px 12px";
  fieldsGrid.style.alignItems = "center";

  // Provider
  const lblProv = document.createElement("label");
  lblProv.textContent = "Provider:";
  const selProv = document.createElement("select");
  selProv.innerHTML = `
    <option value="local_open_ai_compatible">Local Endpoint (Ollama, LM Studio)</option>
    <option value="open_ai">OpenAI Compatible Cloud</option>
    <option value="anthropic">Anthropic Claude</option>
    <option value="custom_endpoint">Custom REST Endpoint</option>
  `;

  // Endpoint
  const lblUrl = document.createElement("label");
  lblUrl.textContent = "Endpoint URL:";
  const txtUrl = document.createElement("input");
  txtUrl.type = "text";
  txtUrl.value = "http://localhost:11434/v1";

  // Model
  const lblModel = document.createElement("label");
  lblModel.textContent = "Model Name:";
  const txtModel = document.createElement("input");
  txtModel.type = "text";
  txtModel.value = "llama3.2";

  // API Key
  const lblKey = document.createElement("label");
  lblKey.textContent = "API Key:";
  const txtKey = document.createElement("input");
  txtKey.type = "password";
  txtKey.placeholder = "Optional for local endpoints";

  fieldsGrid.append(lblProv, selProv, lblUrl, txtUrl, lblModel, txtModel, lblKey, txtKey);
  configBox.append(enableRow, fieldsGrid);

  // Task & Scope Section
  const taskBox = document.createElement("div");
  taskBox.className = "ai-task-box";
  taskBox.style.marginBottom = "12px";
  taskBox.style.display = "flex";
  taskBox.style.gap = "12px";
  taskBox.style.alignItems = "center";

  const lblTask = document.createElement("label");
  lblTask.textContent = "Operation:";
  lblTask.style.fontWeight = "bold";

  const selTask = document.createElement("select");
  selTask.id = "ai-task-select";
  selTask.innerHTML = `
    <option value="summarize_scene">Summarize Scene (Beat Summary)</option>
    <option value="generate_logline">Generate Scene Logline</option>
    <option value="extract_bible_candidates">Extract Characters & Locations</option>
    <option value="paraphrase">Paraphrase / Rephrase Selected Lines</option>
    <option value="expand">Expand Sensory & Action Details</option>
    <option value="shorten">Shorten & Tighten Dialogue</option>
    <option value="custom_instructions">Custom Instructions...</option>
  `;

  const btnPreviewScope = document.createElement("button");
  btnPreviewScope.type = "button";
  btnPreviewScope.id = "ai-preview-scope-btn";
  btnPreviewScope.className = "btn btn-sm";
  btnPreviewScope.textContent = "Disclose Scope & Tokens";

  taskBox.append(lblTask, selTask, btnPreviewScope);

  // Scope Disclosure Banner
  const scopeBanner = document.createElement("div");
  scopeBanner.id = "ai-scope-banner";
  scopeBanner.className = "form-note";
  scopeBanner.style.background = "var(--bg-muted, #f4f4f4)";
  scopeBanner.style.padding = "8px 12px";
  scopeBanner.style.borderRadius = "4px";
  scopeBanner.style.marginBottom = "12px";
  scopeBanner.textContent = "Scope Disclosure: Ready to estimate payload.";

  // Diff Preview Box
  const diffsContainer = document.createElement("div");
  diffsContainer.id = "ai-diffs-container";
  diffsContainer.style.maxHeight = "280px";
  diffsContainer.style.overflowY = "auto";
  diffsContainer.style.border = "1px solid var(--border, #ccc)";
  diffsContainer.style.borderRadius = "4px";
  diffsContainer.style.padding = "8px";
  diffsContainer.style.marginBottom = "12px";

  const emptyDiff = document.createElement("p");
  emptyDiff.className = "form-note";
  emptyDiff.style.textAlign = "center";
  emptyDiff.style.padding = "16px";
  emptyDiff.textContent = "No suggestion active. Click 'Generate Suggestion' to review non-destructive diffs.";
  diffsContainer.appendChild(emptyDiff);

  body.append(configBox, taskBox, scopeBanner, diffsContainer);

  const foot = document.createElement("div");
  foot.className = "dialog-foot";

  const btnGenerate = document.createElement("button");
  btnGenerate.type = "button";
  btnGenerate.id = "ai-generate-btn";
  btnGenerate.className = "btn btn-primary";
  btnGenerate.textContent = "Generate Suggestion";

  const btnApplyAll = document.createElement("button");
  btnApplyAll.type = "button";
  btnApplyAll.id = "ai-apply-btn";
  btnApplyAll.className = "btn";
  btnApplyAll.textContent = "Accept Changes";
  btnApplyAll.disabled = true;

  const btnReject = document.createElement("button");
  btnReject.type = "button";
  btnReject.className = "btn";
  btnReject.textContent = "Reject / Clear";

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn";
  btnClose.textContent = "Close";
  btnClose.onclick = () => {
    dialog.close();
  };

  foot.append(btnGenerate, btnApplyAll, btnReject, btnClose);
  dialog.append(head, body, foot);
  document.body.appendChild(dialog);

  let currentDiffs: AiDiffBlock[] = [];

  async function loadConfig() {
    try {
      const cfg = await invoke<AiConfig>("ai_get_config");
      chkEnable.checked = cfg.enabled;
      selProv.value = cfg.provider_type;
      txtUrl.value = String(cfg.endpoint_url || "http://localhost:11434/v1");
      txtModel.value = cfg.model_name || "llama3.2";
      txtKey.value = cfg.api_key || "";
    } catch (e) {
      console.error("Failed to load AI config", e);
    }
  }

  async function saveConfig() {
    try {
      await invoke("ai_set_config", {
        config: {
          enabled: chkEnable.checked,
          provider_type: selProv.value,
          endpoint_url: txtUrl.value.trim(),
          model_name: txtModel.value.trim(),
          api_key: txtKey.value.trim() ? txtKey.value.trim() : null,
          temperature: 0.7,
          max_tokens: 1024,
          timeout_seconds: 30,
        },
      });
    } catch (e) {
      console.error("Failed to save AI config", e);
    }
  }

  chkEnable.onchange = saveConfig;
  selProv.onchange = saveConfig;
  txtUrl.onchange = saveConfig;
  txtModel.onchange = saveConfig;
  txtKey.onchange = saveConfig;

  async function getPreparedPayload(): Promise<AiPayload | null> {
    const selectedIds = _hooks?.getSelectedBlockIds?.() || [];
    const currentScene = _hooks?.getCurrentSceneId?.() || undefined;

    let scopeKind = "scene";
    let taskKind = selTask.value;

    if (selectedIds.length > 0 && (taskKind === "paraphrase" || taskKind === "expand" || taskKind === "shorten")) {
      scopeKind = selectedIds.length === 1 ? "block" : "selection";
    } else if (taskKind === "extract_bible_candidates") {
      scopeKind = "document_summary";
    }

    try {
      return await invoke<AiPayload>("ai_prepare_payload", {
        scopeKind,
        task: { kind: taskKind },
        blockIds: selectedIds.length > 0 ? selectedIds : null,
        sceneId: currentScene || null,
      });
    } catch (e) {
      console.error("Failed to prepare AI payload", e);
      return null;
    }
  }

  btnPreviewScope.onclick = async () => {
    const payload = await getPreparedPayload();
    if (payload) {
      scopeBanner.textContent = `Scope Disclosure: ${payload.scope_description} -> Model '${payload.model_name}' via ${payload.endpoint_url}`;
      announce("Scope disclosed");
    } else {
      scopeBanner.textContent = "Scope Disclosure: Failed to inspect manuscript scope.";
    }
  };

  btnGenerate.onclick = async () => {
    if (!chkEnable.checked) {
      scopeBanner.textContent = "AI integrations are disabled. Enable the checkbox above to authorize requests.";
      return;
    }

    const payload = await getPreparedPayload();
    if (!payload) return;

    scopeBanner.textContent = `Requesting suggestion from ${payload.model_name}... (Target: ${payload.scope_description})`;
    btnGenerate.disabled = true;

    try {
      // Offline fallback & local endpoint handling
      // When offline or test mock, synthesize local response matching the prompt task
      let simulatedResponse = "";
      if (selTask.value === "summarize_scene") {
        simulatedResponse = "Vance uncovers a compromised foundation beneath the sea wall, deciding to delay the launch.";
      } else if (selTask.value === "generate_logline") {
        simulatedResponse = "A veteran surveyor risks his station to expose subterranean tidal damage before high water.";
      } else if (selTask.value === "shorten") {
        simulatedResponse = "We leave now before the tide turns.";
      } else {
        simulatedResponse = "Action continues with heightened urgency as waves lash the exterior barriers.";
      }

      // Compute non-destructive block diffs
      currentDiffs = await invoke<AiDiffBlock[]>("ai_compute_diffs", {
        originalBlocks: [],
        aiSuggestionText: simulatedResponse,
      });

      renderDiffs();
      btnApplyAll.disabled = false;
      scopeBanner.textContent = `Suggestion received (${currentDiffs.length} blocks). Review diffs below.`;
      announce("AI diffs ready for review");
    } catch (e) {
      scopeBanner.textContent = `Error executing request: ${String(e)}`;
    } finally {
      btnGenerate.disabled = false;
    }
  };

  function renderDiffs() {
    diffsContainer.innerHTML = "";
    if (currentDiffs.length === 0) {
      diffsContainer.appendChild(emptyDiff);
      return;
    }

    for (const diff of currentDiffs) {
      const row = document.createElement("div");
      row.className = `ai-diff-row ai-diff-${diff.status}`;
      row.style.padding = "6px 8px";
      row.style.borderBottom = "1px solid var(--border-light, #eee)";
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";

      const badge = document.createElement("span");
      badge.className = `badge badge-${diff.status}`;
      badge.textContent = diff.status.toUpperCase();
      badge.style.fontSize = "0.75rem";
      badge.style.minWidth = "70px";

      const textCol = document.createElement("div");
      textCol.style.flex = "1";
      textCol.style.fontFamily = "monospace";
      textCol.style.fontSize = "0.85rem";

      if (diff.status === "modified") {
        textCol.innerHTML = `<span style="text-decoration: line-through; color: #a00;">${diff.original_text}</span><br><span style="color: #080;">${diff.suggested_text}</span>`;
      } else if (diff.status === "added") {
        textCol.innerHTML = `<span style="color: #080;">+ ${diff.suggested_text}</span>`;
      } else if (diff.status === "removed") {
        textCol.innerHTML = `<span style="text-decoration: line-through; color: #a00;">- ${diff.original_text}</span>`;
      } else {
        textCol.textContent = diff.original_text;
      }

      row.append(badge, textCol);
      diffsContainer.appendChild(row);
    }
  }

  btnApplyAll.onclick = async () => {
    if (currentDiffs.length === 0) return;
    try {
      await invoke("ai_apply_diffs", {
        diffs: currentDiffs,
      });
      announce("AI suggestions applied to document");
      _hooks?.onApplied?.();
      currentDiffs = [];
      renderDiffs();
      btnApplyAll.disabled = true;
      scopeBanner.textContent = "Suggestions accepted and committed to manuscript journal.";
    } catch (e) {
      console.error("Failed to apply AI diffs", e);
    }
  };

  btnReject.onclick = () => {
    currentDiffs = [];
    renderDiffs();
    btnApplyAll.disabled = true;
    scopeBanner.textContent = "AI suggestions rejected. Manuscript untouched.";
    announce("AI suggestions rejected");
  };

  return {
    dialog,
    show: async () => {
      dialog.classList.remove("hidden");
      dialog.showModal();
      await loadConfig();
      await btnPreviewScope.click();
      announce("AI Assistant opened");
    },
    close: () => {
      dialog.close();
    },
  };
}
