// Ad-hoc probe: launch the app with DevTools enabled and evaluate snippets.
// Usage: node tests/debug.mjs <exe> <snippet-file.js>
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [exe, snippet] = process.argv.slice(2);
const dataDir = mkdtempSync(join(tmpdir(), "cirth-debug-"));
const port = 9350;
const app = spawn(exe, [], { env: { ...process.env, CIRTH_DATA_DIR: dataDir, WEBVIEW2_USER_DATA_FOLDER: join(dataDir, "wv"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url;
for (let i = 0; i < 100 && !url; i++) {
  try {
    url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(url);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
for (let i = 0; i < 100 && !(await evaluate("!!(window.__cirth && __cirth.lastOpen)")).result?.value; i++) await sleep(100);
const fn = new Function("send", "evaluate", "sleep", "execFileSync", `return (async () => { ${readFileSync(snippet, "utf8")} })()`);
try {
  console.log(JSON.stringify(await fn(send, evaluate, sleep, execFileSync), null, 2));
} finally {
  execFileSync("taskkill", ["/F", "/T", "/PID", String(app.pid)], { stdio: "ignore" });
  ws.close();
}
