// DevTools-protocol driver: WebView2 (Windows) only. Key events enter
// Chromium's input pipeline like typing; IME can be simulated.

import { spawn } from "node:child_process";
import { join } from "node:path";
import { hardKill, sleep } from "../platform.mjs";

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
};
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const NATIVE_COMMAND = { v: "paste", c: "copy", x: "cut" };

function connectWs(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  };
  return { send, close: () => ws.close() };
}

let nextPort = 9333;

export function createDriver({ exe, dataDir }) {
  return {
    name: "cdp",
    capabilities: { ime: true, insertText: true },
    async launch(label) {
      const port = nextPort++;
      const child = spawn(exe, [], {
        env: { ...process.env, CIRTH_DATA_DIR: dataDir, WEBVIEW2_USER_DATA_FOLDER: join(dataDir, `wv-${label}-${port}`), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let exited = null;
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("exit", (code, signal) => (exited = { code, signal }));
      let c;
      let lastError = "";
      // Up to 90 s: WebView2's first start on a fresh CI runner can be slow.
      for (let i = 0; i < 450 && !c && !exited; i++) {
        try {
          const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
          if (page) c = connectWs(page.webSocketDebuggerUrl);
        } catch (e) {
          lastError = String(e?.cause?.code ?? e);
        }
        if (!c) await sleep(200);
      }
      if (!c) {
        hardKill(child.pid);
        throw new Error(
          `WebView2 debugging endpoint did not appear on port ${port}; app ${exited ? `exited (${JSON.stringify(exited)})` : "still running"}; last fetch error: ${lastError}; app output: ${output.slice(-1500) || "(none)"}`,
        );
      }
      const evaluate = async (expr) => {
        const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      return {
        evaluate,
        async press(name, mods = []) {
          const k = KEYS[name] ?? { key: name, code: `Key${name.toUpperCase()}`, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) };
          const modifiers = mods.reduce((a, m) => a | MOD[m], 0);
          const text = modifiers & (MOD.ctrl | MOD.alt | MOD.meta) ? undefined : k.text;
          // Clipboard shortcuts need the editing command on synthetic events.
          const commands = modifiers & (MOD.ctrl | MOD.meta) && NATIVE_COMMAND[name] ? [NATIVE_COMMAND[name]] : undefined;
          await c.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, text, modifiers, commands });
          await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
        },
        async type(s, delayMs = 0) {
          for (const ch of s) {
            await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
            await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
            if (delayMs) await sleep(delayMs);
          }
        },
        insertText: (s) => c.send("Input.insertText", { text: s }),
        async imeCompose(steps, commit) {
          for (const t of steps) await c.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
          await c.send("Input.insertText", { text: commit });
        },
        async screenshot() {
          return Buffer.from((await c.send("Page.captureScreenshot", { format: "png" })).data, "base64");
        },
        async kill() {
          const pid = await evaluate("__cirth.pid()").catch(() => child.pid);
          hardKill(pid);
          hardKill(child.pid);
          c.close();
        },
        async close() {
          c.close();
          hardKill(child.pid);
        },
      };
    },
    async shutdown() {},
  };
}
