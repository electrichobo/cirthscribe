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
//
// Two views (owner, 2026-11-03): the Line, shown first, puts the events on
// one horizontal line in story order (events "at the same time" share a
// column) with a playhead you drag, click or move with Left/Right; the event
// under it opens below. Drag an event along the line to move it in the story;
// "+ Add Here" adds one after the playhead. The List is the earlier list view.

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
  // The line view and the switch between Line and List.
  const line = el("div", { className: "timeline-line", id: "timeline-line" });
  line.setAttribute("role", "group");
  line.setAttribute("aria-label", "Story events on a line, in story order");
  line.setAttribute("aria-describedby", "timeline-line-hint");
  const viewLine = el("button", { type: "button", id: "timeline-view-line" }, "Line");
  const viewList = el("button", { type: "button", id: "timeline-view-list" }, "List");
  const views = el("div", { className: "timeline-views", role: "group" }, viewLine, viewList);
  views.setAttribute("aria-label", "Timeline view");
  const VIEW_KEY = "cirth.timelineView";
  let mode: "line" | "list" = "line";
  try {
    mode = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "line";
  } catch {
    // the line, by default
  }
  function setMode(next: "line" | "list") {
    mode = next;
    dialog.dataset.view = next;
    viewLine.setAttribute("aria-pressed", String(next === "line"));
    viewList.setAttribute("aria-pressed", String(next === "list"));
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // this session only
    }
    draw(chosen ?? undefined);
  }
  viewLine.addEventListener("click", () => setMode("line"));
  viewList.addEventListener("click", () => setMode("list"));
  dialog.dataset.view = mode;
  dialog.append(
    el("h2", { id: "timeline-title" }, "Timeline"),
    el("p", { className: "form-note" }, "The story in the order it happens. Nothing here moves the script, except the separate command below."),
    el("p", { className: "sr-only", id: "timeline-hint" }, "Up and Down choose an event, Alt+Up and Alt+Down move it in the story, Delete removes it."),
    el("p", { className: "sr-only", id: "timeline-line-hint" }, "Left and Right move the playhead from event to event, Alt+Left and Alt+Right move the event in the story, Delete removes it."),
    el("div", { className: "timeline-tools" }, views, add, addHere, status),
    line,
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
    drawLine();
    drawDetail();
    drawOrder();
    viewLine.setAttribute("aria-pressed", String(mode === "line"));
    viewList.setAttribute("aria-pressed", String(mode === "list"));
    if (focus) (mode === "line" ? line : list).querySelector<HTMLElement>(`button[data-id="${CSS.escape(focus)}"]`)?.focus();
  }

  /** Columns of the line: a new column for each event, except one "at the same time as the one before". */
  function columns(): StoryEvent[][] {
    const cols: StoryEvent[][] = [];
    for (const e of sorted()) {
      if (e.simultaneous && cols.length) cols[cols.length - 1].push(e);
      else cols.push([e]);
    }
    return cols;
  }

  const COL = 150; // px between columns
  function drawLine() {
    const cols = columns();
    const flash = new Set(st.flashbacks);
    const track = el("div", { className: "timeline-track" });
    track.style.width = `${Math.max(1, cols.length) * COL + 40}px`;
    const rule = el("div", { className: "timeline-rule" });
    const head = el("div", { className: "timeline-playhead", id: "timeline-playhead" });
    head.setAttribute("aria-hidden", "true");
    track.append(rule);
    const markers: HTMLButtonElement[] = [];
    let chosenCol = Math.max(0, cols.findIndex((c) => c.some((e) => e.id === chosen)));
    cols.forEach((col, ci) => {
      const stack = el("div", { className: "timeline-col" });
      stack.style.left = `${20 + ci * COL}px`;
      stack.append(el("span", { className: "timeline-dot" }));
      for (const e of col) {
        const b = el(
          "button",
          { type: "button", className: `timeline-mark${e.id === chosen ? " chosen" : ""}${flash.has(e.id) ? " flash" : ""}` },
          el("span", { className: "timeline-when" }, e.when ? `${e.when}${e.uncertain ? " (?)" : ""}` : e.uncertain ? "(uncertain)" : `#${ci + 1}`),
          el("strong", {}, e.title || "(untitled)"),
          ...(flash.has(e.id) ? [el("span", { className: "timeline-flag flash" }, "flashback")] : []),
        );
        b.dataset.id = e.id;
        b.dataset.col = String(ci);
        b.tabIndex = e.id === chosen ? 0 : -1;
        if (e.id === chosen) b.setAttribute("aria-current", "true");
        b.setAttribute("aria-label", `${ci + 1} of ${cols.length}: ${e.title || "untitled"}${e.when ? `, ${e.when}` : ""}${flash.has(e.id) ? ", flashback" : ""}`);
        stack.append(b);
        markers.push(b);
      }
      track.append(stack);
    });
    if (!cols.length) track.append(el("p", { className: "form-note timeline-empty" }, "No events yet. Add one with + New event."));
    const place = (ci: number) => (head.style.left = `${20 + ci * COL + 58}px`);
    place(chosenCol);
    if (cols.length) track.append(head);
    line.replaceChildren(track);

    const pick = (ci: number, focus = false) => {
      ci = Math.max(0, Math.min(cols.length - 1, ci));
      if (!cols[ci]) return;
      chosenCol = ci;
      chosen = cols[ci][0].id;
      place(ci);
      markers.forEach((m) => {
        const on = m.dataset.id === chosen;
        m.classList.toggle("chosen", on);
        m.tabIndex = on ? 0 : -1;
        if (on) m.setAttribute("aria-current", "true");
        else m.removeAttribute("aria-current");
      });
      drawDetail();
      if (focus) markers.find((m) => m.dataset.id === chosen)?.focus();
    };
    const colAt = (clientX: number) => Math.round((clientX - track.getBoundingClientRect().left - 20 - 58) / COL);

    // Scrubbing: drag on the line (or the playhead) and the event under it opens.
    // Dragging an event itself moves it in the story when it is let go.
    track.onpointerdown = (ev) => {
      if (!cols.length || ev.button !== 0) return;
      const mark = (ev.target as HTMLElement).closest<HTMLButtonElement>(".timeline-mark");
      const startX = ev.clientX;
      let dragging = false;
      try {
        track.setPointerCapture(ev.pointerId);
      } catch {
        // a pointer that cannot be captured still scrubs while over the line
      }
      const moveFn = (m: PointerEvent) => {
        if (mark && !dragging && Math.abs(m.clientX - startX) > 6) {
          dragging = true;
          mark.classList.add("dragging");
        }
        if (dragging) place(Math.max(0, Math.min(cols.length - 1, colAt(m.clientX))));
        else if (!mark) pick(colAt(m.clientX));
      };
      const up = (u: PointerEvent) => {
        track.removeEventListener("pointermove", moveFn);
        track.removeEventListener("pointerup", up);
        if (dragging && mark) {
          mark.classList.remove("dragging");
          moveTo(mark.dataset.id!, Math.max(0, Math.min(cols.length - 1, colAt(u.clientX))));
        } else if (mark) {
          chosen = mark.dataset.id!;
          pick(Number(mark.dataset.col));
          mark.focus();
        } else pick(colAt(u.clientX));
      };
      track.addEventListener("pointermove", moveFn);
      track.addEventListener("pointerup", up);
    };
    track.onkeydown = (ev) => {
      const at = markers.indexOf(ev.target as HTMLButtonElement);
      if (at < 0) return;
      const id = markers[at].dataset.id!;
      if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        ev.preventDefault();
        move(id, ev.key === "ArrowLeft" ? -1 : 1);
      } else if (!ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        ev.preventDefault();
        pick(Number(markers[at].dataset.col) + (ev.key === "ArrowLeft" ? -1 : 1), true);
      } else if (ev.key === "Delete") {
        ev.preventDefault();
        void change({ DeleteEvent: id }, "Event removed from the timeline (Undo brings it back)");
      }
    };
  }

  /** Put an event at column `to` of the line (it takes its own column there). */
  function moveTo(id: string, to: number) {
    const cols = columns().map((c) => c.filter((e) => e.id !== id)).filter((c) => c.length);
    const ev = st.events.find((e) => e.id === id);
    if (!ev) return;
    const from = columns().findIndex((c) => c.some((e) => e.id === id));
    if (from === to && !ev.simultaneous) return;
    const before = cols[to - 1]?.at(-1);
    const after = cols[to]?.[0];
    const pos = before && after ? (before.pos + after.pos) / 2 : after ? after.pos - 1 : before ? before.pos + 1 : 0;
    void change({ PutEvent: { ...ev, pos, simultaneous: false } }, "Moved in the story. The script is unchanged.", id);
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
