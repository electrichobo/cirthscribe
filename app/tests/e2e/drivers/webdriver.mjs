// W3C WebDriver driver through tauri-driver: WebView2 via msedgedriver on
// Windows, WebKitGTK via WebKitWebDriver on Linux. (macOS WKWebView has no
// WebDriver; see docs/testing/MACOS_MANUAL.md.)
//
// One tauri-driver process per app instance, because the app inherits its
// environment (data folder, WebView profile) from the driver.
// Evaluated expressions run as WebDriver scripts, which are not subject to
// the page's CSP; they must be expressions (use an IIFE for statements).

import { spawn } from "node:child_process";
import { join, delimiter } from "node:path";
import { hardKill, sleep } from "../platform.mjs";

const KEY = {
  Enter: "",
  Tab: "",
  Backspace: "",
  Escape: "",
  ArrowLeft: "",
  ArrowRight: "",
  End: "",
  Home: "",
};
const MODKEY = { shift: "", ctrl: "", alt: "", meta: "" };

let nextPort = 4444;

export function createDriver({ exe, dataDir, nativeDriverDir }) {
  const drivers = [];
  return {
    name: "webdriver",
    // No simulated composition in WebDriver; text beyond single key presses
    // goes through execCommand('insertText').
    capabilities: { ime: false, insertText: false },
    async launch(label) {
      const port = nextPort;
      nextPort += 2;
      const env = { ...process.env, CIRTH_DATA_DIR: dataDir, WEBVIEW2_USER_DATA_FOLDER: join(dataDir, `wv-${label}-${port}`) };
      if (nativeDriverDir) env.PATH = `${nativeDriverDir}${delimiter}${env.PATH ?? env.Path ?? ""}`;
      const driver = spawn("tauri-driver", ["--port", String(port), "--native-port", String(port + 1)], { env, stdio: "ignore" });
      drivers.push(driver);
      const base = `http://127.0.0.1:${port}`;
      const call = async (method, path, body) => {
        const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.value?.error) throw new Error(`${method} ${path}: ${JSON.stringify(j.value ?? j).slice(0, 400)}`);
        return j.value;
      };
      let session;
      for (let i = 0; i < 100 && !session; i++) {
        try {
          session = (await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: exe } } } })).sessionId;
        } catch (e) {
          if (i === 99) throw e;
          await sleep(200);
        }
      }
      const s = `/session/${session}`;
      const evaluate = async (expr) => {
        const script = `const done = arguments[arguments.length - 1];
          Promise.resolve().then(async () => (${expr})).then(
            (v) => done({ ok: v === undefined ? null : v }),
            (e) => done({ err: String((e && e.stack) || e) }));`;
        const r = await call("POST", `${s}/execute/async`, { script, args: [] });
        if (r && "err" in r) throw new Error(r.err);
        return r?.ok;
      };
      const actions = (keyActions) => call("POST", `${s}/actions`, { actions: [{ type: "key", id: "kb", actions: keyActions }] });
      return {
        evaluate,
        async press(name, mods = []) {
          const k = KEY[name] ?? name;
          const down = mods.map((m) => ({ type: "keyDown", value: MODKEY[m] }));
          const up = [...mods].reverse().map((m) => ({ type: "keyUp", value: MODKEY[m] }));
          await actions([...down, { type: "keyDown", value: k }, { type: "keyUp", value: k }, ...up]);
        },
        async type(text, delayMs = 0) {
          const seq = [];
          for (const ch of text) {
            seq.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
            if (delayMs) seq.push({ type: "pause", duration: delayMs });
          }
          await actions(seq);
        },
        insertText: (text) => evaluate(`document.execCommand("insertText", false, ${JSON.stringify(text)})`),
        imeCompose() {
          throw new Error("IME composition is not available through WebDriver");
        },
        async screenshot() {
          return Buffer.from(await call("GET", `${s}/screenshot`), "base64");
        },
        async kill() {
          const pid = await evaluate("__cirth.pid()").catch(() => null);
          if (pid) hardKill(pid);
          await call("DELETE", s).catch(() => {});
          hardKill(driver.pid);
        },
        async close() {
          await call("DELETE", s).catch(() => {});
          hardKill(driver.pid);
        },
      };
    },
    async shutdown() {
      for (const d of drivers) hardKill(d.pid);
    },
  };
}
