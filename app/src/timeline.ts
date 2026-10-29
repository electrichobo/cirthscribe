// View > Tools > Timeline… (M3 step 8, ACCEPTANCE B5): the story in its own
// order, separate from the order the script shows it. Each event has a
// title, a time in the writer's words ("Day 3, dawn", "the night before"),
// may be uncertain or happen at the same time as the event before it, and
// links to scenes in any script of the project. An event shown after a
// later one is marked as a flashback.
//
// Moving an event (Alt+Up/Down, or the buttons) changes only the timeline.
// "Put this script in story order" is separate: it previews the new scene
// order and, only when "Board may reorder script" is on, applies it as one
// script edit that one undo in the script reverts.
//
// Every timeline change is a planning step; "Undo" in the dialog takes back
// its last change (ADR 0003).

import { announce } from "./a11y";

export interface StoryEvent {
  id: string;
  title: string;
  summary: string;
  when: string;
  uncertain: boolean;
  simultaneous: boolean;
  pos: number;
  scenes: string[];
}
interface TimelineState {
  events: StoryEvent[];
  places: Record<string, { document_id: string; document_title: string; heading: string }>;
  flashbacks: string[];
  current_order: string[];
  story_order: string[];
}
export type TimelineOp = { PutEvent: StoryEvent } | { DeleteEvent: string };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export function createTimeline(hooks: {
  state: () => Promise<TimelineState>;
  apply: (op: TimelineOp) => Promise<boolean>;
  undo: () => Promise<boolean>;
  currentScene: () => string | null;
  structural: () => boolean;
  reorder: (order: string[]) => boolean;
  go: (documentId: string, sceneId: string) => void;
  newId: () => string;
}) {
  const dialog = el("dialog", { id: "timeline-dialog", className: "about timeline" });
  dialog.setAttribute("aria-labelledby", "timeline-title");
  const status = el("p", { id: "timeline-status", className: "form-note" });
  status.setAttribute("role", "status");
  const list = el("ol", { className: "timeline-list", id: "timeline-list" });
  list.setAttribute("aria-label", "Story events, in story order");
  list.setAttribute("aria-describedby", "timeline-hint");
  const detail = el("div", { className: "timeline-detail", id: "timeline-detail" });
  const add = el("button", { type: "button", id: "timeline-new" }, "New event");
  const addHere = el("button", { type: "button", id: "timeline-new-here" }, "New event for the current scene");
  const undoBtn = el("button", { type: "button", id: "timeline-undo", disabled: true }, "Undo");
  const close = el("button", { type: "button", id: "timeline-close" }, "Close");
  const order = el("div", { className: "timeline-order", id: "timeline-order" });
  dialog.append(
    el("h2", { id: "timeline-title" }, "Timeline"),
    el("p", { className: "form-note" }, "The story in the order it happens. Nothing here moves the script, except the separate command below."),
    el("p", { className: "sr-only", id: "timeline-hint" }, "Up and Down choose an event, Alt+Up and Alt+Down move it in the story, Delete removes it."),
    el("div", { className: "timeline-tools" }, add, addHere, status),
    el("div", { className: "timeline-cols" }, el("div", { className: "timeline-left" }, list), detail),
    order,
    el("div", { className: "dialog-actions" }, undoBtn, close),
  );
  document.body.append(dialog);

  let st: TimelineState = { events: [], places: {}, flashbacks: [], current_order: [], story_order: [] };
  let chosen: string | null = null;
  let steps = 0;
  let busy = false;

  const say = (t: string) => {
    status.textContent = t;
    announce(t);
  };
  const place = (scene: string) => st.places[scene];
  const label = (scene: string) => {
    const p = place(scene);
    return p ? `${p.document_title} · ${p.heading || "(empty heading)"}` : "(a scene that no longer exists)";
  };
  const sorted = () => [...st.events].sort((a, b) => a.pos - b.pos);

  async function change(op: TimelineOp, done: string, focus?: string) {
    if (busy) return;
    busy = true;
    try {
      if (await hooks.apply(op)) {
        steps++;
        undoBtn.disabled = false;
        say(done);
        await reload(focus);
      }
    } finally {
      busy = false;
    }
  }

  async function reload(focus?: string) {
    st = await hooks.state();
    if (!st.events.some((e) => e.id === chosen)) chosen = sorted()[0]?.id ?? null;
    draw(focus);
  }

  function create(scenes: string[]) {
    const evs = sorted();
    const at = evs.findIndex((e) => e.id === chosen);
    // After the chosen event, or at the end.
    const pos = at < 0 ? (evs.at(-1)?.pos ?? 0) + 1 : evs[at + 1] ? (evs[at].pos + evs[at + 1].pos) / 2 : evs[at].pos + 1;
    const e: StoryEvent = { id: hooks.newId(), title: scenes.length ? (place(scenes[0])?.heading ?? "New event") : "New event", summary: "", when: "", uncertain: false, simultaneous: false, pos, scenes };
    chosen = e.id;
    void change({ PutEvent: e }, "Event added to the timeline", e.id);
  }

  function move(id: string, dir: -1 | 1) {
    const evs = sorted();
    const i = evs.findIndex((e) => e.id === id);
    const j = i + dir;
    if (j < 0 || j >= evs.length) return say(dir < 0 ? "Already the earliest event" : "Already the latest event");
    const far = evs[j + dir];
    const pos = far ? (evs[j].pos + far.pos) / 2 : evs[j].pos + dir;
    void change({ PutEvent: { ...evs[i], pos } }, `Moved ${dir < 0 ? "earlier" : "later"} in the story. The script is unchanged.`, id);
  }

  function draw(focus?: string) {
    const evs = sorted();
    const flash = new Set(st.flashbacks);
    list.replaceChildren();
    const rows: HTMLButtonElement[] = [];
    evs.forEach((e) => {
      const b = el(
        "button",
        { type: "button", className: "timeline-event" },
        el("span", { className: "timeline-when" }, e.when ? `${e.when}${e.uncertain ? " (?)" : ""}` : e.uncertain ? "(uncertain)" : ""),
        el("strong", {}, e.title || "(untitled)"),
        ...(e.simultaneous ? [el("span", { className: "timeline-flag" }, "same time as the one before")] : []),
        ...(flash.has(e.id) ? [el("span", { className: "timeline-flag flash" }, "flashback")] : []),
        el("span", { className: "timeline-scenes" }, `${e.scenes.length} scene${e.scenes.length === 1 ? "" : "s"}`),
      );
      b.dataset.id = e.id;
      b.tabIndex = e.id === chosen ? 0 : -1;
      if (e.id === chosen) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => {
        chosen = e.id;
        draw(e.id);
      });
      list.append(el("li", { className: e.simultaneous ? "simultaneous" : "" }, b));
      rows.push(b);
    });
    if (!evs.length) list.append(el("li", { className: "form-note" }, "No events yet."));
    list.onkeydown = (ev) => {
      const at = rows.indexOf(ev.target as HTMLButtonElement);
      if (at < 0) return;
      const id = rows[at].dataset.id!;
      if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
        ev.preventDefault();
        move(id, ev.key === "ArrowUp" ? -1 : 1);
      } else if (!ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
        ev.preventDefault();
        const to = rows[Math.max(0, Math.min(rows.length - 1, at + (ev.key === "ArrowUp" ? -1 : 1)))];
        chosen = to.dataset.id!;
        draw(chosen);
      } else if (ev.key === "Delete") {
        ev.preventDefault();
        void change({ DeleteEvent: id }, "Event removed from the timeline (Undo brings it back)");
      }
    };
    drawDetail();
    drawOrder();
    if (focus) list.querySelector<HTMLElement>(`button[data-id="${CSS.escape(focus)}"]`)?.focus();
  }

  function drawDetail() {
    detail.replaceChildren();
    const e = st.events.find((x) => x.id === chosen);
    if (!e) return void detail.append(el("p", { className: "form-note" }, "Add an event, or one for the scene you are in."));
    const save = (patch: Partial<StoryEvent>, msg: string) => void change({ PutEvent: { ...e, ...patch } }, msg, e.id);
    const title = el("input", { type: "text", id: "timeline-event-title", value: e.title });
    title.setAttribute("aria-label", "What happens");
    title.addEventListener("change", () => save({ title: title.value }, "Event saved"));
    const when = el("input", { type: "text", id: "timeline-when", value: e.when, placeholder: "When, in your words: Day 3, dawn · 1987 · the night before" });
    when.setAttribute("aria-label", "When it happens");
    when.addEventListener("change", () => save({ when: when.value }, "Time saved"));
    const unsure = el("input", { type: "checkbox", id: "timeline-uncertain", checked: e.uncertain });
    unsure.addEventListener("change", () => save({ uncertain: unsure.checked }, unsure.checked ? "Marked as uncertain" : "No longer uncertain"));
    const same = el("input", { type: "checkbox", id: "timeline-simultaneous", checked: e.simultaneous });
    same.addEventListener("change", () => save({ simultaneous: same.checked }, same.checked ? "Happens at the same time as the event before" : "Happens after the event before"));
    const summary = el("textarea", { id: "timeline-summary", value: e.summary, rows: 3, placeholder: "What happens (planning text, never written into the script)" });
    summary.setAttribute("aria-label", "Summary");
    summary.addEventListener("change", () => save({ summary: summary.value }, "Summary saved"));
    // Scenes that show it.
    const scenes = el("ul", { className: "timeline-linked", id: "timeline-linked" });
    for (const s of e.scenes) {
      const p = place(s);
      const go = el("button", { type: "button", className: "bible-go" }, label(s));
      go.addEventListener("click", () => {
        if (!p) return;
        dialog.close();
        hooks.go(p.document_id, s);
      });
      const rm = el("button", { type: "button", className: "timeline-unlink" }, "Unlink");
      rm.setAttribute("aria-label", `Unlink ${label(s)}`);
      rm.addEventListener("click", () => save({ scenes: e.scenes.filter((x) => x !== s) }, "Scene unlinked (the script is unchanged)"));
      scenes.append(el("li", {}, go, " ", rm));
    }
    const pick = el("select", { id: "timeline-link" });
    pick.setAttribute("aria-label", "Link a scene to this event");
    pick.append(new Option("Link a scene…", ""), ...Object.keys(st.places).filter((s) => !e.scenes.includes(s)).map((s) => new Option(label(s), s)));
    pick.addEventListener("change", () => pick.value && save({ scenes: [...e.scenes, pick.value] }, "Scene linked"));
    const del = el("button", { type: "button", id: "timeline-delete" }, "Remove event");
    del.addEventListener("click", () => void change({ DeleteEvent: e.id }, "Event removed from the timeline (Undo brings it back)"));
    detail.append(
      el("label", { htmlFor: "timeline-event-title" }, "What happens"),
      title,
      el("label", { htmlFor: "timeline-when" }, "When"),
      when,
      el("label", { className: "timeline-check" }, unsure, " The time is uncertain"),
      el("label", { className: "timeline-check" }, same, " At the same time as the event before"),
      el("label", { htmlFor: "timeline-summary" }, "Summary"),
      summary,
      el("h3", {}, "Shown in"),
      scenes,
      pick,
      del,
    );
    if (st.flashbacks.includes(e.id)) detail.append(el("p", { className: "form-note" }, "Flashback: the script shows this after something that happens later."));
  }

  /** Put the open script's scenes in story order: preview, then apply (with permission). */
  function drawOrder() {
    order.replaceChildren();
    const same = st.story_order.join() === st.current_order.join();
    const box = el("details", { id: "timeline-apply" });
    box.append(el("summary", {}, "Put this script's scenes in story order…"));
    if (same) box.append(el("p", { className: "form-note" }, "This script already follows the story order."));
    else {
      box.append(
        el("p", {}, "New scene order (scenes with no event stay after the scene they follow now):"),
        el("ol", { className: "timeline-preview", id: "timeline-preview" }, ...st.story_order.map((s) => el("li", {}, place(s)?.heading || "(empty heading)"))),
      );
      const go = el("button", { type: "button", id: "timeline-apply-go", className: "primary", disabled: !hooks.structural() }, "Reorder the script");
      go.title = hooks.structural() ? "One script edit; one undo in the script puts it back" : "Turn on \"Board may reorder script\" first";
      go.addEventListener("click", () => {
        if (hooks.reorder(st.story_order)) {
          dialog.close();
          announce("The script follows the story order. Undo in the script puts it back.");
        }
      });
      box.append(go);
      if (!hooks.structural()) box.append(el("p", { className: "form-note" }, "Reordering the script needs \"Board may reorder script\" (on the board)."));
    }
    order.append(box);
  }

  add.addEventListener("click", () => create([]));
  addHere.addEventListener("click", () => {
    const s = hooks.currentScene();
    if (!s) return say("Put the caret in a scene first.");
    create([s]);
  });
  undoBtn.addEventListener("click", async () => {
    if (!steps || busy) return;
    if (await hooks.undo()) {
      steps--;
      undoBtn.disabled = steps === 0;
      say("Undone");
      await reload(chosen ?? undefined);
    }
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open() {
      steps = 0;
      undoBtn.disabled = true;
      status.textContent = "";
      await reload();
      if (!dialog.open) dialog.showModal();
      (list.querySelector<HTMLElement>('button[tabindex="0"]') ?? add).focus();
    },
    close: () => dialog.close(),
  };
}
