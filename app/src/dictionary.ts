// Format > Spelling > Personal Dictionary…: view, add, search and remove
// words in the project dictionary or user dictionary (all projects).

import { invoke } from "@tauri-apps/api/core";

export function installDictionary(notify: (msg: string) => void, onRefresh: () => Promise<void>) {
  const dlg = document.createElement("dialog");
  dlg.className = "dict-dialog";
  dlg.setAttribute("aria-label", "Personal Dictionary");

  dlg.innerHTML = `
    <form method="dialog" class="dict-wrap">
      <div class="dict-head">
        <h2>Personal Dictionary</h2>
        <button type="button" class="dict-close" aria-label="Close">✕</button>
      </div>
      <p class="form-note">
        Words added here will not be flagged as misspelled. Project words stay with this script; personal words apply to all your projects.
      </p>

      <div class="dict-tabs" role="tablist">
        <button type="button" role="tab" id="tab-project" aria-selected="true" class="dict-tab active">Project Dictionary</button>
        <button type="button" role="tab" id="tab-user" aria-selected="false" class="dict-tab">My Dictionary (All Projects)</button>
      </div>

      <div class="dict-controls">
        <input type="search" id="dict-search" placeholder="Filter words…" aria-label="Filter dictionary words" />
        <div class="dict-add-bar">
          <input type="text" id="dict-add-input" placeholder="Add word…" aria-label="New word to add" />
          <button type="button" id="dict-add-btn">Add</button>
        </div>
      </div>

      <div class="dict-list-wrap">
        <div class="dict-status" id="dict-count">0 words</div>
        <ul class="dict-word-list" id="dict-words" role="list"></ul>
      </div>

      <div class="dialog-actions">
        <button type="button" id="dict-done" class="btn-primary">Done</button>
      </div>
    </form>
  `;

  document.body.append(dlg);

  let activeScope: "project" | "user" = "project";
  let projectWords: string[] = [];
  let userWords: string[] = [];

  const tabProject = dlg.querySelector("#tab-project") as HTMLButtonElement;
  const tabUser = dlg.querySelector("#tab-user") as HTMLButtonElement;
  const searchInput = dlg.querySelector("#dict-search") as HTMLInputElement;
  const addInput = dlg.querySelector("#dict-add-input") as HTMLInputElement;
  const addBtn = dlg.querySelector("#dict-add-btn") as HTMLButtonElement;
  const countEl = dlg.querySelector("#dict-count") as HTMLDivElement;
  const listEl = dlg.querySelector("#dict-words") as HTMLUListElement;
  const closeBtn = dlg.querySelector(".dict-close") as HTMLButtonElement;
  const doneBtn = dlg.querySelector("#dict-done") as HTMLButtonElement;

  function renderWords() {
    const words = activeScope === "project" ? projectWords : userWords;
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q ? words.filter((w) => w.toLowerCase().includes(q)) : words;

    countEl.textContent = `${filtered.length} of ${words.length} word${words.length === 1 ? "" : "s"}`;
    listEl.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("li");
      empty.className = "dict-empty";
      empty.textContent = words.length ? "No matching words." : "No words in this dictionary yet.";
      listEl.append(empty);
      return;
    }

    for (const w of filtered) {
      const li = document.createElement("li");
      li.className = "dict-item";

      const span = document.createElement("span");
      span.className = "dict-word";
      span.textContent = w;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "dict-remove";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${w}`);
      removeBtn.addEventListener("click", async () => {
        await removeWord(w);
      });

      li.append(span, removeBtn);
      listEl.append(li);
    }
  }

  async function loadData() {
    try {
      const res = await invoke<{ lang: string; project_words: string[]; user_words: string[] }>("spell_settings");
      projectWords = res.project_words || [];
      userWords = res.user_words || [];
    } catch {
      projectWords = [];
      userWords = [];
    }
    renderWords();
  }

  async function addWord() {
    const raw = addInput.value.trim();
    if (!raw) return;
    if (raw.includes(" ") || raw.includes("\t") || raw.includes("/")) {
      notify("Please enter a single word without spaces.");
      return;
    }
    try {
      await invoke("spell_add", { word: raw, scope: activeScope });
      addInput.value = "";
      notify(`"${raw}" added to ${activeScope === "project" ? "project" : "personal"} dictionary.`);
      await loadData();
      await onRefresh();
    } catch (e) {
      notify(`Could not add word: ${e}`);
    }
  }

  async function removeWord(word: string) {
    try {
      await invoke("spell_remove", { word, scope: activeScope });
      notify(`"${word}" removed.`);
      await loadData();
      await onRefresh();
    } catch (e) {
      notify(`Could not remove word: ${e}`);
    }
  }

  tabProject.addEventListener("click", () => {
    activeScope = "project";
    tabProject.setAttribute("aria-selected", "true");
    tabProject.classList.add("active");
    tabUser.setAttribute("aria-selected", "false");
    tabUser.classList.remove("active");
    renderWords();
  });

  tabUser.addEventListener("click", () => {
    activeScope = "user";
    tabUser.setAttribute("aria-selected", "true");
    tabUser.classList.add("active");
    tabProject.setAttribute("aria-selected", "false");
    tabProject.classList.remove("active");
    renderWords();
  });

  searchInput.addEventListener("input", renderWords);

  addBtn.addEventListener("click", (e) => {
    e.preventDefault();
    void addWord();
  });

  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void addWord();
    }
  });

  const close = () => dlg.close();
  closeBtn.addEventListener("click", close);
  doneBtn.addEventListener("click", close);

  return {
    open: async () => {
      searchInput.value = "";
      addInput.value = "";
      await loadData();
      dlg.showModal();
      searchInput.focus();
    },
    close,
  };
}
