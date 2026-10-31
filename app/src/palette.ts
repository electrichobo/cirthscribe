// Command Palette / Quick Switcher (Ctrl+K / Cmd+K)
// Fast fuzzy/substring search to instantly jump to scenes, characters,
// outline beats, or run any application command without leaving the keyboard.

import type { EditorView } from "prosemirror-view";

export interface PaletteAction {
  id: string;
  title: string;
  category: "Commands" | "Scenes" | "Characters" | "Outline";
  hint?: string;
  run: () => void | Promise<void>;
}

export function installCommandPalette(
  getView: () => EditorView | undefined,
  getActions: () => PaletteAction[],
  getScenes: () => { number: string; heading: string; pos: number }[],
  getCharacters: () => { name: string; count: number }[],
  notify: (msg: string) => void
) {
  const dlg = document.createElement("dialog");
  dlg.className = "palette-dialog";
  dlg.setAttribute("aria-label", "Command Palette");

  dlg.innerHTML = `
    <div class="palette-wrap">
      <div class="palette-search-bar">
        <svg class="palette-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="10.5" cy="10.5" r="6"/>
          <path d="m15 15 5 5"/>
        </svg>
        <input type="search" class="palette-input" placeholder="Type a command, scene, character or beat…" aria-label="Command search" autocomplete="off" />
        <span class="palette-esc-hint">Esc</span>
      </div>
      <div class="palette-results-wrap">
        <ul class="palette-list" role="listbox" aria-label="Suggestions"></ul>
      </div>
      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
        <span><kbd>↵</kbd> to select</span>
        <span><kbd>esc</kbd> to dismiss</span>
      </div>
    </div>
  `;

  document.body.append(dlg);

  const input = dlg.querySelector(".palette-input") as HTMLInputElement;
  const list = dlg.querySelector(".palette-list") as HTMLUListElement;

  let allItems: PaletteAction[] = [];
  let filteredItems: PaletteAction[] = [];
  let selectedIndex = 0;

  function collectItems(): PaletteAction[] {
    const items: PaletteAction[] = [...getActions()];

    // Add scenes
    const scenes = getScenes();
    for (const sc of scenes) {
      const label = sc.number ? `${sc.number}. ${sc.heading}` : sc.heading;
      items.push({
        id: `scene-${sc.pos}`,
        title: label,
        category: "Scenes",
        hint: "Jump to scene",
        run: () => {
          const v = getView();
          if (!v) return;
          v.dispatch(v.state.tr.setSelection((v.state.selection.constructor as any).near(v.state.doc.resolve(sc.pos))).scrollIntoView());
          v.focus();
        },
      });
    }

    // Add characters
    const chars = getCharacters();
    for (const ch of chars) {
      items.push({
        id: `char-${ch.name}`,
        title: ch.name,
        category: "Characters",
        hint: `${ch.count} speech${ch.count === 1 ? "" : "es"}`,
        run: () => {
          notify(`Character: ${ch.name} (${ch.count} speeches)`);
        },
      });
    }

    return items;
  }

  function renderList() {
    list.replaceChildren();
    if (!filteredItems.length) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.textContent = "No matching commands, scenes, or characters.";
      list.append(empty);
      return;
    }

    let lastCategory = "";
    filteredItems.forEach((item, idx) => {
      if (item.category !== lastCategory) {
        lastCategory = item.category;
        const catHeader = document.createElement("li");
        catHeader.className = "palette-cat-header";
        catHeader.textContent = item.category;
        list.append(catHeader);
      }

      const li = document.createElement("li");
      li.className = "palette-item" + (idx === selectedIndex ? " chosen" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
      li.dataset.index = String(idx);

      const titleSpan = document.createElement("span");
      titleSpan.className = "palette-item-title";
      titleSpan.textContent = item.title;

      li.append(titleSpan);

      if (item.hint) {
        const hintSpan = document.createElement("span");
        hintSpan.className = "palette-item-hint";
        hintSpan.textContent = item.hint;
        li.append(hintSpan);
      }

      li.addEventListener("mouseenter", () => {
        setSelectedIndex(idx, false);
      });

      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        execute(item);
      });

      list.append(li);
    });

    scrollSelectedIntoView();
  }

  function setSelectedIndex(idx: number, scroll = true) {
    if (!filteredItems.length) {
      selectedIndex = 0;
      return;
    }
    selectedIndex = Math.max(0, Math.min(idx, filteredItems.length - 1));
    const items = list.querySelectorAll(".palette-item");
    items.forEach((el, i) => {
      const isChosen = i === selectedIndex;
      el.classList.toggle("chosen", isChosen);
      el.setAttribute("aria-selected", isChosen ? "true" : "false");
    });
    if (scroll) scrollSelectedIntoView();
  }

  function scrollSelectedIntoView() {
    const chosen = list.querySelector(".palette-item.chosen") as HTMLElement | null;
    if (chosen) {
      chosen.scrollIntoView({ block: "nearest" });
    }
  }

  function filterItems() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      filteredItems = allItems;
    } else {
      filteredItems = allItems.filter((it) => it.title.toLowerCase().includes(q) || (it.hint && it.hint.toLowerCase().includes(q)) || it.category.toLowerCase().includes(q));
    }
    selectedIndex = 0;
    renderList();
  }

  function execute(item: PaletteAction) {
    dlg.close();
    try {
      void item.run();
    } catch (e) {
      notify(`Action failed: ${e}`);
    }
  }

  input.addEventListener("input", filterItems);

  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(selectedIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        execute(filteredItems[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      dlg.close();
    }
  });

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });

  return {
    open: () => {
      allItems = collectItems();
      input.value = "";
      filterItems();
      dlg.showModal();
      input.focus();
    },
    close: () => dlg.close(),
  };
}
