// End-to-end checks against the real app in WebView2, driven through the
// DevTools protocol. Key events go through Chromium's input pipeline
// (keydown/beforeinput/input), so ProseMirror sees them like typing. IME is
// simulated with Input.imeSetComposition; it is not a real OS input method.
//
// Usage: node tests/e2e.mjs <path-to-cirthscribe.exe> <results.json> [screens-dir]

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [exe, resultsPath, screensDir] = process.argv.slice(2);
const dataDir = mkdtempSync(join(tmpdir(), "cirth-e2e-"));
const results = { started: new Date().toISOString(), exe, dataDir, tests: [], measurements: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(port) {
  const child = spawn(exe, [], {
    // Own WebView2 profile per launch: isolated from the user's, and two
    // instances with different arguments cannot share one.
    env: { ...process.env, CIRTH_DATA_DIR: dataDir, WEBVIEW2_USER_DATA_FOLDER: join(dataDir, `wv-${port}`), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: "ignore",
  });
  return child;
}

async function connect(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return cdp(page.webSocketDebuggerUrl);
    } catch {}
    await sleep(200);
  }
  throw new Error("WebView2 debugging endpoint did not appear");
}

function cdp(url) {
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
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// --- input helpers ---------------------------------------------------------
const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
};
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

async function press(c, name, mods = [], extra = {}) {
  const k = KEYS[name] ?? { key: name, code: `Key${name.toUpperCase()}`, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) };
  const modifiers = mods.reduce((a, m) => a | MOD[m], 0);
  const text = modifiers & (MOD.ctrl | MOD.alt) ? undefined : k.text;
  await c.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, text, modifiers, ...extra });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
}

async function typeText(c, s, delayMs = 0) {
  for (const ch of s) {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    if (delayMs) await sleep(delayMs);
  }
}

const blocks = (c) => c.evaluate("__cirth.blocks()");
const text = (b) => b.runs.map((r) => r.text).join("");

async function waitSynced(c) {
  for (let i = 0; i < 100; i++) {
    if (await c.evaluate("!__cirth.syncer.hasUnsynced")) return;
    await sleep(100);
  }
  throw new Error("sync did not settle");
}

async function caretAtEndOf(c, index) {
  await c.evaluate(`(() => { const v = __cirth.view; let pos = 0, i = 0; v.state.doc.forEach((n, p) => { if (i++ === ${index}) pos = p + n.nodeSize - 1; });
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos))));
    v.focus(); return pos; })()`);
}

async function openFixture(c, name, reset = true) {
  await c.evaluate(`__cirth.open(${JSON.stringify(name)}, ${reset})`);
  await sleep(300);
}

async function storedMatchesEditor(c) {
  await c.evaluate("__cirth.flush()");
  await waitSynced(c);
  return c.evaluate("(async () => { const s = await __cirth.loadStored(); return JSON.stringify(s.blocks) === JSON.stringify(__cirth.blocks()); })()");
}

async function screenshot(c, name) {
  if (!screensDir) return;
  mkdirSync(screensDir, { recursive: true });
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(screensDir, `${name}.png`), Buffer.from(r.data, "base64"));
}

