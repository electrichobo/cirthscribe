// Help > Typing Latency: shows the editor's own input-to-paint samples
// (perf.ts) and the last open time as copyable text, so a tester on any OS can
// report them without developer tools. Measures inside the WebView only.

import { getVersion } from "@tauri-apps/api/app";
import type { PerfLog } from "./perf";

const TARGET_P95_MS = 50;
const ENOUGH = 200;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export interface OpenTimings {
  totalMs: number;
  blocks: number;
}

export function createLatency(perf: PerfLog, openTimings: () => OpenTimings | undefined, docInfo: () => string) {
  const dialog = el("dialog", { className: "about latency", id: "latency-dialog" });
  dialog.setAttribute("aria-label", "Typing latency");
  document.body.append(dialog);
  let version = "";

  function report(): string {
    const s = perf.summary();
    const ms = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} ms` : "n/a");
    const verdict = s.n < ENOUGH ? `not enough key presses yet (${s.n} of ${ENOUGH})` : s.p95 < TARGET_P95_MS ? `within the M1 target (p95 < ${TARGET_P95_MS} ms)` : `OVER the M1 target (p95 < ${TARGET_P95_MS} ms)`;
    const o = openTimings();
    return [
      `CirthScribe ${version} typing latency`,
      `Date: ${new Date().toISOString()}`,
      `System: ${navigator.userAgent}`,
      `Screen: ${screen.width}x${screen.height} at ${devicePixelRatio}x, window ${innerWidth}x${innerHeight}`,
      `Document: ${docInfo()}`,
      ``,
      `Key presses measured: ${s.n}`,
      `Median: ${ms(s.p50)}  p95: ${ms(s.p95)}  p99: ${ms(s.p99)}  max: ${ms(s.max)}`,
      `Long tasks (> 50 ms): ${s.longTasks}${s.longTasks ? `, longest ${ms(s.longestTask)}` : ""}`,
      `Result: ${verdict}`,
      `Last open: ${o ? `${ms(o.totalMs)} for ${o.blocks} blocks (target < 3000 ms)` : "n/a"}`,
      ``,
      `Measured from each key press in the script to the next painted frame, inside the app. Keyboard and display delay are not included.`,
    ].join("\n");
  }

  function show() {
    const text = el("textarea", { className: "about-text latency-text", readOnly: true, rows: 14, value: report() });
    text.setAttribute("aria-label", "Typing latency report");
    const note = el("p", { className: "latency-note" });
    note.setAttribute("aria-live", "polite");
    const button = (id: string, label: string, fn: () => void) => {
      const b = el("button", { type: "button", id }, label);
      b.addEventListener("click", fn);
      return b;
    };
    const copy = button("latency-copy", "Copy", async () => {
      try {
        await navigator.clipboard.writeText(text.value);
        note.textContent = "Copied.";
      } catch {
        text.focus();
        text.select();
        note.textContent = "Selected; press Ctrl+C (Cmd+C on a Mac) to copy.";
      }
    });
    const refresh = button("latency-refresh", "Refresh", () => {
      text.value = report();
      note.textContent = "Updated.";
    });
    const reset = button("latency-reset", "Start over", () => {
      perf.reset();
      text.value = report();
      note.textContent = "Samples cleared. Type in the script, then reopen or refresh this.";
    });
    const close = button("latency-close", "Close", () => dialog.close());
    dialog.replaceChildren(
      el("h2", {}, "Typing latency"),
      el(
        "p",
        {},
        "For a speed check: open the sample “The Tide Ledger” (127 pages), click in the middle, type normally for at least 30 seconds, then open this again and copy the report. Only typing in the script is measured.",
      ),
      text,
      note,
      el("div", { className: "dialog-actions" }, reset, refresh, copy, close),
    );
  }

  async function open() {
    version ||= await getVersion().catch(() => "?");
    show();
    if (!dialog.open) dialog.showModal();
  }

  return { open, close: () => dialog.close(), report };
}
