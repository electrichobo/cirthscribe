// Input-to-paint sampling. For each keydown in the editor: time from the
// event's timestamp to a task queued right after the next animation frame,
// which runs after that frame is painted. This measures inside the WebView
// only: OS input queueing and display scan-out are not included.

export interface PerfLog {
  samples: number[];
  longTasks: { start: number; duration: number }[];
  slowEvents: { name: string; duration: number }[];
  reset(): void;
  summary(): Record<string, number>;
}

export function installPerf(target: HTMLElement): PerfLog {
  const log: PerfLog = {
    samples: [],
    longTasks: [],
    slowEvents: [],
    reset() {
      this.samples = [];
      this.longTasks = [];
      this.slowEvents = [];
    },
    summary() {
      const s = [...this.samples].sort((a, b) => a - b);
      const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
      return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) ?? NaN, longTasks: this.longTasks.length, longestTask: Math.max(0, ...this.longTasks.map((t) => t.duration)) };
    },
  };
  target.addEventListener(
    "keydown",
    (e) => {
      const t0 = e.timeStamp;
      requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => log.samples.push(performance.now() - t0);
        ch.port2.postMessage(0);
      });
    },
    { capture: true },
  );
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) log.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) log.slowEvents.push({ name: e.name, duration: e.duration });
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    // Observer types unsupported in this WebView; samples still work.
  }
  return log;
}