async function test(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.tests.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.tests.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String(e?.stack ?? e) });
    console.log(`FAIL ${name}: ${e}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function killTree(child) {
  try {
    execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
  } catch {}
}

function setClipboard(s) {
  execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value $env:CIRTH_CLIP"], { env: { ...process.env, CIRTH_CLIP: s } });
}
function getClipboard() {
  return execFileSync("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"]).toString("utf8").replace(/\r?\n$/, "");
}

// --- run -------------------------------------------------------------------
let app = launch(9333);
let c = await connect(9333);
for (let i = 0; i < 100 && !(await c.evaluate("!!(window.__cirth && __cirth.view && __cirth.lastOpen)").catch(() => false)); i++) await sleep(100);
results.measurements.userAgent = await c.evaluate("navigator.userAgent");
results.measurements.observerEntryTypes = await c.evaluate("PerformanceObserver.supportedEntryTypes");

// Regression for the M0 End-key defect. Root cause: Chromium reports native
// caret moves through an async "selectionchange"; while the main thread is
// busy, a following key (Enter) ran on ProseMirror's stale selection. Fix:
// app/src/selsync.ts adopts the DOM selection before every key command.
// This test must run first: it uses the app's own startup open, when the
// main thread is busiest.
await test("End then Enter right after startup acts on the visible caret", async () => {
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  await press(c, "Enter");
  await press(c, "Tab");
  await typeText(c, "Noor");
  await press(c, "Enter");
  await press(c, "Tab");
  await typeText(c, "softly");
  await press(c, "End");
  await press(c, "Enter");
  const b = await blocks(c);
  assert(text(b.at(-2)) === "(softly)" && b.at(-2).kind === "parenthetical", `parenthetical '${text(b.at(-2))}'`);
  assert(b.at(-1).kind === "dialogue" && text(b.at(-1)) === "", `new block ${b.at(-1).kind} '${text(b.at(-1))}'`);
  return { adoptedSelections: await c.evaluate("__cirth.selSync.adopted") };
});

await test("Tab/Enter: default cycle, no inserted spaces, one-step undo", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  await press(c, "Enter");
  let b = await blocks(c);
  assert(b.length === n0 + 1 && b.at(-1).kind === "action", `Enter after action -> ${b.at(-1).kind}`);
  await press(c, "Tab");
  b = await blocks(c);
  assert(b.at(-1).kind === "character" && text(b.at(-1)) === "", `Tab on empty action -> ${b.at(-1).kind} '${text(b.at(-1))}'`);
  await typeText(c, "Noor");
  await press(c, "Enter");
  b = await blocks(c);
  assert(b.at(-1).kind === "dialogue", `Enter after character -> ${b.at(-1).kind}`);
  await press(c, "Tab");
  b = await blocks(c);
  assert(b.at(-1).kind === "parenthetical" && text(b.at(-1)) === "()", `Tab on empty dialogue -> ${b.at(-1).kind} '${text(b.at(-1))}'`);
  await typeText(c, "softly");
  b = await blocks(c);
  assert(text(b.at(-1)) === "(softly)", `parenthetical text '${text(b.at(-1))}'`);
  // Caret to block end through the editor (native End right after typing is
  // covered by its own test below: it exposed an open defect).
  await caretAtEndOf(c, (await blocks(c)).length - 1);
  await press(c, "Enter");
  await typeText(c, "The tide is early.");
  b = await blocks(c);
  assert(b.at(-1).kind === "dialogue" && text(b.at(-1)) === "The tide is early.", `after parenthetical: ${b.at(-1).kind}`);
  await press(c, "Enter");
  b = await blocks(c);
  assert(b.at(-1).kind === "character", `Enter after dialogue -> ${b.at(-1).kind}`);
  await press(c, "Enter");
  b = await blocks(c);
  assert(b.at(-1).kind === "action" && b.length === n0 + 4, `Enter on empty character converts to action (got ${b.at(-1).kind}, ${b.length - n0} new)`);
  await typeText(c, "She waits.");
  await sleep(600); // new history group
  await press(c, "Tab", ["shift"]);
  b = await blocks(c);
  assert(b.at(-1).kind === "heading" && text(b.at(-1)) === "She waits.", `Shift+Tab on nonempty action -> ${b.at(-1).kind}`);
  const idBefore = b.at(-1).id;
  await press(c, "z", ["ctrl"]);
  b = await blocks(c);
  assert(b.at(-1).kind === "action" && text(b.at(-1)) === "She waits." && b.at(-1).id === idBefore, `undo restored ${b.at(-1).kind} '${text(b.at(-1))}'`);
  await press(c, "y", ["ctrl"]);
  b = await blocks(c);
  assert(b.at(-1).kind === "heading" && b.at(-1).scene_id, "redo re-applied heading with a scene id");
  // Configurable cycle.
  await c.evaluate("__cirth.keyConfig.set({ ...__cirth.keyConfig.defaults, tab: { ...__cirth.keyConfig.defaults.tab, heading: 'transition' } })");
  await press(c, "Tab");
  b = await blocks(c);
  assert(b.at(-1).kind === "transition", `custom cycle heading -> ${b.at(-1).kind}`);
  await c.evaluate("__cirth.keyConfig.set(__cirth.keyConfig.defaults)");
  assert(!text(b.at(-1)).includes("\t") && !/^ /.test(text(b.at(-1))), "no tab/space characters inserted");
  assert(await storedMatchesEditor(c), "stored document equals editor document");
  return { blocksAdded: b.length - n0 };
});

// Busy main thread (startup-like): background tasks of 40 ms every 50 ms.
async function caretKeyTrials(trials, enabled) {
  await openFixture(c, "unicode-marks");
  await c.evaluate(`__cirth.selSync.enabled = ${enabled}; window.__jank = setInterval(() => { const t = performance.now(); while (performance.now() - t < 40) {} }, 50)`);
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  let missed = 0;
  try {
    for (let t = 0; t < trials; t++) {
      await press(c, "Enter");
      await typeText(c, "abc");
      await press(c, "Home");
      await sleep(120); // let Home settle so only End can be stale
      await press(c, "End");
      await press(c, "Enter");
      const r = await c.evaluate("(() => { const b = __cirth.blocks(); const t = x => x.runs.map(r => r.text).join(''); return [t(b.at(-2)), t(b.at(-1))]; })()");
      if (r[0] !== "abc" || r[1] !== "") missed++;
      // Reset to a single empty block at the end for the next trial.
      await c.evaluate(`(() => { const v = __cirth.view; let p0 = 0; v.state.doc.forEach((n, p, i) => { if (i === ${n0}) p0 = p; });
        const tr = v.state.tr.delete(p0, v.state.doc.content.size); v.dispatch(tr); })()`);
      await caretAtEndOf(c, n0 - 1);
    }
  } finally {
    await c.evaluate("clearInterval(window.__jank); __cirth.selSync.enabled = true");
  }
  return missed;
}

await test("Stress: End then Enter under a busy main thread (500 trials, fix on; control with fix off)", async () => {
  const control = await caretKeyTrials(50, false);
  const fixed = await caretKeyTrials(500, true);
  results.measurements.caretKeyStress = { controlFixOff: `${control}/50 missed`, fixOn: `${fixed}/500 missed` };
  assert(fixed === 0, `fix on: ${fixed}/500 missed`);
  return { control: `${control}/50 missed with the fix off (shows whether the test detects the bug)`, fixed: `${fixed}/500 missed` };
});

await test("Selection across blocks, split/join, ids follow documented rules", async () => {
  await openFixture(c, "unicode-marks");
  const b0 = await blocks(c);
  // Select from the middle of block 1 (action) to the middle of block 3 (dialogue) and type.
  await c.evaluate(`(() => { const v = __cirth.view; const ps = []; v.state.doc.forEach((n, p) => ps.push(p));
    const from = ps[1] + 1 + 4, to = ps[3] + 1 + 6;
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, from, to))); v.focus(); })()`);
  await typeText(c, "X");
  let b = await blocks(c);
  assert(b.length === b0.length - 2, `joined: ${b0.length} -> ${b.length}`);
  assert(text(b[1]) === text(b0[1]).slice(0, 4) + "X" + text(b0[3]).slice(6), `joined text '${text(b[1])}'`);
  assert(b[1].id === b0[1].id, "joined block keeps the first block's id");
  await press(c, "z", ["ctrl"]);
  b = await blocks(c);
  assert(JSON.stringify(b) === JSON.stringify(b0), "undo restores all three blocks with original ids and marks");
  // Split in the middle: first half keeps id, second gets a new one, same kind.
  await c.evaluate(`(() => { const v = __cirth.view; const ps = []; v.state.doc.forEach((n, p) => ps.push(p));
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, ps[1] + 1 + 10))); v.focus(); })()`);
  await press(c, "Enter");
  b = await blocks(c);
  assert(b[1].id === b0[1].id && b[2].id !== b0[1].id && b[2].kind === "action", "split ids/kind");
  assert(text(b[1]) + text(b[2]) === text(b0[1]), "split preserves text");
  // Backspace at start of the second half joins back.
  await press(c, "Backspace");
  b = await blocks(c);
  assert(text(b[1]) === text(b0[1]) && b[1].id === b0[1].id, "join restores text and id");
  assert(await storedMatchesEditor(c), "stored equals editor");
});

await test("Paste: plain multi-line screenplay text, single line, HTML from another app", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  const plain = "EXT. HARBOR WALL - NIGHT\n\nWaves slap the stones.\nA lamp swings.\n\nINES\n(hoarse)\nWhere is the ferry?\n\nCUT TO:";
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(plain)});
    __cirth.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  let b = await blocks(c);
  const added = b.slice(n0);
  const kinds = added.map((x) => x.kind).join(",");
  assert(kinds === "heading,action,character,parenthetical,dialogue,transition", `kinds ${kinds}`);
  assert(text(added[1]) === "Waves slap the stones. A lamp swings.", `action join '${text(added[1])}'`);
  assert(added[0].scene_id, "pasted heading got a scene id");
  // Single line goes inline.
  await caretAtEndOf(c, b.length - 2);
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ' Please.');
    __cirth.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  b = await blocks(c);
  assert(text(b.at(-2)) === "Where is the ferry? Please.", `inline '${text(b.at(-2))}'`);
  // HTML from a word processor: paragraphs become action, bold survives.
  const n1 = b.length;
  await caretAtEndOf(c, n1 - 1);
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/html', '<meta charset=utf-8><p class=MsoNormal>Imported <b>bold</b> line</p><p>Second &amp; last</p>'); dt.setData('text/plain', 'Imported bold line\\n\\nSecond & last');
    __cirth.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  b = await blocks(c);
  const html = b.slice(n1 - 1);
  assert(html.some((x) => x.runs.some((r) => r.bold && r.text === "bold")), `bold kept: ${JSON.stringify(html)}`);
  assert(html.some((x) => text(x) === "Second & last" && x.kind === "action"), "second paragraph as action");
  // Copying a pasted heading and pasting it again must not duplicate ids.
  const ids = b.map((x) => x.id);
  assert(new Set(ids).size === ids.length, "unique ids");
  assert(await storedMatchesEditor(c), "stored equals editor");
  return { kinds };
});

await test("OS clipboard: native copy and paste commands through WebView2", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  setClipboard("KAITO\nThe clipboard came from Windows.");
  await caretAtEndOf(c, n0 - 1);
  await press(c, "v", ["ctrl"], { commands: ["paste"] });
  await sleep(200);
  let b = await blocks(c);
  const tail = b.slice(n0).map((x) => `${x.kind}:${text(x)}`);
  assert(tail.join("|") === "character:KAITO|dialogue:The clipboard came from Windows.", `pasted ${JSON.stringify(tail)}`);
  // Copy two blocks out.
  await c.evaluate(`(() => { const v = __cirth.view; const ps = []; v.state.doc.forEach((n, p) => ps.push([p, n.nodeSize]));
    const a = ps[${n0}][0] + 1, z = ps[${n0 + 1}][0] + ps[${n0 + 1}][1] - 1;
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, a, z))); v.focus(); })()`);
  await press(c, "c", ["ctrl"], { commands: ["copy"] });
  await sleep(200);
  const clip = getClipboard();
  assert(clip === "KAITO\n\nThe clipboard came from Windows." || clip === "KAITO\r\n\r\nThe clipboard came from Windows.", `clipboard ${JSON.stringify(clip)}`);
  return { clip };
});

await test("Unicode: accents, emoji ZWJ, combining marks, CJK, RTL typed and stored intact", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  await press(c, "Enter");
  const s = "Zoë ñ 👍🏽 👩‍👩‍👧 é 漢字 שלום مرحبا";
  await c.send("Input.insertText", { text: s });
  let b = await blocks(c);
  assert(text(b.at(-1)) === s, `typed '${text(b.at(-1))}'`);
  // One Backspace removes the whole family emoji? Record what Chromium does.
  await c.send("Input.insertText", { text: " 👩‍👩‍👧" });
  await press(c, "Backspace");
  b = await blocks(c);
  const after = text(b.at(-1));
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(after);
  assert(!lone, "no lone surrogates after Backspace");
  assert(await storedMatchesEditor(c), "stored equals editor (UTF-8 round trip through Rust/SQLite)");
  return { backspaceOverZwjFamily: after.endsWith(s + " ") ? "removed whole cluster" : `left '${after.slice(s.length)}'` };
});

await test("IME composition (simulated via CDP): no duplicate or lost characters", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  await press(c, "Enter");
  await typeText(c, "Say ");
  for (const t of ["に", "にほ", "にほん", "日本"]) await c.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
  await c.send("Input.insertText", { text: "日本" });
  await typeText(c, " ok");
  // Composition in the middle of existing text.
  await c.evaluate(`(() => { const v = __cirth.view; let p0 = 0; v.state.doc.forEach((n, p) => (p0 = p));
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, p0 + 1 + 3))); v.focus(); })()`);
  for (const t of ["か", "かん", "漢"]) await c.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
  await c.send("Input.insertText", { text: "漢" });
  await sleep(100);
  const b = await blocks(c);
  assert(text(b.at(-1)) === "Say漢 日本 ok", `composed '${text(b.at(-1))}'`);
  assert(await storedMatchesEditor(c), "stored equals editor");
  return { note: "Simulated composition events only; a real OS IME (Microsoft Japanese/Chinese/Korean) was not tested." };
});

await test("Navigator, board and editor show one scene; summary stays authored; structural toggle", async () => {
  await openFixture(c, "page-boundaries");
  const scenes = await c.evaluate("__cirth.scenes().map(s => ({ id: s.sceneId, heading: s.heading }))");
  assert(scenes.length === 4, `scenes ${scenes.length}`);
  const s0 = scenes[0];
  const dom = await c.evaluate(`(() => ({
    nav: [...document.querySelectorAll('#navigator li')].map(li => li.dataset.sceneId),
    cardText: document.querySelector('#board .card .card-link').textContent,
    editorHeading: document.querySelector('#editor p[data-scene-id="${s0.id}"]').textContent,
    editorCopies: document.querySelectorAll('#editor p[data-scene-id="${s0.id}"]').length }))()`);
  assert(dom.nav.join() === scenes.map((s) => s.id).join(), "navigator lists scenes by scene id in script order");
  assert(dom.cardText.endsWith(s0.heading) && dom.editorHeading === s0.heading && dom.editorCopies === 1, JSON.stringify(dom));
  // Edit the scene's action in the editor; the board excerpt follows, the beat summary does not.
  const beat0 = await c.evaluate(`__cirth.board.beats.find(b => b.scene_id === ${JSON.stringify(s0.id)})`);
  await caretAtEndOf(c, 1);
  await typeText(c, " LIVE-EDIT");
  await sleep(400);
  const card = await c.evaluate(`(() => { const el = document.querySelector('#board .card[data-beat-id="${beat0.id}"]'); return { excerpt: el.querySelector('.excerpt').textContent, summary: el.querySelector('.summary').value }; })()`);
  assert(card.excerpt.includes("LIVE-EDIT"), `excerpt '${card.excerpt}'`);
  assert(card.summary === beat0.summary, "summary unchanged");
  // Structural permission OFF: moving the card changes planning order only.
  const order0 = (await c.evaluate("__cirth.scenes().map(s => s.sceneId)")).join();
  await c.evaluate(`__cirth.setStructural(false)`);
  await c.evaluate(`__cirth.moveCard(${JSON.stringify(beat0.id)}, null)`);
  await sleep(200);
  assert((await c.evaluate("__cirth.scenes().map(s => s.sceneId)")).join() === order0, "script order unchanged with permission off");
  assert(await c.evaluate("document.querySelector('#board .badge').textContent") === "Planning only", "planning-only badge visible");
  // Structural permission ON: card move reorders the script exactly once; one undo restores.
  await c.evaluate(`__cirth.setStructural(true)`);
  const idsBefore = (await blocks(c)).map((b) => b.id).sort().join();
  const beat2 = await c.evaluate(`__cirth.board.beats.find(b => b.scene_id === ${JSON.stringify(scenes[2].id)})`);
  await c.evaluate(`__cirth.moveCard(${JSON.stringify(beat0.id)}, ${JSON.stringify(beat2.id)})`);
  await sleep(200);
  const moved = await c.evaluate("__cirth.scenes().map(s => s.sceneId)");
  assert(moved.join() === [scenes[1].id, scenes[0].id, scenes[2].id, scenes[3].id].join(), `moved order ${moved}`);
  assert((await blocks(c)).map((b) => b.id).sort().join() === idsBefore, "same block ids, no clones");
  assert(await storedMatchesEditor(c), "stored order equals editor order");
  await c.evaluate("__cirth.view.focus()");
  await press(c, "z", ["ctrl"]);
  assert((await c.evaluate("__cirth.scenes().map(s => s.sceneId)")).join() === order0, "one undo restores scene order");
  assert(await storedMatchesEditor(c), "stored order equals editor after undo");
  await c.evaluate(`__cirth.setStructural(false)`);
});

await test("Page markers come from the Rust page map; zoom does not change it", async () => {
  await openFixture(c, "page-boundaries");
  await c.evaluate("__cirth.repaginate()");
  const p1 = await c.evaluate("JSON.stringify(__cirth.pagination.map.page_starts)");
  const marks = await c.evaluate("document.querySelectorAll('#editor .page-mark').length");
  const pages = await c.evaluate("__cirth.pagination.map.pages.length");
  assert(marks === pages - 1, `markers ${marks} for ${pages} pages`);
  await c.evaluate("document.getElementById('editor').style.zoom = '150%'");
  await c.evaluate("__cirth.repaginate()");
  assert((await c.evaluate("JSON.stringify(__cirth.pagination.map.page_starts)")) === p1, "page map identical at 150% zoom");
  await screenshot(c, "page-boundaries-zoom150");
  await c.evaluate("document.getElementById('editor').style.zoom = '100%'");
  return { pages, inlineMarkers: await c.evaluate("document.querySelectorAll('#editor .page-mark.inline').length") };
});

await test("Long document: open, typing latency, autosave pauses, scene move", async () => {
  await openFixture(c, "long-120");
  const open = await c.evaluate("__cirth.openTimings");
  // Warm open: reopen the existing package (no reset).
  await openFixture(c, "long-120", false);
  const warm = await c.evaluate("__cirth.openTimings");
  await c.evaluate("__cirth.repaginate()");
  const pag = await c.evaluate("({ pages: __cirth.pagination.map.pages.length, layout_ms: __cirth.pagination.layout_ms, load_ms: __cirth.pagination.load_ms })");
  const nBlocks = (await blocks(c)).length;
  await caretAtEndOf(c, Math.floor(nBlocks / 2));
  await c.evaluate("__cirth.view.dispatch(__cirth.view.state.tr.scrollIntoView())");
  await sleep(300);
  await c.evaluate("__cirth.perf.reset()");
  const sentence = "The ledger has been rewritten in a careful second hand. ";
  await typeText(c, (sentence + sentence + sentence + sentence + sentence).slice(0, 300), 25);
  for (let i = 0; i < 10; i++) {
    await press(c, "Enter");
    await press(c, "Tab");
    await typeText(c, "Margit", 25);
    await press(c, "Enter");
    await typeText(c, "Count it again.", 25);
    await press(c, "Enter");
  }
  await c.evaluate("__cirth.flush()");
  await waitSynced(c);
  await sleep(1200);
  const summary = await c.evaluate("__cirth.perf.summary()");
  const longTasks = await c.evaluate("__cirth.perf.longTasks");
  const sync = await c.evaluate("({ batches: __cirth.syncer.stats.batches, ops: __cirth.syncer.stats.ops, lastDiffMs: __cirth.syncer.stats.lastDiffMs, roundTrips: __cirth.syncer.stats.roundTrips })");
  const rt = [...sync.roundTrips].sort((a, b) => a - b);
  // Move the first scene to the end through the navigator command.
  const sc = await c.evaluate("__cirth.scenes().map(s => s.sceneId)");
  const t0 = await c.evaluate("performance.now()");
  await c.evaluate(`__cirth.moveScene(${JSON.stringify(sc[0])}, null)`);
  const t1 = await c.evaluate("performance.now()");
  await c.evaluate("__cirth.flush()");
  await waitSynced(c);
  const t2 = await c.evaluate("performance.now()");
  const after = await c.evaluate("__cirth.scenes().map(s => s.sceneId)");
  assert(after.at(-1) === sc[0] && after.length === sc.length, "scene moved to end once");
  assert(await storedMatchesEditor(c), "stored equals editor after long-doc edits");
  await screenshot(c, "long-120");
  const m = {
    blocks: nBlocks,
    coldOpen: open,
    warmOpen: warm,
    pagination: pag,
    inputToPaint: summary,
    longTasks,
    sync: { batches: sync.batches, ops: sync.ops, lastDiffMs: sync.lastDiffMs, roundTripP50: rt[Math.floor(rt.length / 2)], roundTripMax: rt.at(-1) },
    sceneMove: { editorMs: t1 - t0, storeCommitMs: t2 - t1 },
  };
  results.measurements.longDocument = m;
  return m;
});

// Crash/recovery: kill the app process tree after an acknowledged store commit.
await test("Crash after acknowledged commit: reopen recovers it; unacknowledged keystrokes are not claimed", async () => {
  await openFixture(c, "unicode-marks");
  const n0 = (await blocks(c)).length;
  await caretAtEndOf(c, n0 - 1);
  await press(c, "Enter");
  await typeText(c, "ACKED-MARKER");
  await c.evaluate("__cirth.flush()");
  await waitSynced(c);
  const v = await c.evaluate("__cirth.syncer.currentVersion");
  // Type more and kill before the debounce fires.
  await typeText(c, " UNACKED");
  killTree(app);
  c.close();
  await sleep(1500);
  app = launch(9334);
  c = await connect(9334);
  for (let i = 0; i < 100 && !(await c.evaluate("!!(window.__cirth && __cirth.lastOpen)").catch(() => false)); i++) await sleep(100);
  const lo = await c.evaluate("__cirth.lastOpen");
  const b = await blocks(c);
  assert(lo.recovered === true, "recovery detected");
  assert(text(b.at(-1)) === "ACKED-MARKER", `last block '${text(b.at(-1))}'`);
  assert(lo.doc.version === v, `version ${lo.doc.version} vs acked ${v}`);
  const bannerText = await c.evaluate("document.getElementById('banner').textContent");
  assert(/Recovered unsaved work/.test(bannerText), `recovery banner '${bannerText}'`);
  await screenshot(c, "recovered");
  // Save the package, kill again: reopen is clean, not a recovery.
  await c.evaluate("document.getElementById('save').click()");
  await sleep(500);
  killTree(app);
  c.close();
  await sleep(1500);
  app = launch(9335);
  c = await connect(9335);
  for (let i = 0; i < 100 && !(await c.evaluate("!!(window.__cirth && __cirth.lastOpen)").catch(() => false)); i++) await sleep(100);
  const lo2 = await c.evaluate("__cirth.lastOpen");
  assert(lo2.recovered === false && text((await blocks(c)).at(-1)) === "ACKED-MARKER", "clean reopen after package save");
  return { banner: bannerText, window: "Edits are durable once acknowledged: after 300 ms idle, or at most 1.5 s into continuous typing, plus the commit round trip." };
});

await test("Second app instance cannot open the same project for writing", async () => {
  const second = launch(9336);
  const c2 = await connect(9336);
  let banner = "";
  for (let i = 0; i < 50; i++) {
    banner = await c2.evaluate("document.getElementById('banner').textContent").catch(() => "");
    if (banner) break;
    await sleep(100);
  }
  await screenshot(c2, "second-writer");
  c2.close();
  killTree(second);
  assert(/another CirthScribe window or process/.test(banner), `banner '${banner}'`);
  // First instance still works.
  assert(await storedMatchesEditor(c), "first instance unaffected");
  return { banner };
});

await test("PDF proof export from the canonical store", async () => {
  await openFixture(c, "page-boundaries", false);
  await c.evaluate("document.getElementById('pdf').click()");
  let banner = "";
  for (let i = 0; i < 50 && !/PDF proof/.test(banner); i++) {
    await sleep(100);
    banner = await c.evaluate("document.getElementById('banner').textContent");
  }
  assert(/PDF proof \(not production-ready\) written/.test(banner), banner);
  results.measurements.pdfBanner = banner;
  return { banner };
});

killTree(app);
c.close();
results.finished = new Date().toISOString();
writeFileSync(resultsPath, JSON.stringify(results, null, 2));
const counted = results.tests.filter((t) => !t.knownDefect);
const failed = counted.filter((t) => !t.ok).length;
console.log(`${counted.length - failed}/${counted.length} passed; ${results.tests.length - counted.length} known-defect probe(s) recorded`);
process.exit(failed ? 1 : 0);
