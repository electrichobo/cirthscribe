// The end-to-end suite, independent of the automation driver. Every test
// talks to the app through: evaluate, press, type, insertText, imeCompose,
// screenshot, kill, close. Tests that a driver or machine cannot perform
// honestly throw Skip with the reason; skips are reported, never counted as
// passes.

import { writeFileSync, mkdirSync, copyFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
import { MOD_KEY, Skip, clipboardTool, sleep } from "./platform.mjs";

export async function runSuite({ driver, results, dataDir, screensDir }) {
  const text = (b) => b.runs.map((r) => r.text).join("");
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  async function waitFor(target, expr, what) {
    for (let i = 0; i < 150; i++) {
      if (await target.evaluate(expr).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  const waitOpen = (target) => waitFor(target, "!!(window.__cirth && __cirth.view && __cirth.lastOpen)", "a project to open");
  const waitHome = (target) => waitFor(target, "document.body.dataset.view === 'home' && document.getElementById('home').dataset.loaded === '1'", "Home");
  /** Click a Home button like a user would (a card or a sample). */
  const clickHome = (target, selector) => target.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) throw new Error('missing ' + ${JSON.stringify(selector)}); b.click(); return true; })()`);

  let app = await driver.launch("main");
  await waitHome(app);
  // The app starts on Home; open the first sample by clicking it, then type at
  // once (the busiest moment, for the End-key regression test below).
  await clickHome(app, '[data-sample="unicode-marks"]');
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
    results.current = name;
    console.log(`RUN  ${name}`);
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

  // Must run first: it types right after the first project opens, when the
  // main thread is busiest (regression for the End-key selection race).
  await test("End then Enter right after opening a project acts on the visible caret", async () => {
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

  await test("Home: create a project, write, close to Home, reopen; titles never overwrite", async () => {
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const before = await app.evaluate("[...document.querySelectorAll('#home [data-project]')].map(b => b.dataset.project)");
    assert(before.includes("unicode-marks"), `library lists the opened sample: ${before}`);
    const create = async (title) => {
      await app.evaluate(`(() => { const i = document.getElementById('new-title'); i.value = ${JSON.stringify(title)}; i.form.requestSubmit(); return true; })()`);
      await waitOpen(app);
      return app.evaluate("__cirth.lastOpen");
    };
    const o = await create("Harbor Lights: Draft 1");
    assert(o.name === "harbor-lights-draft-1", `project key ${o.name}`);
    assert((await app.evaluate("document.getElementById('project-title').textContent")) === "Harbor Lights: Draft 1", "toolbar shows the title");
    let b = await blocks();
    assert(b.length === 1 && b[0].kind === "heading" && b[0].scene_id, `new project starts with one scene heading: ${JSON.stringify(b)}`);
    await caretAtEndOf(0);
    await typeText("INT. LIGHTHOUSE - NIGHT");
    await press("Enter");
    await typeText("The lamp turns.");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const cardText = await app.evaluate(`document.querySelector('#home [data-project="harbor-lights-draft-1"]').textContent`);
    assert(/Harbor Lights: Draft 1/.test(cardText) && /1 scene · 2 blocks/.test(cardText), `card '${cardText}'`);
    assert(!/recovered/.test(cardText), "closing saved the package (no recovery badge)");
    // Same title again: a second project, the first one untouched.
    const o2 = await create("Harbor Lights: Draft 1");
    assert(o2.name === "harbor-lights-draft-1-2", `second key ${o2.name}`);
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, '[data-project="harbor-lights-draft-1"]');
    await waitOpen(app);
    b = await blocks();
    assert(b.map(text).join("|") === "INT. LIGHTHOUSE - NIGHT|The lamp turns.", `reopened '${b.map(text).join("|")}'`);
    await screenshot(app, "project-reopened");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await screenshot(app, "home");
    return { projects: await app.evaluate("[...document.querySelectorAll('#home [data-project]')].map(b => b.dataset.project)") };
  });

  await test("Older project file (schema v1): flagged on Home, upgraded on open, original kept", async () => {
    const v1 = join(repo, "crates", "cirth-core", "tests", "data", "schema-v1-page-boundaries.cirth");
    const target = join(dataDir, "projects", "legacy-draft.cirth");
    copyFileSync(v1, target);
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const card = await app.evaluate(`document.querySelector('#home [data-project="legacy-draft"]').textContent`);
    assert(/Older format \(v1\)/.test(card) && /4 scenes · 20 blocks/.test(card), `card '${card}'`);
    await clickHome(app, '[data-project="legacy-draft"]');
    await waitOpen(app);
    const lo = await app.evaluate("__cirth.lastOpen");
    assert(lo.migrated_from === 1 && lo.pre_migration_backup, `migration info ${JSON.stringify({ m: lo.migrated_from, b: lo.pre_migration_backup })}`);
    const banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(/Upgraded this project from file format 1/.test(banner), `banner '${banner}'`);
    const b = await blocks();
    assert(b.length === 20 && b.filter((x) => x.scene_id).length === 4, `content ${b.length} blocks`);
    assert(await app.evaluate("__cirth.board.beats.length") === 4, "beats kept");
    // The original sits in backups, byte for byte.
    const kept = readdirSync(join(dataDir, "backups")).filter((n) => n.startsWith("legacy-draft--pre-schema-v"));
    assert(kept.length === 1, `pre-migration copies ${kept}`);
    assert(Buffer.compare(readFileSync(join(dataDir, "backups", kept[0])), readFileSync(v1)) === 0, "kept copy is identical to the original");
    await screenshot(app, "upgraded-v1");
    // Edit, go Home (saves): the file is now current-format.
    await caretAtEndOf(b.length - 1);
    await typeText(" Upgraded.");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const after = await app.evaluate(`document.querySelector('#home [data-project="legacy-draft"]').textContent`);
    assert(!/Older format/.test(after), `after save '${after}'`);
    return { kept: kept[0], banner };
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

  await test("Project file: autosave writes it, Save backs it up, closing the window saves the last edits", async () => {
    await openFixture("unicode-marks");
    await app.evaluate("__cirth.setAutosaveMs(1000)");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("AUTOSAVED");
    await waitSynced();
    await waitFor(app, "__cirth.fileSavedVersion === __cirth.syncer.currentVersion", "autosave to write the project file");
    const autosaved = await app.evaluate("__cirth.fileSavedVersion");
    // Explicit Save after another edit: the previous file goes to backups.
    await typeText(" SAVED");
    await app.evaluate("(() => { document.getElementById('save').click(); return true; })()");
    await waitFor(app, "__cirth.fileSavedVersion > " + autosaved, "explicit save");
    const fileStatus = await app.evaluate("document.getElementById('file-status').textContent");
    assert(/^File saved v\d+ at /.test(fileStatus), `file status '${fileStatus}'`);
    // Type and close the window at once: the close handler flushes and saves.
    await press("Enter");
    await typeText("LAST WORDS");
    const pid = await app.evaluate("__cirth.pid()");
    await app.evaluate("__cirth.closeWindow()").catch(() => {});
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) {
      await sleep(100);
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
    }
    assert(!alive, "the app exited after the window closed");
    await app.close().catch(() => {});
    app = await driver.launch("after-close");
    await waitHome(app);
    const card = await app.evaluate(`document.querySelector('#home [data-project="unicode-marks"]').textContent`);
    assert(!/recovered/.test(card), `closing saved the file, nothing to recover: '${card}'`);
    assert(/\d+ backups?/.test(card), `backup count shown: '${card}'`);
    await clickHome(app, '[data-project="unicode-marks"]');
    await waitOpen(app);
    const lo = await app.evaluate("__cirth.lastOpen");
    const b = await blocks();
    assert(lo.recovered === false, "opened from the file, not recovered");
    assert(text(b.at(-2)) === "AUTOSAVED SAVED" && text(b.at(-1)) === "LAST WORDS", `reopened '${text(b.at(-2))}' / '${text(b.at(-1))}'`);
    return { card };
  });

  await test("Find and replace: options, block-type filter, replace one/all, one undo, marks kept", async () => {
    // Matching rules (the same function the find bar uses).
    const m = (t, q, o = {}) => app.evaluate(`__cirth.find.matchesIn(${JSON.stringify(t)}, ${JSON.stringify({ query: q, matchCase: false, wholeWord: false, kind: "all", ...o })})`);
    assert((await m("Café café CAFÉ", "café", { wholeWord: true })).length === 3, "case-insensitive with accents");
    assert((await m("Café café CAFÉ", "café", { matchCase: true })).length === 1, "match case");
    assert((await m("Zoë Zoëy xZoë", "Zoë", { wholeWord: true })).length === 1, "whole word treats letters with accents as letters");
    assert((await m("a.b axb (x) a*b", "a.b")).length === 1 && (await m("a.b axb (x) a*b", "(x)")).length === 1, "regex characters are literal");
    assert(JSON.stringify(await m("👍🏽 and 👍🏽", "👍🏽")) === "[[0,4],[9,13]]", "emoji offsets in UTF-16 units");

    await openFixture("long-120");
    const before = await blocks();
    const re = /MARGIT/gi;
    const countIn = (bs, kind) => bs.filter((b) => !kind || b.kind === kind).reduce((n, b) => n + (text(b).match(re) ?? []).length, 0);
    const cues = countIn(before, "character");
    const all = countIn(before);
    assert(cues > 10 && all > cues, `fixture has cues (${cues}) and other mentions (${all - cues})`);
    // Ctrl/Cmd+F opens the bar with focus in the query field.
    await caretAtEndOf(0);
    await press("f", [MOD_KEY]);
    await waitFor(app, "!document.getElementById('find-bar').hidden && document.activeElement.id === 'find-query'", "find bar to open");
    await typeText("margit");
    await sleep(300);
    assert((await app.evaluate("__cirth.find.state()")).matches === all, "all block types");
    await app.evaluate("(() => { const k = document.getElementById('find-kind'); k.value = 'character'; k.dispatchEvent(new Event('change')); })()");
    let st = await app.evaluate("__cirth.find.state()");
    assert(st.matches === cues, `cues only: ${st.matches} vs ${cues}`);
    await press("Enter");
    st = await app.evaluate("__cirth.find.state()");
    assert(st.current === 0, `Enter selects the first match (current ${st.current})`);
    assert((await app.evaluate("document.getElementById('find-count').textContent")) === `1 of ${cues}`, "counter");
    // The selected match is scrolled into view below the bar (focus stays in the find field).
    const seen = async () =>
      app.evaluate(`(() => { const v = __cirth.view; const c = v.coordsAtPos(v.state.selection.from); const bar = document.getElementById('find-bar').getBoundingClientRect(); const wrap = document.querySelector('.editor-wrap').getBoundingClientRect();
        return c.top >= bar.bottom && c.bottom <= wrap.bottom && document.activeElement.id === 'find-query'; })()`);
    assert(await seen(), "first match visible");
    for (let i = 0; i < 5; i++) await press("Enter");
    await sleep(100);
    assert(await seen(), "sixth match visible");
    await screenshot(app, "find-bar");
    // Rename the character in cues only: one transaction.
    await app.evaluate("(() => { document.getElementById('find-replace').value = 'MARGUERITE'; })()");
    const ms = await app.evaluate("(() => { const t = performance.now(); document.getElementById('find-replace-all').click(); return performance.now() - t; })()");
    let after = await blocks();
    assert(countIn(after, "character") === 0, "no cue still says MARGIT");
    assert(after.filter((b) => b.kind === "character" && /MARGUERITE/.test(text(b))).length > 0, "cues renamed");
    assert(countIn(after) === all - cues, "action, dialogue and parentheticals untouched");
    assert(/Replaced \d+ match/.test(await app.evaluate("document.getElementById('banner').textContent")), "replace-all reported");
    // Escape returns to the script; one undo restores every cue.
    await press("Escape");
    assert(await app.evaluate("document.getElementById('find-bar').hidden"), "Escape closes");
    await sleep(600);
    await press("z", [MOD_KEY]);
    after = await blocks();
    assert(JSON.stringify(after.map(text)) === JSON.stringify(before.map(text)), "one undo restores all replacements");
    assert(await storedMatchesEditor(), "store matches editor after replace-all and undo");
    // Replace one: first click selects the nearest match, second replaces it.
    await press("f", [MOD_KEY]);
    await app.evaluate("(() => { const q = document.getElementById('find-query'); q.value = 'tide'; q.dispatchEvent(new Event('input')); const k = document.getElementById('find-kind'); k.value = 'all'; k.dispatchEvent(new Event('change')); document.getElementById('find-replace').value = 'sea'; })()");
    await sleep(300);
    const n0 = (await app.evaluate("__cirth.find.state()")).matches;
    await app.evaluate("document.getElementById('find-replace-one').click()");
    await app.evaluate("document.getElementById('find-replace-one').click()");
    assert((await app.evaluate("__cirth.find.state()")).matches === n0 - 1, "replace one changed exactly one match");
    await press("Escape");
    // Marks survive replacement.
    await openFixture("unicode-marks");
    await press("f", [MOD_KEY]);
    await app.evaluate("(() => { const q = document.getElementById('find-query'); q.value = 'bold'; q.dispatchEvent(new Event('input')); const w = document.getElementById('find-word'); w.checked = true; w.dispatchEvent(new Event('change')); document.getElementById('find-replace').value = 'heavy'; })()");
    await sleep(300);
    await app.evaluate("document.getElementById('find-replace-all').click()");
    const runs = (await blocks()).flatMap((b) => b.runs);
    assert(runs.some((r) => r.text === "heavy" && r.bold), `bold kept: ${JSON.stringify(runs.filter((r) => r.bold))}`);
    await press("Escape");
    assert(await storedMatchesEditor(), "store matches editor");
    return { cues, otherMentions: all - cues, replaceAllMs: ms };
  });

  await test("Shortcuts and menu actions; restore a backup as a new project; switching projects saves first", async () => {
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await app.evaluate(`(() => { const i = document.getElementById('new-title'); i.value = 'Restore Test'; i.form.requestSubmit(); return true; })()`);
    await waitOpen(app);
    await caretAtEndOf(0);
    await typeText("INT. VAULT - NIGHT");
    await press("Enter");
    await typeText("VERSION ONE");
    // Ctrl/Cmd+S saves (explicit save: the previous file is backed up).
    let v0 = await app.evaluate("__cirth.fileSavedVersion");
    await press("s", [MOD_KEY]);
    await waitFor(app, `__cirth.fileSavedVersion > ${v0}`, "Mod+S to save");
    await typeText(" TWO");
    v0 = await app.evaluate("__cirth.fileSavedVersion");
    await press("s", [MOD_KEY]);
    await waitFor(app, `__cirth.fileSavedVersion > ${v0}`, "second Mod+S");
    // Menu Undo runs the editor's undo (same handler the native menu uses).
    // Pause first: edits less than 500 ms apart form one undo step.
    await sleep(700);
    await typeText(" UNDO-ME");
    await app.evaluate("__cirth.menu('undo')");
    let b = await blocks();
    assert(text(b.at(-1)) === "VERSION ONE TWO", `menu undo left '${text(b.at(-1))}'`);
    const name = await app.evaluate("__cirth.lastOpen.name");
    // Menu "Close Project" goes Home; the card offers its backups.
    await app.evaluate("__cirth.menu('home')");
    await waitHome(app);
    await clickHome(app, `[data-backups="${name}"]`);
    await waitFor(app, "document.getElementById('backups-dialog').open && document.querySelectorAll('[data-restore]').length > 0", "backups dialog");
    const rows = await app.evaluate("[...document.querySelectorAll('#backups-dialog li')].map(li => li.textContent)");
    await screenshot(app, "backups-dialog");
    // Newest backup first: the file as it was before the second save ("VERSION ONE").
    await clickHome(app, "[data-restore]");
    await waitOpen(app);
    const restored = await app.evaluate("__cirth.lastOpen");
    assert(/Restore Test \(restored \d{4}-\d\d-\d\d \d\d\.\d\d UTC\)/.test(restored.doc.title), `restored title '${restored.doc.title}'`);
    b = await blocks();
    assert(text(b.at(-1)) === "VERSION ONE", `restored content '${text(b.at(-1))}'`);
    assert(restored.name !== name, "restored into a new project");
    // Switch straight to the original (no Home in between) after an edit: the
    // restored project's file is written first, so nothing waits for recovery.
    await caretAtEndOf(b.length - 1);
    await typeText(" (edited copy)");
    await app.evaluate(`__cirth.openPath(${JSON.stringify(join(dataDir, "projects", name + ".cirth"))})`);
    await waitFor(app, `__cirth.lastOpen && __cirth.lastOpen.name === ${JSON.stringify(name)}`, "switch to the original");
    assert(text((await blocks()).at(-1)) === "VERSION ONE TWO", "original keeps its latest text");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const copyCard = await app.evaluate(`document.querySelector('#home [data-project="${restored.name}"]').textContent`);
    assert(!/recovered/.test(copyCard), `switching saved the copy first: '${copyCard}'`);
    return { rows, restoredTitle: restored.doc.title };
  });

  const elsewhereDir = join(dataDir, "elsewhere folder");
  const elsewhere = join(elsewhereDir, "My Draft.cirth");
  const cardFor = (p) => `#home [data-path="${p.replaceAll("\\", "\\\\")}"]`;

  await test("Save As outside the library; recent files on Home; missing files can be removed", async () => {
    mkdirSync(elsewhereDir, { recursive: true });
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("BEFORE SAVE AS");
    assert(await app.evaluate(`__cirth.saveAs(${JSON.stringify(elsewhere)})`), "save as returned true");
    const lo = await app.evaluate("__cirth.lastOpen");
    assert(lo.package_path.endsWith("My Draft.cirth"), `now editing ${lo.package_path}`);
    await press("Enter");
    await typeText("AFTER SAVE AS");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    const path = lo.package_path;
    const card = await app.evaluate(`document.querySelector(${JSON.stringify(cardFor(path))})?.textContent ?? ""`);
    assert(/Outside library/.test(card) && card.includes("My Draft.cirth"), `elsewhere card '${card}'`);
    // The library original keeps its last saved state (without the later edits).
    await clickHome(app, '[data-project="unicode-marks"]');
    await waitOpen(app);
    assert(!(await blocks()).some((b) => text(b) === "AFTER SAVE AS"), "original file untouched by edits after Save As");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    // Reopen the copy from Home: both edits are there.
    await clickHome(app, cardFor(path));
    await waitOpen(app);
    let b = await blocks();
    assert(text(b.at(-2)) === "BEFORE SAVE AS" && text(b.at(-1)) === "AFTER SAVE AS", `copy has '${text(b.at(-2))}' / '${text(b.at(-1))}'`);
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    // Move the file away: Home says so and lets you drop it from the list.
    const parked = join(dataDir, "parked.cirth");
    copyFileSync(path, parked);
    rmSync(path);
    await app.evaluate("__cirth.home.refresh()");
    const missing = await app.evaluate(`(() => { const c = document.querySelector(${JSON.stringify(cardFor(path))}); return { text: c.textContent, disabled: c.disabled }; })()`);
    assert(/File not found/.test(missing.text) && missing.disabled, `missing card ${JSON.stringify(missing)}`);
    await screenshot(app, "home-missing-file");
    await app.evaluate(`(() => { document.querySelector(${JSON.stringify(`[data-forget="${path.replaceAll("\\", "\\\\")}"]`)}).click(); return true; })()`);
    await sleep(300);
    await waitHome(app);
    assert(!(await app.evaluate(`!!document.querySelector(${JSON.stringify(cardFor(path))})`)), "removed from the list");
    copyFileSync(parked, path);
    return { path };
  });

  await test("Outside change: warned early; Save keeps the other version and writes ours to a conflict copy", async () => {
    await app.evaluate(`__cirth.openPath(${JSON.stringify(elsewhere)})`);
    await waitOpen(app);
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("MINE");
    await waitSynced();
    // Another program replaces the file (here: a different project's file).
    const theirs = join(dataDir, "projects", "page-boundaries.cirth");
    copyFileSync(theirs, elsewhere);
    const before = readFileSync(elsewhere);
    const c = await app.evaluate("__cirth.checkOutside()");
    assert(c.changed, `outside change noticed: ${JSON.stringify(c)}`);
    let banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(/changed outside CirthScribe. It will not be overwritten/.test(banner), `early warning '${banner}'`);
    await app.evaluate("(() => { document.getElementById('save').click(); return true; })()");
    await waitFor(app, "__cirth.lastOpen && __cirth.lastOpen.package_path.includes('(conflict ')", "conflict copy");
    const conflictPath = await app.evaluate("__cirth.lastOpen.package_path");
    banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(/To keep both, your version was saved as/.test(banner), `conflict banner '${banner}'`);
    assert(Buffer.compare(readFileSync(elsewhere), before) === 0, "the other version is untouched");
    assert(readdirSync(elsewhereDir).some((n) => n.startsWith("My Draft (conflict ")), "conflict copy beside the original");
    await screenshot(app, "conflict-banner");
    // Our version is in the conflict copy.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, cardFor(conflictPath));
    await waitOpen(app);
    assert(text((await blocks()).at(-1)) === "MINE", "conflict copy holds our edit");
    // Rewriting the same bytes (as sync tools do) is not a change.
    writeFileSync(conflictPath, readFileSync(conflictPath));
    assert(!(await app.evaluate("__cirth.checkOutside()")).changed, "identical rewrite is not a change");
    await typeText(" again");
    await app.evaluate("(() => { document.getElementById('save').click(); return true; })()");
    await sleep(800);
    assert((await app.evaluate("__cirth.lastOpen.package_path")) === conflictPath, "no second conflict for an identical rewrite");
    return { conflictPath };
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
    await waitHome(app);
    const badge = await app.evaluate(`document.querySelector('#home [data-project="unicode-marks"]').textContent`);
    assert(/Unsaved work will be recovered/.test(badge), `Home shows the recovery badge: '${badge}'`);
    await screenshot(app, "home-recovery");
    await clickHome(app, '[data-project="unicode-marks"]');
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
    await waitHome(app);
    await clickHome(app, '[data-project="unicode-marks"]');
    await waitOpen(app);
    const lo2 = await app.evaluate("__cirth.lastOpen");
    assert(lo2.recovered === false && text((await blocks()).at(-1)) === "ACKED-MARKER", "clean reopen after package save");
    return { banner: bannerText, window: "Edits are durable once acknowledged: after 300 ms idle, or at most 1.5 s into continuous typing, plus the commit round trip." };
  });

  await test("Second app instance cannot open the same project for writing", async () => {
    const second = await driver.launch("second");
    await waitHome(second);
    await clickHome(second, '[data-project="unicode-marks"]');
    let banner = "";
    for (let i = 0; i < 80; i++) {
      banner = await second.evaluate("document.querySelector('#home .home-message').textContent").catch(() => "");
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
