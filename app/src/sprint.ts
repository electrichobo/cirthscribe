// Writing sprints (Tools > Writing Sprint…): a timer with an optional word
// goal. A small chip on the toolbar counts down and shows words written;
// gentle on-screen alerts at halfway and one minute left; a congratulation at
// the end with the words and pace. No sound (owner may ask for one later).
// Words are the script's word count (the core's rule) now minus at the start,
// so deleting text counts against the sprint.

import { announce } from "./a11y";

export interface SprintHooks {
  /** The script's word count now (core rule, after the latest edits are stored). */
  words: () => Promise<number>;
  open: () => boolean;
  focusScript: () => void;
}

export function createSprint(hooks: SprintHooks) {
  const dialog = document.createElement("dialog");
  dialog.id = "sprint-dialog";
  dialog.className = "about form-dialog";
  dialog.setAttribute("aria-label", "Writing sprint");
  document.body.append(dialog);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.id = "sprint-chip";
  chip.className = "sprint-chip";
  chip.hidden = true;
  chip.title = "Writing sprint: click to pause, finish or cancel";

  let running: { end: number; minutes: number; goal: number; startWords: number; paused: number | null; halfway: boolean; lastMinute: boolean; written: number } | null = null;
  let tick = 0;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...kids);
    return e;
  };
  const mmss = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const toast = (text: string) => {
    announce(text);
    const t = el("div", { className: "sprint-toast", role: "status" }, text);
    document.body.append(t);
    window.setTimeout(() => t.remove(), 5000);
  };

  function setup() {
    const minutes = el("select", { id: "sprint-minutes" });
    for (const m of [5, 10, 15, 20, 25, 30, 45, 60]) minutes.append(new Option(`${m} minutes`, String(m)));
    minutes.value = "25";
    const goal = el("input", { type: "number", id: "sprint-goal", min: "0", step: "50", value: "0" });
    goal.setAttribute("aria-label", "Word goal (0 for none)");
    const start = el("button", { type: "button", id: "sprint-start", className: "primary" }, "Start Sprint");
    const cancel = el("button", { type: "button", id: "sprint-cancel" }, "Cancel");
    cancel.addEventListener("click", () => dialog.close());
    start.addEventListener("click", () => void begin(Number(minutes.value), Math.max(0, Number(goal.value) || 0)));
    dialog.replaceChildren(
      el("h2", {}, "Writing sprint"),
      el("p", { className: "form-note" }, "Write without stopping until the timer runs out. Words count from now; the timer shows on the toolbar, and nothing interrupts you but two quiet reminders."),
      el("div", { className: "form-grid" }, el("label", { htmlFor: "sprint-minutes" }, "Length"), minutes, el("label", { htmlFor: "sprint-goal" }, "Word goal (optional)"), goal),
      el("div", { className: "dialog-actions" }, cancel, start),
    );
  }

  async function begin(minutes: number, goal: number) {
    const startWords = await hooks.words().catch(() => 0);
    running = { end: Date.now() + minutes * 60_000, minutes, goal, startWords, paused: null, halfway: false, lastMinute: false, written: 0 };
    dialog.close();
    chip.hidden = false;
    window.clearInterval(tick);
    tick = window.setInterval(() => void update(), 1000);
    void update();
    toast(`Sprint started: ${minutes} minutes${goal ? `, goal ${goal} words` : ""}. Go!`);
    hooks.focusScript();
  }

  async function update() {
    if (!running) return;
    if (!hooks.open()) return stop(false);
    const now = running.paused ?? Date.now();
    const left = running.end - now;
    running.written = (await hooks.words().catch(() => running?.startWords ?? 0)) - running.startWords;
    if (!running) return;
    const goalText = running.goal ? ` · ${running.written}/${running.goal}` : ` · ${running.written} words`;
    chip.textContent = `${running.paused ? "⏸" : "⏱"} ${mmss(left)}${goalText}`;
    chip.setAttribute("aria-label", `Writing sprint: ${mmss(left)} left, ${running.written} words written`);
    if (running.paused) return;
    const total = running.minutes * 60_000;
    if (!running.halfway && left <= total / 2 && total >= 4 * 60_000) {
      running.halfway = true;
      toast(`Halfway there: ${running.written} words so far.`);
    }
    if (!running.lastMinute && left <= 60_000 && total > 60_000) {
      running.lastMinute = true;
      toast("One minute left.");
    }
    if (running.goal && running.written >= running.goal && !chip.classList.contains("goal-met")) {
      chip.classList.add("goal-met");
      toast(`Goal reached: ${running.written} words!`);
    }
    if (left <= 0) stop(true);
  }

  function stop(finished: boolean) {
    window.clearInterval(tick);
    const r = running;
    running = null;
    chip.hidden = true;
    chip.classList.remove("goal-met");
    if (!r || !finished) return;
    const minutes = r.minutes;
    const pace = Math.round(r.written / minutes);
    const close = el("button", { type: "button", id: "sprint-done", className: "primary" }, "Back to Writing");
    const again = el("button", { type: "button", id: "sprint-again" }, "Another Sprint");
    close.addEventListener("click", () => {
      dialog.close();
      hooks.focusScript();
    });
    again.addEventListener("click", () => {
      setup();
    });
    const met = r.goal ? (r.written >= r.goal ? `You beat your goal of ${r.goal}.` : `Goal was ${r.goal}; every word counts.`) : "";
    dialog.replaceChildren(
      el("h2", { id: "sprint-result" }, r.written > 0 ? "Sprint done. Well written!" : "Sprint done"),
      el("p", { className: "sprint-big" }, `${r.written} words in ${minutes} minutes`),
      el("p", { className: "form-note" }, `About ${pace} words a minute. ${met}`),
      el("div", { className: "dialog-actions" }, again, close),
    );
    if (!dialog.open) dialog.showModal();
    announce(`Sprint done: ${r.written} words in ${minutes} minutes`);
  }

  // The chip: a small menu of its own (pause or resume, finish now, cancel).
  chip.addEventListener("click", () => {
    if (!running) return;
    const r = running;
    const pause = el("button", { type: "button", id: "sprint-pause" }, r.paused ? "Resume" : "Pause");
    const finish = el("button", { type: "button", id: "sprint-finish" }, "Finish Now");
    const cancel = el("button", { type: "button", id: "sprint-stop" }, "Cancel Sprint");
    const back = el("button", { type: "button", className: "primary" }, "Keep Writing");
    pause.addEventListener("click", () => {
      if (!running) return;
      if (running.paused) {
        running.end += Date.now() - running.paused;
        running.paused = null;
      } else running.paused = Date.now();
      dialog.close();
      void update();
      hooks.focusScript();
    });
    finish.addEventListener("click", () => {
      if (running) running.end = Date.now();
      dialog.close();
      void update().then(() => stop(true));
    });
    cancel.addEventListener("click", () => {
      dialog.close();
      stop(false);
      announce("Sprint cancelled");
    });
    back.addEventListener("click", () => {
      dialog.close();
      hooks.focusScript();
    });
    dialog.replaceChildren(el("h2", {}, "Writing sprint"), el("p", {}, chip.textContent ?? ""), el("div", { className: "dialog-actions" }, cancel, finish, pause, back));
    dialog.showModal();
  });

  return {
    chip,
    open() {
      if (running) return chip.click();
      setup();
      dialog.showModal();
      (dialog.querySelector("#sprint-start") as HTMLElement | null)?.focus();
    },
    /** Start at once (tests). */
    begin,
    get state() {
      return running ? { ...running } : null;
    },
  };
}
