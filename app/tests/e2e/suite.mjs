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
    // E2E_ONLY=<text> runs only tests whose name contains it (for debugging).
    if (process.env.E2E_ONLY && !name.includes(process.env.E2E_ONLY)) return;
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
    // Rich text from TextEdit (macOS offers its RTF as HTML too): typed by the
    // plain-text rules, inline styles kept when the paragraphs line up.
    let n2 = b.length;
    await caretAtEndOf(n2 - 1);
    await pasteEvent({
      "text/html": '<meta charset="UTF-8"><p class="p1"><b>KAITO</b></p><p class="p1">The clipboard came <i>from</i> the OS.</p>',
      "text/plain": "KAITO\nThe clipboard came from the OS.",
    });
    b = await blocks();
    let rich = b.slice(n2);
    assert(rich.map((x) => x.kind).join(",") === "character,dialogue", `rich text typed: ${JSON.stringify(rich)}`);
    assert(rich[0].runs.some((r) => r.bold) && rich[1].runs.some((r) => r.italic && r.text === "from"), `styles kept: ${JSON.stringify(rich)}`);
    // HTML whose paragraphs do not match the text: types win, styling dropped.
    n2 = b.length;
    await caretAtEndOf(n2 - 1);
    await pasteEvent({ "text/html": "<div><b>NOOR</b><br>Hello there.</div>", "text/plain": "NOOR\nHello there." });
    b = await blocks();
    rich = b.slice(n2);
    assert(rich.map((x) => x.kind).join(",") === "character,dialogue", `mismatched HTML still typed: ${JSON.stringify(rich)}`);
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

  await test("Autocomplete: cues, extensions, heading prefix/location/time, transitions; keys", async () => {
    await openFixture("long-120");
    const sug = () => app.evaluate("__cirth.suggestion()");
    const menuShown = () => app.evaluate("(() => { const m = document.querySelector('.ac-menu'); return !!m && !m.hidden; })()");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await press("3", [MOD_KEY]); // character cue, whatever the last block was
    await typeText("mar");
    let s = await sug();
    assert(s && s.mode === "cue" && s.items[0] === "MARGIT", `cue suggestion ${JSON.stringify(s)}`);
    assert(await menuShown(), "list visible");
    await screenshot(app, "autocomplete-cue");
    // Enter accepts and goes on to dialogue (like Final Draft).
    await press("Enter");
    let b = await blocks();
    assert(text(b.at(-2)) === "MARGIT" && b.at(-2).kind === "character" && b.at(-1).kind === "dialogue", `after Enter: ${b.slice(-2).map((x) => x.kind + ":" + text(x))}`);
    await typeText("Count it.");
    await press("Enter"); // dialogue -> character
    // Tab accepts and stays; "(" offers extensions.
    await typeText("ine");
    s = await sug();
    assert(s && s.items[0] === "INES", `INES offered ${JSON.stringify(s)}`);
    await press("Tab");
    await typeText(" (v");
    s = await sug();
    assert(s && s.mode === "extension" && s.items[0] === "V.O.)", `extension ${JSON.stringify(s)}`);
    await press("Tab");
    b = await blocks();
    assert(text(b.at(-1)) === "INES (V.O.)" && b.at(-1).kind === "character", `cue '${text(b.at(-1))}'`);
    // Escape closes the list and stays in the editor; typing reopens it.
    await press("Enter");
    await typeText("hello");
    await press("Enter"); // -> character
    await typeText("oy");
    assert((await sug())?.items[0] === "OYELARAN", "OYELARAN offered");
    await press("Escape");
    assert(!(await sug()) && !(await menuShown()), "Escape closes the list");
    assert(await app.evaluate("document.activeElement === __cirth.view.dom"), "focus stays in the script");
    await typeText("e");
    assert((await sug())?.items[0] === "OYELARAN", "typing reopens it");
    await press("Tab");
    await press("Enter");
    await typeText("Go.");
    await press("Enter"); // -> character
    await press("Enter"); // empty character -> action
    // Scene heading: prefix, then a known location, then a time.
    await press("Tab", ["shift"]); // action -> heading
    await typeText("e");
    s = await sug();
    assert(s && s.mode === "prefix" && s.items[0] === "EXT. ", `prefix ${JSON.stringify(s)}`);
    await press("Enter");
    b = await blocks();
    assert(b.at(-1).kind === "heading" && text(b.at(-1)) === "EXT. ", "prefix accepted, still in the heading");
    await typeText("sig");
    s = await sug();
    assert(s && s.mode === "location" && s.items[0] === "SIGNAL TOWER", `location ${JSON.stringify(s)}`);
    await press("Enter");
    assert(text((await blocks()).at(-1)) === "EXT. SIGNAL TOWER - ", "location accepted with ' - '");
    await typeText("n");
    s = await sug();
    assert(s && s.mode === "time" && s.items[0] === "NIGHT", `time ${JSON.stringify(s)}`);
    await press("Enter");
    b = await blocks();
    assert(text(b.at(-2)) === "EXT. SIGNAL TOWER - NIGHT" && b.at(-2).kind === "heading" && b.at(-1).kind === "action", `heading done: ${b.slice(-2).map((x) => x.kind + ":" + text(x))}`);
    assert(b.at(-2).scene_id, "new heading has a scene id");
    // Transition (Ctrl/Cmd+6 sets the type directly).
    await press("6", [MOD_KEY]);
    await typeText("cu");
    assert((await sug())?.items[0] === "CUT TO:", "transition offered");
    await press("Tab");
    assert(text((await blocks()).at(-1)) === "CUT TO:", "transition accepted");
    assert(await storedMatchesEditor(), "store matches editor");
  });

  await test("Word counts: one documented rule; live block/selection counts; script total matches the store", async () => {
    const cases = JSON.parse(readFileSync(join(repo, "fixtures", "word-count-cases.json"), "utf8"));
    const got = await app.evaluate(`__cirth.countWords(${JSON.stringify(cases.map((c) => c.text))})`);
    const wrong = cases.filter((c, i) => got[i] !== c.words).map((c, i) => `${JSON.stringify(c.text)}: ${got[i]} vs ${c.words}`);
    assert(!wrong.length, `shared cases through the app: ${wrong.join("; ")}`);
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("don't stop well-known 1,000 -- 👍");
    await waitFor(app, "__cirth.counts().live.block === 4", "live block count 4");
    // Selection across two blocks.
    await setCaret("[ps[1][0] + 1, ps[2][0] + ps[2][1] - 1]");
    const selWords = await app.evaluate("(() => { const v = __cirth.view; return v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, ' '); })()");
    const [expectSel] = await app.evaluate(`__cirth.countWords([${JSON.stringify(selWords)}])`);
    await waitFor(app, `__cirth.counts().live.selection === ${expectSel}`, "selection count");
    // Script total (from the store) equals the sum of every block's count.
    await waitSynced();
    await waitFor(app, "__cirth.counts().doc && __cirth.counts().doc.doc_version === __cirth.syncer.currentVersion", "document counts for the current version");
    const doc = await app.evaluate("__cirth.counts().doc");
    const perBlock = await app.evaluate("__cirth.countWords(__cirth.blocks().map(b => b.runs.map(r => r.text).join('')))");
    const sum = perBlock.reduce((a, b) => a + b, 0);
    assert(doc.total === sum, `script total ${doc.total} vs sum of blocks ${sum}`);
    assert(Object.values(doc.by_kind).reduce((a, b) => a + b, 0) === sum, "per-type counts add up");
    const footer = await app.evaluate("document.getElementById('info').textContent");
    assert(footer.includes(`script ${sum.toLocaleString()}`) && /selection \d/.test(footer), `footer '${footer}'`);
    return { total: sum, footer };
  });

  await test("Spelling: underlines, corrections with undo, dictionaries, ignore, US/UK/off, names", async () => {
    const flagged = () => app.evaluate("[...new Set(__cirth.spell.misspelledWords())].sort()");
    const settle = () => app.evaluate("__cirth.spell.run(false)");
    await openFixture("unicode-marks");
    await app.evaluate("__cirth.spell.reset()");
    assert(JSON.stringify(await flagged()) === JSON.stringify(["NØRDLYS", "brûlée", "crème"]), `fixture flags ${JSON.stringify(await flagged())}`);
    // A typed misspelling is underlined after a short pause; cue names are not.
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await press("Enter");
    await typeText("Kaito will recieve it");
    await waitFor(app, "__cirth.spell.misspelledWords().includes('recieve')", "underline on 'recieve'");
    assert(!(await flagged()).includes("Kaito"), "character names are accepted");
    assert(await app.evaluate("[...document.querySelectorAll('#editor .misspelled')].some(e => e.textContent === 'recieve')"), "drawn as a decoration");
    // Right-click: suggestions; choosing one replaces the word; one undo restores it.
    await app.evaluate(`(() => { const v = __cirth.view; const el = [...document.querySelectorAll('#editor .misspelled')].find(e => e.textContent === 'recieve');
      const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + r.height / 2 })); return true; })()`);
    await waitFor(app, "!!__cirth.spell.menuItems() && __cirth.spell.menuItems().includes('receive')", "suggestion menu");
    const items = await app.evaluate("__cirth.spell.menuItems()");
    await screenshot(app, "spell-menu");
    await app.evaluate("(() => { [...document.querySelectorAll('.spell-menu button')].find(b => b.textContent === 'receive').click(); return true; })()");
    let b = await blocks();
    assert(text(b.at(-1)) === "Kaito will receive it", `corrected '${text(b.at(-1))}'`);
    await sleep(600);
    await press("z", [MOD_KEY]);
    b = await blocks();
    assert(text(b.at(-1)) === "Kaito will recieve it", `undo restored '${text(b.at(-1))}'`);
    // Ctrl/Cmd+. opens the same menu at the caret; Escape returns to the script.
    await settle();
    await setCaret(`[ps.at(-1)[0] + 1 + 13]`); // inside "recieve"
    await press(".", [MOD_KEY]);
    await waitFor(app, "!!__cirth.spell.menuItems()", "menu from the keyboard");
    assert(await app.evaluate("document.activeElement.closest('.spell-menu') !== null"), "focus in the menu");
    const first = await app.evaluate("document.activeElement.textContent");
    await press("ArrowDown");
    assert((await app.evaluate("document.activeElement.textContent")) !== first, "ArrowDown moves through the menu");
    await press("Escape");
    assert((await app.evaluate("__cirth.spell.menuItems()")) === null && (await app.evaluate("document.activeElement === __cirth.view.dom")), "Escape closes and refocuses");
    // Ignore lasts for this session; project dictionary persists with the project.
    const openMenuFor = (word) =>
      app.evaluate(`(() => { const el = [...document.querySelectorAll('#editor .misspelled')].find(e => e.textContent === ${JSON.stringify(word)});
        const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + r.height / 2 })); return true; })()`);
    const choose = async (label) => {
      await waitFor(app, `!!__cirth.spell.menuItems() && __cirth.spell.menuItems().some(t => t.startsWith(${JSON.stringify(label)}))`, `menu item ${label}`);
      await app.evaluate(`(() => { [...document.querySelectorAll('.spell-menu button')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click(); return true; })()`);
      await sleep(300);
      await settle();
    };
    await openMenuFor("crème");
    await choose("Ignore");
    await openMenuFor("NØRDLYS");
    await choose("Add to project dictionary");
    await openMenuFor("brûlée");
    await choose("Add to my dictionary");
    assert(JSON.stringify(await flagged()) === JSON.stringify(["recieve"]), `after ignore/add: ${JSON.stringify(await flagged())}`);
    const settings = await app.evaluate("__TAURI_INTERNALS__.invoke('spell_settings')");
    assert(settings.project_words.includes("NØRDLYS") && settings.user_words.includes("brûlée"), JSON.stringify(settings));
    // Reopen: the project word and the personal word stay accepted; the ignored one returns.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, '[data-project="unicode-marks"]');
    await waitOpen(app);
    await app.evaluate("__cirth.spell.reset()");
    assert(JSON.stringify(await flagged()) === JSON.stringify(["crème", "recieve"]), `after reopen: ${JSON.stringify(await flagged())}`);
    // US / UK / off is a project setting.
    const last = (await blocks()).length - 1;
    await caretAtEndOf(last);
    await typeText(" color colour");
    await settle();
    await sleep(500);
    await settle();
    let f = await flagged();
    assert(f.includes("colour") && !f.includes("color"), `US: ${JSON.stringify(f)}`);
    await app.evaluate("(async () => { const s = document.getElementById('spelling'); s.value = 'en_GB'; s.dispatchEvent(new Event('change')); })()");
    await waitFor(app, "__cirth.spell.lang === 'en_GB' && __cirth.spell.misspelledWords().includes('color')", "UK spelling");
    f = await flagged();
    assert(!f.includes("colour"), `UK: ${JSON.stringify(f)}`);
    await app.evaluate("(async () => { const s = document.getElementById('spelling'); s.value = 'off'; s.dispatchEvent(new Event('change')); })()");
    await waitFor(app, "__cirth.spell.lang === 'off'", "spelling off");
    await settle();
    assert((await flagged()).length === 0, "off: no underlines");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, '[data-project="unicode-marks"]');
    await waitOpen(app);
    await waitFor(app, "document.getElementById('spelling').value === 'off'", "the setting is saved with the project");
    await app.evaluate("(async () => { const s = document.getElementById('spelling'); s.value = 'en_US'; s.dispatchEvent(new Event('change')); })()");
    assert(await storedMatchesEditor(), "store matches editor");
    return { items };
  });

  await test("Dual dialogue toggle, forced page break, page view: editor and Rust page map agree", async () => {
    await openFixture("unicode-marks");
    const kinds = (await blocks()).map((x) => x.kind);
    const kaito = kinds.indexOf("character", kinds.indexOf("character") + 1); // second cue (KAITO)
    const abena = kinds.indexOf("character", kaito + 1); // third cue (ABENA)
    const caretIn = (i) => setCaret(`[ps[${i}][0] + 1]`);
    const banner = () => app.evaluate("document.getElementById('banner').textContent");
    // First speech: nothing before it to pair with.
    await caretIn(kinds.indexOf("character"));
    await press("d", [MOD_KEY]);
    assert(/there is none/.test(await banner()), `refused for the first speech: '${await banner()}'`);
    assert(!(await blocks()).some((x) => x.dual), "nothing changed");
    // Second cue pairs with ZOË's speech.
    await caretIn(kaito);
    await press("d", [MOD_KEY]);
    assert((await blocks())[kaito].dual === true, "KAITO is the right side");
    const geo = await app.evaluate(`(() => { const L = document.querySelector('#editor p.dual-left.b-character'), R = document.querySelector('#editor p.dual-right.b-character');
      return { lt: Math.round(L.getBoundingClientRect().top), rt: Math.round(R.getBoundingClientRect().top), lx: L.getBoundingClientRect().left, rx: R.getBoundingClientRect().left, left: L.textContent, right: R.textContent }; })()`);
    assert(geo.lt === geo.rt && geo.rx > geo.lx + 100 && geo.left === "ZOË" && geo.right === "KAITO", `side by side ${JSON.stringify(geo)}`);
    // Third cue cannot pair: the speech before it is already a right side.
    await caretIn(abena);
    await press("d", [MOD_KEY]);
    assert(/already the right side/.test(await banner()), `refused when chained: '${await banner()}'`);
    // Rust lays the pair out side by side too.
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    await app.evaluate("__cirth.repaginate()");
    const ids = (await blocks()).map((x) => x.id);
    const row = (id) => app.evaluate(`(() => { for (const p of __cirth.pagination.map.pages) for (const l of p.lines) if (l.block_id === ${JSON.stringify(id)}) return [p.number, l.row, l.x_in]; return null; })()`);
    const [z, k] = [await row(ids[kinds.indexOf("character")]), await row(ids[kaito])];
    assert(z && k && z[0] === k[0] && z[1] === k[1] && k[2] > z[2], `page map pair ${JSON.stringify({ z, k })}`);
    assert(await storedMatchesEditor(), "store has the dual flag");
    await caretIn(kaito);
    await sleep(600);
    await press("z", [MOD_KEY]);
    assert(!(await blocks())[kaito].dual, "one undo unpairs");
    // Forced page break before the action block.
    const action = kinds.lastIndexOf("action");
    await caretIn(action);
    await press("Enter", [MOD_KEY]);
    assert((await blocks())[action].break_before === true, "page break set");
    assert(await app.evaluate(`!!document.querySelectorAll('#editor p')[${action}].hasAttribute('data-break')`), "shown in the editor");
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    await app.evaluate("__cirth.repaginate()");
    let starts = await app.evaluate("__cirth.pagination.map.page_starts");
    assert(starts.some((s) => s.block_id === ids[action] && s.offset === 0 && s.page === 2), `a new page starts there: ${JSON.stringify(starts)}`);
    // Page view shows the gap; the page map does not change with the view.
    const before = JSON.stringify(starts);
    await app.evaluate("__cirth.setViewMode('pages')");
    await app.evaluate("__cirth.repaginate()");
    assert(JSON.stringify(await app.evaluate("__cirth.pagination.map.page_starts")) === before, "page map identical in page view");
    const band = await app.evaluate("(() => { const m = document.querySelector('#editor .page-mark'); return { h: m.getBoundingClientRect().height, t: m.textContent }; })()");
    assert(band.h > 30 && band.t === "page 2", `page gap ${JSON.stringify(band)}`);
    await screenshot(app, "page-view");
    await app.evaluate("__cirth.setViewMode('continuous')");
    // Menu actions use the same commands.
    await caretIn(action);
    await app.evaluate("__cirth.menu('page_break')");
    assert(!(await blocks())[action].break_before, "menu toggles the break off");
    await caretIn(kaito);
    await app.evaluate("__cirth.menu('dual')");
    assert((await blocks())[kaito].dual === true, "menu toggles dual on");
    assert(await storedMatchesEditor(), "store matches editor");
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

  const fwOpen = async () => {
    await app.evaluate("__cirth.openFreeWriting()");
    await waitFor(app, "document.body.dataset.view === 'free' && document.getElementById('freewrite').dataset.loaded === '1'", "Free Writing");
  };
  const fwBody = () => app.evaluate("document.getElementById('fw-body').value");
  const fwFocusBody = () => app.evaluate("(() => { const b = document.getElementById('fw-body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); return true; })()");
  // Saved means the stored copy equals what is on screen, not just the label.
  const fwSaved = () =>
    waitFor(app, "(() => { const c = __cirth.free.current; return !!c && document.getElementById('fw-status').textContent.startsWith('Saved') && c.body === document.getElementById('fw-body').value; })()", "Free Writing autosave");

  await test("Free Writing without a project: autosave survives a hard kill; search, folders, trash, export", async () => {
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, "#open-free");
    await waitFor(app, "document.body.dataset.view === 'free' && document.getElementById('freewrite').dataset.loaded === '1'", "Free Writing from Home");
    await app.evaluate("(() => { document.getElementById('fw-new').click(); return true; })()");
    await waitFor(app, "document.activeElement && document.activeElement.id === 'fw-title'", "new piece title focused");
    await typeText("Night notes");
    await fwFocusBody();
    await typeText("The harbor smells of oranges.");
    await press("Enter");
    await press("Enter");
    await typeText("Second thought here.");
    await fwSaved();
    const id = await app.evaluate("__cirth.free.current.id");
    // Hard kill right after the save, then restart: the piece is there.
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-free-kill");
    await waitHome(app);
    await clickHome(app, "#open-free");
    await waitFor(app, "document.getElementById('freewrite').dataset.loaded === '1'", "Free Writing after restart");
    await clickHome(app, `[data-piece="${id}"]`);
    await waitFor(app, `__cirth.free.current && __cirth.free.current.id === ${JSON.stringify(id)}`, "piece open");
    assert((await fwBody()) === "The harbor smells of oranges.\n\nSecond thought here.", `restored '${await fwBody()}'`);
    assert((await app.evaluate("document.getElementById('fw-title').value")) === "Night notes", "title restored");
    // Search (case-insensitive) across all writing.
    const listIds = () => app.evaluate("[...document.querySelectorAll('#fw-list [data-piece]')].map(b => b.dataset.piece)");
    await app.evaluate("(() => { const s = document.getElementById('fw-search'); s.value = 'ORANGES'; s.dispatchEvent(new Event('input')); return true; })()");
    await sleep(400);
    assert((await listIds()).includes(id), "search finds it");
    await app.evaluate("(() => { const s = document.getElementById('fw-search'); s.value = 'zzzz'; s.dispatchEvent(new Event('input')); return true; })()");
    await sleep(400);
    assert((await listIds()).length === 0, "no false matches");
    await app.evaluate("(() => { const s = document.getElementById('fw-search'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()");
    // A folder holds it; Trash keeps it; Restore brings it back.
    await app.evaluate("(() => { document.getElementById('fw-new-folder').click(); return true; })()");
    await sleep(400);
    const folderId = await app.evaluate("[...document.querySelectorAll('.fw-scopes [data-scope]')].map(b => b.dataset.scope).find(s => s !== 'all' && s !== 'trash')");
    await app.evaluate(`(() => { const f = document.getElementById('fw-folder'); f.value = ${JSON.stringify(folderId)}; f.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(400);
    await clickHome(app, `[data-scope="${folderId}"]`);
    await sleep(300);
    assert((await listIds()).includes(id), "listed in its folder");
    await app.evaluate("(() => { document.getElementById('fw-trash').click(); return true; })()");
    await sleep(400);
    await clickHome(app, '[data-scope="trash"]');
    await sleep(300);
    assert((await listIds()).includes(id), "in Trash");
    await clickHome(app, '[data-scope="all"]');
    await sleep(300);
    assert(!(await listIds()).includes(id), "not in All while trashed");
    await app.evaluate("(() => { document.getElementById('fw-trash').click(); return true; })()");
    await sleep(400);
    assert((await listIds()).includes(id), "restored");
    // Export to a text file.
    const out = join(dataDir, "exported notes.txt");
    await app.evaluate(`__cirth.free.exportTo(${JSON.stringify(out)})`);
    assert(readFileSync(out, "utf8") === "Night notes\n\nThe harbor smells of oranges.\n\nSecond thought here.\n", `export '${readFileSync(out, "utf8")}'`);
    await screenshot(app, "free-writing");
    return { id };
  });

  await test("Flow mode: text only grows at the end; editing keys, undo, clicks do nothing; Esc restores editing", async () => {
    await fwOpen();
    await app.evaluate("(() => { document.getElementById('fw-new').click(); return true; })()");
    await waitFor(app, "document.activeElement && document.activeElement.id === 'fw-title'", "new piece");
    await typeText("Flow test");
    await fwFocusBody();
    await typeText("abc");
    await app.evaluate("(() => { document.getElementById('fw-flow').click(); return true; })()");
    assert(await app.evaluate("__cirth.free.flow === true"), "flow on");
    assert(await app.evaluate("getComputedStyle(document.querySelector('.fw-side')).display === 'none'"), "sidebar hidden");
    for (const k of ["Backspace", "Delete", "ArrowLeft", "Home", "ArrowUp"]) await press(k);
    await press("z", [MOD_KEY]);
    await press("a", [MOD_KEY]);
    assert((await fwBody()) === "abc", `editing keys ignored: '${await fwBody()}'`);
    await typeText("X");
    assert((await fwBody()) === "abcX", `typing appends: '${await fwBody()}'`);
    // Clicking in the middle does not move the insertion point.
    await app.evaluate("(() => { const b = document.getElementById('fw-body'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 })); b.setSelectionRange(1, 1); b.dispatchEvent(new Event('select')); return b.selectionStart; })()");
    await typeText("Y");
    assert((await fwBody()) === "abcXY", `after a click in the middle: '${await fwBody()}'`);
    // Paste appends.
    await app.evaluate("(() => { const b = document.getElementById('fw-body'); b.setSelectionRange(0, 2); const dt = new DataTransfer(); dt.setData('text/plain', ' pasted'); b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()");
    assert((await fwBody()) === "abcXY pasted", `paste appends: '${await fwBody()}'`);
    if (driver.capabilities.ime) {
      await app.imeCompose(["に", "にほ"], "日本");
      assert((await fwBody()) === "abcXY pasted日本", `IME at the end: '${await fwBody()}'`);
    }
    await screenshot(app, "flow-mode");
    await press("Escape");
    assert(await app.evaluate("__cirth.free.flow === false"), "Esc turns editing back on");
    await fwFocusBody();
    const before = await fwBody();
    await press("Backspace");
    assert((await fwBody()) === before.slice(0, -1), `Backspace works again: '${await fwBody()}'`);
    await fwSaved();
  });

  await test("Free Writing into a project: copy keeps the piece; move sends it to Trash; both recorded; undo removes text", async () => {
    await openFixture("unicode-marks");
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    await fwOpen();
    await app.evaluate("(() => { document.getElementById('fw-new').click(); return true; })()");
    await waitFor(app, "document.activeElement && document.activeElement.id === 'fw-title'", "new piece");
    await typeText("Cold open idea");
    await fwFocusBody();
    await typeText("A gull lands on the ledger.");
    await press("Enter");
    await press("Enter");
    await typeText("Nobody moves.");
    const id = await app.evaluate("__cirth.free.current.id");
    assert(!(await app.evaluate("document.getElementById('fw-copy').disabled")), "copy enabled with a project open");
    await app.evaluate("(() => { document.getElementById('fw-copy').click(); return true; })()");
    await waitFor(app, "document.body.dataset.view === 'editor'", "back in the script");
    await waitFor(app, `__cirth.blocks().length === ${n0 + 2}`, "two paragraphs inserted");
    let b = await blocks();
    assert(b.slice(-2).map((x) => `${x.kind}:${text(x)}`).join("|") === "action:A gull lands on the ledger.|action:Nobody moves.", `inserted ${JSON.stringify(b.slice(-2).map(text))}`);
    assert(/Copied "Cold open idea"/.test(await app.evaluate("document.getElementById('banner').textContent")), "copy reported");
    await sleep(600);
    await press("z", [MOD_KEY]);
    assert((await blocks()).length === n0, "one undo removes the copy");
    // The piece stayed, with provenance.
    await fwOpen();
    await clickHome(app, `[data-piece="${id}"]`);
    await waitFor(app, `__cirth.free.current && __cirth.free.current.id === ${JSON.stringify(id)}`, "piece open");
    assert(/Copied into "Unicode and marks"/.test(await app.evaluate("document.getElementById('fw-prov').textContent")), "provenance on the piece");
    // Move: inserted, and the piece goes to Trash (not deleted).
    await app.evaluate("(() => { document.getElementById('fw-move').click(); return true; })()");
    await waitFor(app, "document.body.dataset.view === 'editor'", "back in the script after move");
    await waitFor(app, `__cirth.blocks().length === ${n0 + 2}`, "moved paragraphs inserted");
    await fwOpen();
    await clickHome(app, '[data-scope="trash"]');
    await sleep(300);
    assert(await app.evaluate(`!!document.querySelector('#fw-list [data-piece="${id}"]')`), "moved piece is in Trash");
    assert(await storedMatchesEditor(), "store matches editor");
    await app.evaluate("(() => { document.getElementById('fw-back').click(); return true; })()");
    await waitFor(app, "document.body.dataset.view === 'editor'", "Back returns to the open project");
  });

  await test("About shows the attribution, GPL notice, full GPL text and third-party licences (Home and menu)", async () => {
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, "#open-about");
    await waitFor(app, "document.getElementById('about-dialog')?.open === true", "About open");
    const pageText = () => app.evaluate("document.querySelector('#about-dialog .about-page').textContent");
    // Text in the DOM is not enough: on WebKit the page area once collapsed to 0 px (macOS pass).
    const pageHeight = () => app.evaluate("document.querySelector('#about-dialog .about-page').getBoundingClientRect().height");
    const t = await pageText();
    assert((await pageHeight()) > 150, `About tab visible: ${await pageHeight()} px`);
    assert(t.includes("Based on CirthScribe by Jared Hoy"), "attribution");
    assert(/GNU General Public License, version 3 only/.test(t) && /no warranty/i.test(t), "GPL notice and no warranty");
    assert(t.includes("ADDITIONAL TERMS UNDER SECTION 7(b)"), "NOTICE text with the 7(b) term");
    await clickHome(app, '[data-about-tab="gpl"]');
    assert((await pageText()).includes("GNU GENERAL PUBLIC LICENSE") && (await pageText()).includes("Version 3, 29 June 2007"), "full GPL text");
    assert((await pageHeight()) > 150, `GPL tab visible: ${await pageHeight()} px`);
    await clickHome(app, '[data-about-tab="third"]');
    const third = await pageText();
    assert((await pageHeight()) > 150, `third-party tab visible: ${await pageHeight()} px`);
    for (const name of ["Courier Prime", "SCOWL dictionary en_US-large", "spellbook 0.4.2", "prosemirror-view", "tauri "]) assert(third.includes(name), `third-party list has ${name}`);
    assert(third.includes("SIL OPEN FONT LICENSE"), "OFL text included");
    await screenshot(app, "about");
    await app.evaluate("(() => { document.getElementById('about-close').click(); return true; })()");
    assert(!(await app.evaluate("document.getElementById('about-dialog').open")), "closed");
    await app.evaluate("__cirth.menu('about')");
    await waitFor(app, "document.getElementById('about-dialog').open && document.getElementById('about-dialog').dataset.tab === 'about'", "About from the menu");
    await app.evaluate("__cirth.about.close()");
  });

  await test("Page size is stored per document and survives reopening; text export matches the page map", async () => {
    await openFixture("page-boundaries");
    assert((await app.evaluate("document.getElementById('profile').value")) === "letter", "new documents are US Letter");
    const pagesOf = (profile) => app.evaluate(`window.__TAURI_INTERNALS__.invoke('paginate', { profile: ${JSON.stringify(profile)} }).then(p => p.map.pages.length)`);
    await app.evaluate("(() => { const s = document.getElementById('profile'); s.value = 'a4'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "__cirth.pagination && __cirth.pagination.map.profile.includes('a4')", "repaginated as A4");
    // Close and reopen (without resetting the sample): still A4.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, "!!__cirth.lastOpen", "reopened");
    assert((await app.evaluate("document.getElementById('profile').value")) === "a4", "A4 kept after reopening");
    await waitFor(app, "__cirth.pagination && __cirth.pagination.map.profile.includes('a4')", "A4 pagination after reopening");
    // Text export uses the document's page size and the same pages.
    const out = join(dataDir, "page boundaries.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "exported");
    const txt = readFileSync(out, "utf8");
    const pages = await pagesOf("a4");
    assert(txt.split("\f").length === pages, `${txt.split("\f").length} text pages vs ${pages} in the A4 page map`);
    const banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(banner.includes("(A4)") && banner.includes("form feed"), `export reported with its limits: ${banner}`);
    // Cues sit 22 columns in from the action margin, as in the PDF.
    const cue = (await blocks()).find((b) => b.kind === "character" && !b.dual);
    const name = text(cue).toUpperCase();
    assert(txt.split("\n").some((l) => l.startsWith(" ".repeat(22) + name)), `cue ${name} at column 22`);
    // Every scene heading is in the text, in order (long ones wrap, so match the start).
    let at = 0;
    for (const h of (await blocks()).filter((b) => b.kind === "heading")) {
      const i = txt.indexOf(text(h).toUpperCase().slice(0, 30), at);
      assert(i >= at, `heading ${text(h)} in order`);
      at = i;
    }
    // Back to Letter for the tests that follow.
    await app.evaluate("(() => { const s = document.getElementById('profile'); s.value = 'letter'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "__cirth.pagination && !__cirth.pagination.map.profile.includes('a4')", "back to Letter");
  });

  // Every visible control has an accessible name; ids are unique; aria
  // references resolve; the background save lines are not live regions.
  const AUDIT = `(() => {
    const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const text = (e) => (e?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const nameOf = (e) => {
      const by = e.getAttribute('aria-labelledby');
      if (by) return by.split(/\\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
      if (e.getAttribute('aria-label')) return e.getAttribute('aria-label').trim();
      if (e.labels && e.labels.length) return [...e.labels].map(text).join(' ').trim();
      if (['BUTTON', 'A'].includes(e.tagName) || ['button', 'tab', 'listitem'].includes(e.getAttribute('role'))) return text(e) || (e.title ?? '').trim();
      return (e.title ?? '').trim();
    };
    const sel = 'button, input:not([type=hidden]), select, textarea, a[href], [tabindex], [contenteditable=true], [role=button], [role=tab]';
    const unnamed = [...document.querySelectorAll(sel)].filter(visible).filter((e) => !nameOf(e)).map((e) => e.outerHTML.slice(0, 140));
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    const refs = [...document.querySelectorAll('[aria-describedby], [aria-labelledby], [aria-controls]')].flatMap((e) => ['aria-describedby', 'aria-labelledby', 'aria-controls'].flatMap((a) => (e.getAttribute(a) || '').split(/\\s+/).filter(Boolean)));
    const badRefs = refs.filter((id) => !document.getElementById(id));
    const chatty = ['status', 'file-status', 'fw-status'].filter((id) => { const e = document.getElementById(id); return e && (e.getAttribute('aria-live') ?? (e.getAttribute('role') === 'status' ? 'polite' : 'off')) !== 'off'; });
    return { unnamed, dup, badRefs, chatty };
  })()`;
  const audit = async (where) => {
    const r = await app.evaluate(AUDIT);
    assert(!r.unnamed.length, `${where}: controls without a name: ${r.unnamed.join(" | ")}`);
    assert(!r.dup.length, `${where}: duplicate ids ${r.dup.join(", ")}`);
    assert(!r.badRefs.length, `${where}: aria references to missing ids ${r.badRefs.join(", ")}`);
    assert(!r.chatty.length, `${where}: save status announced on every change: ${r.chatty.join(", ")}`);
  };
  const announced = () => app.evaluate("document.getElementById('announce')?.textContent ?? ''");
  // Messages land a moment after the change (the region is cleared first).
  const waitAnnounced = (part, what) => waitFor(app, `(document.getElementById('announce')?.textContent ?? '').includes(${JSON.stringify(part)})`, what);

  await test("Accessibility audit: names, unique ids, aria references, quiet save status (Home, editor, find, Free Writing, About)", async () => {
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await audit("Home");
    await openFixture("page-boundaries");
    await audit("Editor");
    await app.evaluate("__cirth.menu('find')");
    await audit("Editor with find bar");
    await app.evaluate("(() => { document.getElementById('find-close').click(); return true; })()");
    await fwOpen();
    await app.evaluate("(() => { document.getElementById('fw-new').click(); return true; })()");
    await waitFor(app, "!!__cirth.free.current", "piece open");
    await audit("Free Writing");
    await app.evaluate("(() => { document.getElementById('fw-back').click(); return true; })()");
    await app.evaluate("__cirth.about.open()");
    await audit("About");
    await app.evaluate("__cirth.about.close()");
  });

  await test("Keyboard only: F6 between panels; navigator and board are one Tab stop each; Alt+arrows move with announcements", async () => {
    await openFixture("page-boundaries");
    const ids = async () => (await app.evaluate("__cirth.scenes().map(s => s.sceneId)"));
    const order0 = await ids();
    await caretAtEndOf(0);
    const activeIn = (sel) => app.evaluate(`!!document.activeElement && !!document.activeElement.closest(${JSON.stringify(sel)})`);
    // F6 from the editor: board, then toolbar, navigator, editor; Shift+F6 goes back.
    await press("F6");
    assert(await activeIn("#board"), "F6: board");
    await press("F6");
    assert(await activeIn(".toolbar"), "F6: toolbar");
    await press("F6");
    assert(await activeIn("#navigator"), "F6: navigator");
    await press("F6");
    assert(await app.evaluate("document.activeElement === __cirth.view.dom"), "F6: editor");
    await press("F6", ["shift"]);
    assert(await activeIn("#navigator"), "Shift+F6: back to the navigator");
    // One Tab stop per list.
    const tabStops = (sel) => app.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel + " button, " + sel + " textarea, " + sel + " [tabindex]")})].filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length).length`);
    assert((await tabStops("#navigator")) === 1, `navigator tab stops ${await tabStops("#navigator")}`);
    // Escape in the editor goes to the navigator's current scene.
    await caretAtEndOf(0);
    await press("Escape");
    const focusedScene = () => app.evaluate("document.activeElement?.closest('[data-item]')?.dataset.item ?? null");
    assert((await focusedScene()) === order0[0], "Escape: current scene in the navigator");
    await press("ArrowDown");
    assert((await focusedScene()) === order0[1], "ArrowDown: next scene");
    await press("Enter");
    assert(await app.evaluate(`document.activeElement === __cirth.view.dom && document.querySelector('#navigator li.current')?.dataset.item === ${JSON.stringify(order0[1])}`) || (await sleep(300), await app.evaluate(`document.querySelector('#navigator li.current')?.dataset.item === ${JSON.stringify(order0[1])}`)), "Enter: caret in scene 2");
    // Alt+Down moves scene 2 to position 3; focus stays on it; it is announced.
    await press("Escape");
    await sleep(250);
    assert((await focusedScene()) === order0[1], "back on scene 2");
    await press("ArrowDown", ["alt"]);
    await waitFor(app, `__cirth.scenes()[2]?.sceneId === ${JSON.stringify(order0[1])}`, "scene moved down");
    await sleep(300);
    assert((await focusedScene()) === order0[1], `focus follows the moved scene (${await focusedScene()})`);
    await waitAnnounced("position 3 of 4", "move announced");
    await app.evaluate("__cirth.view.focus()");
    await press("z", [MOD_KEY]);
    assert(JSON.stringify(await ids()) === JSON.stringify(order0), "one undo restores the order");
    // Board (planning only): arrows choose, Alt+Right moves the card, script untouched.
    await sleep(300);
    const cardOrder = () => app.evaluate("[...document.querySelectorAll('#board .card')].map(c => c.dataset.item)");
    const cards0 = await cardOrder();
    await app.evaluate("document.querySelector('#board .card[tabindex=\"0\"]').focus()");
    assert((await focusedScene()) === cards0[0], "first card focused");
    const boardStops = await tabStops("#board .cards");
    assert(boardStops === 4, `board tab stops: chosen card and its 3 controls, got ${boardStops}`);
    await press("ArrowRight", ["alt"]);
    await waitFor(app, `JSON.stringify([...document.querySelectorAll('#board .card')].map(c => c.dataset.item)) !== ${JSON.stringify(JSON.stringify(cards0))}`, "card moved");
    assert((await cardOrder())[1] === cards0[0], "card now second");
    assert((await focusedScene()) === cards0[0], "focus stays on the moved card");
    await waitAnnounced("The script is unchanged", "card move announced");
    assert(JSON.stringify(await ids()) === JSON.stringify(order0), "script order untouched in planning mode");
    await press("ArrowRight");
    assert((await focusedScene()) === (await cardOrder())[2], "ArrowRight: next card");
    await press("Enter");
    assert(await app.evaluate("document.activeElement?.dataset.part === 'summary'"), "Enter: edit the summary");
    await press("Escape");
    assert(await app.evaluate("document.activeElement?.classList.contains('card')"), "Escape: back to the card");
  });

  await test("Display: UI size and high contrast persist across restarts; theme colours meet contrast minimums", async () => {
    const ratio = `(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => { let h = css.getPropertyValue(v).trim().replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };
      const lum = (v) => { const [r, g, b] = rgb(v); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const out = {};
      for (const fg of ['--ink', '--muted', '--accent', '--warn', '--bad']) for (const bg of ['--bg', '--panel']) out[fg + ' on ' + bg] = Math.round(cr(fg, bg) * 100) / 100;
      return out;
    })()`;
    const check = async (min, label) => {
      const r = await app.evaluate(ratio);
      const low = Object.entries(r).filter(([, v]) => !(v >= min));
      assert(!low.length, `${label}: below ${min}:1: ${JSON.stringify(low)}`);
    };
    await check(4.5, "standard theme");
    const w0 = await app.evaluate("window.innerWidth");
    await press("=", [MOD_KEY]);
    await press("=", [MOD_KEY]);
    await waitFor(app, "__cirth.prefs().scale === 1.2", "scale 120%").catch(async (e) => {
      throw new Error(`${e.message}; prefs ${JSON.stringify(await app.evaluate("__cirth.prefs()"))}, announced '${await announced()}'`);
    });
    await waitAnnounced("120 percent", "size announced");
    if (driver.name === "cdp") {
      const w1 = await app.evaluate("window.innerWidth");
      assert(Math.abs(w1 - w0 / 1.2) < 3, `whole window zoomed: ${w0} -> ${w1}`);
    }
    await app.evaluate("__cirth.menu('ui_contrast')");
    await waitFor(app, "document.documentElement.dataset.contrast === 'high'", "high contrast on");
    await check(7, "high contrast");
    // Preferences are written at once: a hard kill keeps them.
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-prefs-kill");
    await waitHome(app);
    await waitFor(app, "__cirth.prefs().scale === 1.2 && document.documentElement.dataset.contrast === 'high'", "preferences restored");
    await screenshot(app, "high-contrast-home");
    await press("0", [MOD_KEY]);
    await app.evaluate("__cirth.menu('ui_contrast')");
    await waitFor(app, "__cirth.prefs().scale === 1 && !document.documentElement.dataset.contrast", "back to defaults");
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(saved.scale === 1 && saved.contrast === "system", `stored ${JSON.stringify(saved)}`);
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

  await test("Offline (A1): create, write, save, reopen, export, Free Writing and About reach nothing outside the app", async () => {
    // Record every request the page makes (resource timing, including IPC)
    // and every Content Security Policy refusal, from page load on.
    await app.evaluate(`(() => {
      window.__net = { urls: performance.getEntriesByType('resource').map(e => e.name), refused: [] };
      new PerformanceObserver(l => { for (const e of l.getEntries()) __net.urls.push(e.name); }).observe({ type: 'resource' });
      document.addEventListener('securitypolicyviolation', e => __net.refused.push(e.effectiveDirective + ' ' + e.blockedURI));
      return true; })()`);
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await app.evaluate(`(() => { const i = document.getElementById('new-title'); i.value = 'Offline Check'; i.form.requestSubmit(); return true; })()`);
    await waitOpen(app);
    const key = (await app.evaluate("__cirth.lastOpen")).name;
    await caretAtEndOf(0);
    await typeText("INT. CABIN - NIGHT");
    await press("Enter");
    await typeText("No signal. Speling still checked.");
    const v0 = await app.evaluate("__cirth.fileSavedVersion");
    await press("s", [MOD_KEY]);
    await waitFor(app, `__cirth.fileSavedVersion > ${v0}`, "save");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, `[data-project="${key}"]`);
    await waitOpen(app);
    assert((await blocks()).some((b) => text(b).startsWith("No signal.")), "text back after reopening");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(join(dataDir, "offline.txt"))})`), "text export");
    await app.evaluate("(() => { document.getElementById('pdf').click(); return true; })()");
    await waitFor(app, "/PDF proof/.test(document.getElementById('banner').textContent)", "PDF export");
    await fwOpen();
    await app.evaluate("(() => { document.getElementById('fw-new').click(); return true; })()");
    await fwFocusBody();
    await typeText("offline notes");
    await fwSaved();
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await clickHome(app, "#open-about");
    await waitFor(app, "document.getElementById('about-dialog')?.open === true", "About");
    await app.evaluate("__cirth.about.close()");

    // The policy must refuse an outside address (.invalid never resolves, so
    // nothing leaves the machine even if the policy were missing).
    const probe = await app.evaluate(`fetch('http://offline-check.invalid/x').then(() => 'reached', e => 'refused: ' + e.name)`);
    await sleep(300);
    const net = await app.evaluate("__net");
    assert(probe.startsWith("refused"), `outside fetch was ${probe}`);
    assert(net.refused.some((r) => r.startsWith("connect-src") && r.includes("offline-check.invalid")), `CSP refused the probe: ${JSON.stringify(net.refused)}`);
    // App origins: tauri://localhost and ipc://localhost (macOS, Linux),
    // http://tauri.localhost and http://ipc.localhost (Windows); data: and blob: are local.
    const local = (u) => /^(data|blob):/.test(u) || (() => { try { const h = new URL(u).hostname; return h === "localhost" || h.endsWith(".localhost"); } catch { return false; } })();
    const outside = net.urls.filter((u) => !local(u) && !u.includes("offline-check.invalid"));
    // WebView2 serves the app over http://*.localhost, which resource timing
    // records; WebKit (tauri://, ipc://) does not record custom-scheme loads,
    // so there only outside http(s) requests and policy refusals would show.
    const scheme = await app.evaluate("location.protocol");
    if (scheme.startsWith("http")) assert(net.urls.length > 10, `requests were recorded (${net.urls.length})`);
    assert(outside.length === 0, `requests outside the app: ${outside.join(", ")}`);
    const otherRefusals = net.refused.filter((r) => !r.includes("offline-check.invalid"));
    assert(otherRefusals.length === 0, `the app itself tried something the policy refused: ${otherRefusals.join(", ")}`);
    return { scheme, requests: net.urls.length, origins: [...new Set(net.urls.map((u) => { try { return new URL(u).origin; } catch { return u.slice(0, 10); } }))] };
  });

  await test("Navigator click goes to the scene: heading scrolled into view, caret at its end, Enter continues the scene", async () => {
    await openFixture("long-120");
    await app.evaluate("(() => { document.querySelector('.editor-wrap').scrollTop = 0; return true; })()");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const target = scenes[Math.floor(scenes.length * 0.6)];
    await clickHome(app, `#navigator [data-item="${target}"] [data-part="go"]`);
    await sleep(300);
    const where = await app.evaluate(`(() => {
      const v = __cirth.view; const h = document.querySelector('.ProseMirror [data-scene-id="${target}"]').getBoundingClientRect();
      const wrap = document.querySelector('.editor-wrap').getBoundingClientRect();
      const $p = v.state.selection.$from;
      return { top: h.top - wrap.top, bottom: wrap.bottom - h.bottom, inHeading: $p.parent.attrs.sceneId === ${JSON.stringify(target)}, atEnd: $p.parentOffset === $p.parent.content.size, focused: v.hasFocus() };
    })()`);
    assert(where.top >= 0 && where.bottom >= 0, `heading visible in the script: ${JSON.stringify(where)}`);
    assert(where.inHeading && where.atEnd && where.focused, `caret at the end of the heading: ${JSON.stringify(where)}`);
    const before = await blocks();
    const i = before.findIndex((b) => b.scene_id === target);
    await press("Enter");
    const after = await blocks();
    assert(after.length === before.length + 1, "one block added");
    assert(after[i].id === before[i].id && text(after[i]) === text(before[i]), "heading unchanged and still in place");
    assert(after[i + 1].kind !== "heading" && text(after[i + 1]) === "", `Enter adds an empty ${after[i + 1].kind} after the heading, not a heading above it`);
  });

  await test("Help > Typing Latency reports the editor's own samples as copyable text", async () => {
    await openFixture("page-boundaries", false);
    await app.evaluate("__cirth.perf.reset()");
    await caretAtEndOf(1);
    await typeText(" measured keys");
    await sleep(300);
    await app.evaluate("__cirth.menu('latency')");
    await waitFor(app, "document.getElementById('latency-dialog')?.open === true", "Typing Latency open");
    await audit("Typing Latency");
    const report = () => app.evaluate("document.querySelector('#latency-dialog textarea').value");
    let r = await report();
    const n = Number(/Key presses measured: (\d+)/.exec(r)?.[1]);
    const expected = await app.evaluate("__cirth.perf.summary().n");
    assert(n === expected && n >= 14, `report counts the samples: ${n} (log has ${expected})`);
    assert(/Median: [\d.]+ ms {2}p95: [\d.]+ ms/.test(r), `percentiles shown: ${r}`);
    assert(r.includes("not enough key presses yet"), "says when there are too few samples");
    assert(/Last open: [\d.]+ ms for \d+ blocks/.test(r), "last open time shown");
    assert(r.includes(await app.evaluate("navigator.userAgent")), "system identified");
    assert(/^CirthScribe \d+\.\d+\.\d+ typing latency/.test(r), `app version shown: ${r.split("\n")[0]}`);
    await app.evaluate("(() => { document.getElementById('latency-reset').click(); return true; })()");
    r = await report();
    assert(r.includes("Key presses measured: 0"), "Start over clears the samples");
    await app.evaluate("(() => { document.getElementById('latency-copy').click(); return true; })()");
    await waitFor(app, "/Copied|Selected/.test(document.querySelector('#latency-dialog .latency-note').textContent)", "copy feedback");
    await app.evaluate("__cirth.latency.close()");
    assert(!(await app.evaluate("document.getElementById('latency-dialog').open")), "closed");
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
