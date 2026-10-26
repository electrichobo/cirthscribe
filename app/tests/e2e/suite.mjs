// The end-to-end suite, independent of the automation driver. Every test
// talks to the app through: evaluate, press, type, insertText, imeCompose,
// screenshot, kill, close. Tests that a driver or machine cannot perform
// honestly throw Skip with the reason; skips are reported, never counted as
// passes.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MOD_KEY, Skip, clipboardTool, sleep } from "./platform.mjs";

export async function runSuite({ driver, results, screensDir }) {
  const text = (b) => b.runs.map((r) => r.text).join("");
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  async function waitOpen(app) {
    for (let i = 0; i < 150; i++) {
      if (await app.evaluate("!!(window.__cirth && __cirth.view && __cirth.lastOpen)").catch(() => false)) return;
      await sleep(100);
    }
    throw new Error("app did not finish opening");
  }

  let app = await driver.launch("main");
  await waitOpen(app);
  results.measurements.userAgent = await app.evaluate("navigator.userAgent");
  results.measurements.observerEntryTypes = await app.evaluate("PerformanceObserver.supportedEntryTypes");

  const blocks = () => app.evaluate("__cirth.blocks()");
  const press = (k, mods) => app.press(k, mods);
  const typeText = (s, d) => app.type(s, d);
  const waitSynced = async () => {
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate("!__cirth.syncer.hasUnsynced")) return;
      await sleep(100);
    }
    throw new Error("sync did not settle");
  };
  const caretAtEndOf = (index) =>
    app.evaluate(`(() => { const v = __cirth.view; let pos = 0, i = 0; v.state.doc.forEach((n, p) => { if (i++ === ${index}) pos = p + n.nodeSize - 1; });
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos)))); v.focus(); return pos; })()`);
  const setCaret = (expr) =>
    app.evaluate(`(() => { const v = __cirth.view; const ps = []; v.state.doc.forEach((n, p) => ps.push([p, n.nodeSize]));
      const [a, z] = (${expr}); v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, a, z ?? a))); v.focus(); })()`);
  const openFixture = async (name, reset = true) => {
    await app.evaluate(`__cirth.open(${JSON.stringify(name)}, ${reset})`);
    await sleep(300);
  };
  const storedMatchesEditor = async () => {
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    return app.evaluate("(async () => { const s = await __cirth.loadStored(); return JSON.stringify(s.blocks) === JSON.stringify(__cirth.blocks()); })()");
  };
  const pasteEvent = (data) =>
    app.evaluate(`(() => { const dt = new DataTransfer(); const d = ${JSON.stringify(data)}; for (const k in d) dt.setData(k, d[k]);
      __cirth.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
  const screenshot = async (target, name) => {
    if (!screensDir) return;
    mkdirSync(screensDir, { recursive: true });
    writeFileSync(join(screensDir, `${name}.png`), await target.screenshot());
  };

  async function test(name, fn) {
    const t0 = performance.now();
    try {
      const detail = await fn();
      results.tests.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail });
      console.log(`PASS ${name}`);
    } catch (e) {
      if (e instanceof Skip) {
        results.tests.push({ name, skipped: true, reason: e.message });
        console.log(`SKIP ${name}: ${e.message}`);
      } else {
        results.tests.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String(e?.stack ?? e) });
        console.log(`FAIL ${name}: ${e}`);
      }
    }
  }

  // Must run first: it uses the app's own startup open, when the main thread
  // is busiest (regression for the End-key selection race, FINDINGS defect 1).
  await test("End then Enter right after startup acts on the visible caret", async () => {
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await press("Tab");
    await typeText("Noor");
    await press("Enter");
    await press("Tab");
    await typeText("softly");
    await press("End");
    await press("Enter");
    const b = await blocks();
    assert(text(b.at(-2)) === "(softly)" && b.at(-2).kind === "parenthetical", `parenthetical '${text(b.at(-2))}'`);
    assert(b.at(-1).kind === "dialogue" && text(b.at(-1)) === "", `new block ${b.at(-1).kind} '${text(b.at(-1))}'`);
    return { adoptedSelections: await app.evaluate("__cirth.selSync.adopted") };
  });

  await test("Tab/Enter: default cycle, no inserted spaces, one-step undo", async () => {
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    let b = await blocks();
    assert(b.length === n0 + 1 && b.at(-1).kind === "action", `Enter after action -> ${b.at(-1).kind}`);
    await press("Tab");
    b = await blocks();
    assert(b.at(-1).kind === "character" && text(b.at(-1)) === "", `Tab on empty action -> ${b.at(-1).kind} '${text(b.at(-1))}'`);
    await typeText("Noor");
    await press("Enter");
    b = await blocks();
    assert(b.at(-1).kind === "dialogue", `Enter after character -> ${b.at(-1).kind}`);
    await press("Tab");
    b = await blocks();
    assert(b.at(-1).kind === "parenthetical" && text(b.at(-1)) === "()", `Tab on empty dialogue -> ${b.at(-1).kind} '${text(b.at(-1))}'`);
    await typeText("softly");
    b = await blocks();
    assert(text(b.at(-1)) === "(softly)", `parenthetical text '${text(b.at(-1))}'`);
    await press("End");
    await press("Enter");
    await typeText("The tide is early.");
    b = await blocks();
    assert(b.at(-1).kind === "dialogue" && text(b.at(-1)) === "The tide is early.", `after parenthetical: ${b.at(-1).kind}`);
    await press("Enter");
    b = await blocks();
    assert(b.at(-1).kind === "character", `Enter after dialogue -> ${b.at(-1).kind}`);
    await press("Enter");
    b = await blocks();
    assert(b.at(-1).kind === "action" && b.length === n0 + 4, `Enter on empty character converts to action (got ${b.at(-1).kind}, ${b.length - n0} new)`);
    await typeText("She waits.");
    await sleep(600); // new history group
    await press("Tab", ["shift"]);
    b = await blocks();
    assert(b.at(-1).kind === "heading" && text(b.at(-1)) === "She waits.", `Shift+Tab on nonempty action -> ${b.at(-1).kind}`);
    const idBefore = b.at(-1).id;
    await press("z", [MOD_KEY]);
    b = await blocks();
    assert(b.at(-1).kind === "action" && text(b.at(-1)) === "She waits." && b.at(-1).id === idBefore, `undo restored ${b.at(-1).kind} '${text(b.at(-1))}'`);
    await press("z", [MOD_KEY, "shift"]);
    b = await blocks();
    assert(b.at(-1).kind === "heading" && b.at(-1).scene_id, "redo re-applied heading with a scene id");
    await app.evaluate("__cirth.keyConfig.set({ ...__cirth.keyConfig.defaults, tab: { ...__cirth.keyConfig.defaults.tab, heading: 'transition' } })");
    await press("Tab");
    b = await blocks();
    assert(b.at(-1).kind === "transition", `custom cycle heading -> ${b.at(-1).kind}`);
    await app.evaluate("__cirth.keyConfig.set(__cirth.keyConfig.defaults)");
    assert(!text(b.at(-1)).includes("\t") && !/^ /.test(text(b.at(-1))), "no tab/space characters inserted");
    assert(await storedMatchesEditor(), "stored document equals editor document");
    return { blocksAdded: b.length - n0 };
  });

  // Busy main thread (startup-like): background tasks of 40 ms every 50 ms.
  async function caretKeyTrials(trials, enabled) {
    await openFixture("unicode-marks");
    await app.evaluate(`(() => { __cirth.selSync.enabled = ${enabled}; window.__jank = setInterval(() => { const t = performance.now(); while (performance.now() - t < 40) {} }, 50); })()`);
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    let missed = 0;
    try {
      for (let t = 0; t < trials; t++) {
        await press("Enter");
        await typeText("abc");
        await press("Home");
        await sleep(120); // let Home settle so only End can be stale
        await press("End");
        await press("Enter");
        const r = await app.evaluate("(() => { const b = __cirth.blocks(); const t = x => x.runs.map(r => r.text).join(''); return [t(b.at(-2)), t(b.at(-1))]; })()");
        if (r[0] !== "abc" || r[1] !== "") missed++;
        await app.evaluate(`(() => { const v = __cirth.view; let p0 = 0; v.state.doc.forEach((n, p, i) => { if (i === ${n0}) p0 = p; });
          v.dispatch(v.state.tr.delete(p0, v.state.doc.content.size)); })()`);
        await caretAtEndOf(n0 - 1);
      }
    } finally {
      await app.evaluate("(() => { clearInterval(window.__jank); __cirth.selSync.enabled = true; })()");
    }
    return missed;
  }

  await test("Stress: End then Enter under a busy main thread (500 trials, fix on; control with fix off)", async () => {
    const control = await caretKeyTrials(50, false);
    const fixed = await caretKeyTrials(500, true);
    results.measurements.caretKeyStress = { controlFixOff: `${control}/50 missed`, fixOn: `${fixed}/500 missed` };
    assert(fixed === 0, `fix on: ${fixed}/500 missed`);
    return { control: `${control}/50 missed with the fix off (shows whether the test detects the bug here)`, fixed: `${fixed}/500 missed` };
  });

  await test("Selection across blocks, split/join, ids follow documented rules", async () => {
    await openFixture("unicode-marks");
    const b0 = await blocks();
    await setCaret("[ps[1][0] + 1 + 4, ps[3][0] + 1 + 6]");
    await typeText("X");
    let b = await blocks();
    assert(b.length === b0.length - 2, `joined: ${b0.length} -> ${b.length}`);
    assert(text(b[1]) === text(b0[1]).slice(0, 4) + "X" + text(b0[3]).slice(6), `joined text '${text(b[1])}'`);
    assert(b[1].id === b0[1].id, "joined block keeps the first block's id");
    await press("z", [MOD_KEY]);
    b = await blocks();
    assert(JSON.stringify(b) === JSON.stringify(b0), "undo restores all three blocks with original ids and marks");
    await setCaret("[ps[1][0] + 1 + 10]");
    await press("Enter");
    b = await blocks();
    assert(b[1].id === b0[1].id && b[2].id !== b0[1].id && b[2].kind === "action", "split ids/kind");
    assert(text(b[1]) + text(b[2]) === text(b0[1]), "split preserves text");
    await press("Backspace");
    b = await blocks();
    assert(text(b[1]) === text(b0[1]) && b[1].id === b0[1].id, "join restores text and id");
    assert(await storedMatchesEditor(), "stored equals editor");
  });

  await test("Paste: plain multi-line screenplay text, single line, HTML from another app", async () => {
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await pasteEvent({ "text/plain": "EXT. HARBOR WALL - NIGHT\n\nWaves slap the stones.\nA lamp swings.\n\nINES\n(hoarse)\nWhere is the ferry?\n\nCUT TO:" });
    let b = await blocks();
    const added = b.slice(n0);
    const kinds = added.map((x) => x.kind).join(",");
    assert(kinds === "heading,action,character,parenthetical,dialogue,transition", `kinds ${kinds}`);
    assert(text(added[1]) === "Waves slap the stones. A lamp swings.", `action join '${text(added[1])}'`);
    assert(added[0].scene_id, "pasted heading got a scene id");
    await caretAtEndOf(b.length - 2);
    await pasteEvent({ "text/plain": " Please." });
    b = await blocks();
    assert(text(b.at(-2)) === "Where is the ferry? Please.", `inline '${text(b.at(-2))}'`);
    const n1 = b.length;
    await caretAtEndOf(n1 - 1);
    await pasteEvent({ "text/html": "<meta charset=utf-8><p class=MsoNormal>Imported <b>bold</b> line</p><p>Second &amp; last</p>", "text/plain": "Imported bold line\n\nSecond & last" });
    b = await blocks();
    const html = b.slice(n1 - 1);
    assert(html.some((x) => x.runs.some((r) => r.bold && r.text === "bold")), `bold kept: ${JSON.stringify(html)}`);
    assert(html.some((x) => text(x) === "Second & last" && x.kind === "action"), "second paragraph as action");
    const ids = b.map((x) => x.id);
    assert(new Set(ids).size === ids.length, "unique ids");
    assert(await storedMatchesEditor(), "stored equals editor");
    return { kinds };
  });

  await test("OS clipboard: native copy and paste shortcuts", async () => {
    const clip = clipboardTool();
    if (!clip) throw new Skip("no clipboard tool on this machine (install xclip on Linux)");
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    clip.set("KAITO\nThe clipboard came from the OS.");
    await caretAtEndOf(n0 - 1);
    await press("v", [MOD_KEY]);
    await sleep(300);
    const b = await blocks();
    const tail = b.slice(n0).map((x) => `${x.kind}:${text(x)}`);
    assert(tail.join("|") === "character:KAITO|dialogue:The clipboard came from the OS.", `pasted ${JSON.stringify(tail)}`);
    await setCaret(`[ps[${n0}][0] + 1, ps[${n0 + 1}][0] + ps[${n0 + 1}][1] - 1]`);
    await press("c", [MOD_KEY]);
    await sleep(300);
    const out = clip.get().replace(/\r\n/g, "\n");
    assert(out === "KAITO\n\nThe clipboard came from the OS.", `clipboard ${JSON.stringify(out)}`);
    return { clip: out };
  });

  await test("Unicode: accents, emoji ZWJ, combining marks, CJK, RTL inserted and stored intact", async () => {
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    const s = "Zoë ñ 👍🏽 👩‍👩‍👧 é 漢字 שלום مرحبا";
    await app.insertText(s);
    let b = await blocks();
    assert(text(b.at(-1)) === s, `inserted '${text(b.at(-1))}'`);
    await app.insertText(" 👩‍👩‍👧");
    await press("Backspace");
    b = await blocks();
    const after = text(b.at(-1));
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(after);
    assert(!lone, "no lone surrogates after Backspace");
    assert(await storedMatchesEditor(), "stored equals editor (UTF-8 round trip through Rust/SQLite)");
    return {
      insertedVia: driver.capabilities.insertText ? "Input.insertText" : "execCommand('insertText')",
      backspaceOverZwjFamily: after.endsWith(s + " ") ? "removed whole cluster" : `left '${after.slice(s.length)}'`,
    };
  });

  await test("IME composition (simulated): no duplicate or lost characters", async () => {
    if (!driver.capabilities.ime) throw new Skip(`${driver.name} driver cannot simulate composition; use the manual IME checklist`);
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("Say ");
    await app.imeCompose(["に", "にほ", "にほん", "日本"], "日本");
    await typeText(" ok");
    await setCaret("[ps.at(-1)[0] + 1 + 3]");
    await app.imeCompose(["か", "かん", "漢"], "漢");
    await sleep(100);
    const b = await blocks();
    assert(text(b.at(-1)) === "Say漢 日本 ok", `composed '${text(b.at(-1))}'`);
    assert(await storedMatchesEditor(), "stored equals editor");
    return { note: "Simulated composition events only; not an OS input method." };
  });

  await test("Navigator, board and editor show one scene; summary stays authored; structural toggle", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => ({ id: s.sceneId, heading: s.heading }))");
    assert(scenes.length === 4, `scenes ${scenes.length}`);
    const s0 = scenes[0];
    const dom = await app.evaluate(`(() => ({
      nav: [...document.querySelectorAll('#navigator li')].map(li => li.dataset.sceneId),
      cardText: document.querySelector('#board .card .card-link').textContent,
      editorHeading: document.querySelector('#editor p[data-scene-id="${s0.id}"]').textContent,
      editorCopies: document.querySelectorAll('#editor p[data-scene-id="${s0.id}"]').length }))()`);
    assert(dom.nav.join() === scenes.map((s) => s.id).join(), "navigator lists scenes by scene id in script order");
    assert(dom.cardText.endsWith(s0.heading) && dom.editorHeading === s0.heading && dom.editorCopies === 1, JSON.stringify(dom));
    const beat0 = await app.evaluate(`__cirth.board.beats.find(b => b.scene_id === ${JSON.stringify(s0.id)})`);
    await caretAtEndOf(1);
    await typeText(" LIVE-EDIT");
    await sleep(400);
    const card = await app.evaluate(`(() => { const el = document.querySelector('#board .card[data-beat-id="${beat0.id}"]'); return { excerpt: el.querySelector('.excerpt').textContent, summary: el.querySelector('.summary').value }; })()`);
    assert(card.excerpt.includes("LIVE-EDIT"), `excerpt '${card.excerpt}'`);
    assert(card.summary === beat0.summary, "summary unchanged");
    const order0 = (await app.evaluate("__cirth.scenes().map(s => s.sceneId)")).join();
    await app.evaluate("__cirth.setStructural(false)");
    await app.evaluate(`__cirth.moveCard(${JSON.stringify(beat0.id)}, null)`);
    await sleep(200);
    assert((await app.evaluate("__cirth.scenes().map(s => s.sceneId)")).join() === order0, "script order unchanged with permission off");
    assert((await app.evaluate("document.querySelector('#board .badge').textContent")) === "Planning only", "planning-only badge visible");
    await app.evaluate("__cirth.setStructural(true)");
    const idsBefore = (await blocks()).map((b) => b.id).sort().join();
    const beat2 = await app.evaluate(`__cirth.board.beats.find(b => b.scene_id === ${JSON.stringify(scenes[2].id)})`);
    await app.evaluate(`__cirth.moveCard(${JSON.stringify(beat0.id)}, ${JSON.stringify(beat2.id)})`);
    await sleep(200);
    const moved = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    assert(moved.join() === [scenes[1].id, scenes[0].id, scenes[2].id, scenes[3].id].join(), `moved order ${moved}`);
    assert((await blocks()).map((b) => b.id).sort().join() === idsBefore, "same block ids, no clones");
    assert(await storedMatchesEditor(), "stored order equals editor order");
    await app.evaluate("__cirth.view.focus()");
    await press("z", [MOD_KEY]);
    assert((await app.evaluate("__cirth.scenes().map(s => s.sceneId)")).join() === order0, "one undo restores scene order");
    assert(await storedMatchesEditor(), "stored order equals editor after undo");
    await app.evaluate("__cirth.setStructural(false)");
  });

  await test("Page markers come from the Rust page map; zoom does not change it", async () => {
    await openFixture("page-boundaries");
    await app.evaluate("__cirth.repaginate()");
    const p1 = await app.evaluate("JSON.stringify(__cirth.pagination.map.page_starts)");
    const marks = await app.evaluate("document.querySelectorAll('#editor .page-mark').length");
    const pages = await app.evaluate("__cirth.pagination.map.pages.length");
    assert(marks === pages - 1, `markers ${marks} for ${pages} pages`);
    await app.evaluate("(() => { document.getElementById('editor').style.zoom = '150%'; })()");
    await app.evaluate("__cirth.repaginate()");
    assert((await app.evaluate("JSON.stringify(__cirth.pagination.map.page_starts)")) === p1, "page map identical at 150% zoom");
    await screenshot(app, "page-boundaries-zoom150");
    await app.evaluate("(() => { document.getElementById('editor').style.zoom = '100%'; })()");
    return { pages, inlineMarkers: await app.evaluate("document.querySelectorAll('#editor .page-mark.inline').length") };
  });

  await test("Long document: open, typing latency, autosave pauses, scene move", async () => {
    await openFixture("long-120");
    const open = await app.evaluate("__cirth.openTimings");
    await openFixture("long-120", false);
    const warm = await app.evaluate("__cirth.openTimings");
    await app.evaluate("__cirth.repaginate()");
    const pag = await app.evaluate("({ pages: __cirth.pagination.map.pages.length, layout_ms: __cirth.pagination.layout_ms, load_ms: __cirth.pagination.load_ms })");
    const nBlocks = (await blocks()).length;
    await caretAtEndOf(Math.floor(nBlocks / 2));
    await app.evaluate("__cirth.view.dispatch(__cirth.view.state.tr.scrollIntoView())");
    await sleep(300);
    await app.evaluate("__cirth.perf.reset()");
    const sentence = "The ledger has been rewritten in a careful second hand. ";
    await typeText((sentence + sentence + sentence + sentence + sentence).slice(0, 300), 25);
    for (let i = 0; i < 10; i++) {
      await press("Enter");
      await press("Tab");
      await typeText("Margit", 25);
      await press("Enter");
      await typeText("Count it again.", 25);
      await press("Enter");
    }
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    await sleep(1200);
    const summary = await app.evaluate("__cirth.perf.summary()");
    const longTasks = await app.evaluate("__cirth.perf.longTasks");
    const sync = await app.evaluate("({ batches: __cirth.syncer.stats.batches, ops: __cirth.syncer.stats.ops, lastDiffMs: __cirth.syncer.stats.lastDiffMs, roundTrips: __cirth.syncer.stats.roundTrips })");
    const rt = [...sync.roundTrips].sort((a, b) => a - b);
    const sc = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const t0 = await app.evaluate("performance.now()");
    await app.evaluate(`__cirth.moveScene(${JSON.stringify(sc[0])}, null)`);
    const t1 = await app.evaluate("performance.now()");
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    const t2 = await app.evaluate("performance.now()");
    const after = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    assert(after.at(-1) === sc[0] && after.length === sc.length, "scene moved to end once");
    assert(await storedMatchesEditor(), "stored equals editor after long-doc edits");
    await screenshot(app, "long-120");
    const m = {
      driver: driver.name,
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

  await test("Crash after acknowledged commit: reopen recovers it; unacknowledged keystrokes are not claimed", async () => {
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("ACKED-MARKER");
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    const v = await app.evaluate("__cirth.syncer.currentVersion");
    await typeText(" UNACKED");
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-crash");
    await waitOpen(app);
    const lo = await app.evaluate("__cirth.lastOpen");
    const b = await blocks();
    assert(lo.recovered === true, "recovery detected");
    assert(text(b.at(-1)) === "ACKED-MARKER", `last block '${text(b.at(-1))}'`);
    assert(lo.doc.version === v, `version ${lo.doc.version} vs acked ${v}`);
    const bannerText = await app.evaluate("document.getElementById('banner').textContent");
    assert(/Recovered unsaved work/.test(bannerText), `recovery banner '${bannerText}'`);
    await screenshot(app, "recovered");
    await app.evaluate("(() => { document.getElementById('save').click(); })()");
    await sleep(500);
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-save");
    await waitOpen(app);
    const lo2 = await app.evaluate("__cirth.lastOpen");
    assert(lo2.recovered === false && text((await blocks()).at(-1)) === "ACKED-MARKER", "clean reopen after package save");
    return { banner: bannerText, window: "Edits are durable once acknowledged: after 300 ms idle, or at most 1.5 s into continuous typing, plus the commit round trip." };
  });

  await test("Second app instance cannot open the same project for writing", async () => {
    const second = await driver.launch("second");
    let banner = "";
    for (let i = 0; i < 80; i++) {
      banner = await second.evaluate("document.getElementById('banner').textContent").catch(() => "");
      if (banner) break;
      await sleep(100);
    }
    await screenshot(second, "second-writer");
    await second.close();
    assert(/another CirthScribe window or process/.test(banner), `banner '${banner}'`);
    assert(await storedMatchesEditor(), "first instance unaffected");
    return { banner };
  });

  await test("PDF proof export from the canonical store", async () => {
    await openFixture("page-boundaries", false);
    await app.evaluate("(() => { document.getElementById('pdf').click(); })()");
    let banner = "";
    for (let i = 0; i < 50 && !/PDF proof/.test(banner); i++) {
      await sleep(100);
      banner = await app.evaluate("document.getElementById('banner').textContent");
    }
    assert(/PDF proof \(not production-ready\) written/.test(banner), banner);
    return { banner };
  });

  await app.close();
}
