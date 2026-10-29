// The end-to-end suite, independent of the automation driver. Every test
// talks to the app through: evaluate, press, type, insertText, imeCompose,
// screenshot, kill, close. Tests that a driver or machine cannot perform
// honestly throw Skip with the reason; skips are reported, never counted as
// passes.

import { writeFileSync, mkdirSync, copyFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

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
  // Per-trial detail for misses with the fix on, so a rare miss can be
  // diagnosed (2026-10-26: one miss in a full-suite run that 10,500 isolated
  // trials did not reproduce).
  const caretMisses = [];
  async function caretKeyTrials(trials, enabled) {
    await openFixture("unicode-marks");
    await app.evaluate(`(() => {
      if (!window.__caretLogInstalled) {
        window.__caretLogInstalled = true;
        // [event, key/inputType, ms, pm anchor, pm head, adoptions, defaultPrevented, window focus, view.composing, editor focused]
        const rec = (tag) => (e) => { const v = __cirth.view; const s = v.state.selection; window.__caretLog.push([tag, (e && (e.key || e.inputType || e.data)) || '', Math.round(performance.now()), s.anchor, s.head, __cirth.selSync.adopted, e && e.defaultPrevented ? 1 : 0, document.hasFocus() ? 1 : 0, v.composing ? 1 : 0, document.activeElement === v.dom ? 1 : 0]); };
        window.addEventListener('keydown', rec('kd'), true);
        window.addEventListener('keydown', rec('kd-after'), false);
        document.addEventListener('selectionchange', rec('sc'), true);
        for (const t of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'focusin', 'focusout']) window.addEventListener(t, rec(t), true);
      }
      window.__caretLog = [];
      __cirth.selSync.enabled = ${enabled}; window.__jank = setInterval(() => { const t = performance.now(); while (performance.now() - t < 40) {} }, 50); })()`);
    const n0 = (await blocks()).length;
    await caretAtEndOf(n0 - 1);
    let missed = 0;
    try {
      for (let t = 0; t < trials; t++) {
        await app.evaluate("(window.__caretLog = [], true)");
        await press("Enter");
        await typeText("abc");
        await press("Home");
        await sleep(120); // let Home settle so only End can be stale
        await press("End");
        await press("Enter");
        const r = await app.evaluate("(() => { const b = __cirth.blocks(); const t = x => x.runs.map(r => r.text).join(''); return [t(b.at(-2)), t(b.at(-1))]; })()");
        if (r[0] !== "abc" || r[1] !== "") {
          missed++;
          if (enabled) caretMisses.push({ trial: t, result: r, lastBlocks: (await blocks()).slice(-4).map((b) => `${b.kind}:${text(b)}`), log: await app.evaluate("window.__caretLog") });
        }
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
    if (caretMisses.length) results.measurements.caretKeyMisses = caretMisses;
    assert(fixed === 0, `fix on: ${fixed}/500 missed; detail in results.measurements.caretKeyMisses: ${JSON.stringify(caretMisses).slice(0, 1500)}`);
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
    // Our own copy of a cue and its dialogue, pasted into an empty action
    // line: the cue stays a cue (macOS pass: it became action).
    const own = await app.evaluate(`(() => {
      const v = __cirth.view; const ps = []; v.state.doc.forEach((n, p) => ps.push([p, n]));
      const at = ps.findLastIndex(([, n]) => n.attrs.kind === 'character' && n.textContent === 'KAITO');
      const sel = v.state.selection.constructor.create(v.state.doc, ps[at][0] + 1, ps[at + 1][0] + ps[at + 1][1].nodeSize - 1);
      const r = v.serializeForClipboard(sel.content());
      return { html: r.dom.innerHTML, text: r.text };
    })()`);
    assert(own.html.includes("data-kind"), "own copy carries block types");
    await caretAtEndOf(b.length - 1);
    await press("Enter");
    await press("Enter");
    n2 = (await blocks()).length;
    const emptyKind = (await blocks()).at(-1).kind;
    await pasteEvent({ "text/html": own.html, "text/plain": own.text });
    b = await blocks();
    rich = b.slice(n2 - 1);
    assert(rich.map((x) => `${x.kind}:${text(x)}`).join("|") === "character:KAITO|dialogue:The clipboard came from the OS.", `own copy into an empty ${emptyKind} line: ${JSON.stringify(rich.map((x) => [x.kind, text(x)]))}`);
    assert(rich[1].runs.some((r) => r.italic && r.text === "from"), "styles kept in own copy");
    // Part of one block still pastes inline.
    await caretAtEndOf(b.length - 1);
    const partial = await app.evaluate(`(() => { const v = __cirth.view; const r = v.serializeForClipboard(v.state.doc.slice(v.state.selection.from - 4, v.state.selection.from)); return { html: r.dom.innerHTML, text: r.text }; })()`);
    await pasteEvent({ "text/html": partial.html, "text/plain": partial.text });
    b = await blocks();
    assert(b.length === n2 + 1 && text(b.at(-1)).endsWith("OS.OS."), `partial copy inline: ${text(b.at(-1))}`);
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
    // Cards are planning cards: logline and summary, never a copy of the scene.
    const cardSel = `#board .card[data-beat-id="${beat0.id}"]`;
    const card = await app.evaluate(`(() => { const el = document.querySelector('${cardSel}'); return { all: el.textContent + [...el.querySelectorAll('input, textarea')].map(i => i.value).join(' '), summary: el.querySelector('.summary').value, logline: el.querySelector('.logline').value }; })()`);
    assert(!card.all.includes("LIVE-EDIT") && !card.all.includes(text((await blocks())[1]).slice(0, 20)), `card copies no script text: ${card.all}`);
    assert(card.summary === beat0.summary && card.logline === "", "summary unchanged; logline empty until written");
    // Write a logline: stored with the beat, kept after reopening.
    await app.evaluate(`(() => { const i = document.querySelector('${cardSel} .logline'); i.value = 'The ledger goes missing'; i.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(300);
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(beat0.id)})?.logline === 'The ledger goes missing' && document.querySelector('${cardSel} .logline')?.value === 'The ledger goes missing'`, "logline kept after reopening");
    await screenshot(app, "logline-cards");
    // Typing in a logline (not yet committed) survives a board re-render.
    await app.evaluate(`(() => { const i = document.querySelector('${cardSel} .logline'); i.focus(); i.value = 'Half-typed logline'; window.__loglineEl = i; return true; })()`);
    await app.evaluate("__cirth.setStructural(false)");
    assert(await app.evaluate(`document.querySelector('${cardSel} .logline') === window.__loglineEl && window.__loglineEl.value === 'Half-typed logline' && document.activeElement === window.__loglineEl`), "unsaved logline text kept through a re-render");
    await app.evaluate("(() => { document.activeElement.blur(); return true; })()");
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

  await test("Planning undo (ADR 0003): card text, new cards and planning moves undo and redo from the board; a move that reorders the script undoes once from the board; two cards on one scene never clone it (B2-B4); the permission is stored per document", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const order = () => app.evaluate("__cirth.scenes().map(s => s.sceneId).join()");
    const cards = () => app.evaluate("JSON.parse(JSON.stringify(__cirth.board.beats))");
    const boardOrder = () => app.evaluate("[...document.querySelectorAll('#board .card')].map(c => c.dataset.beatId).join()");
    const undoInBoard = async (again = false) => {
      await app.evaluate("(document.querySelector('#board .card[tabindex=\"0\"]').focus(), true)");
      await press("z", again ? [MOD_KEY, "shift"] : [MOD_KEY]);
    };
    const heard = (part, what) => waitFor(app, `(document.getElementById('announce')?.textContent ?? '').includes(${JSON.stringify(part)})`, what);
    const order0 = await order();
    const script0 = JSON.stringify(await blocks());
    // Card text: committed once, undone from the board, redone.
    const c0 = (await cards())[0];
    const sel = `#board .card[data-beat-id="${c0.id}"]`;
    await app.evaluate(`(() => { const i = document.querySelector('${sel} .logline'); i.value = 'A logline to undo'; i.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(c0.id)}).logline === 'A logline to undo'`, "logline stored");
    await undoInBoard();
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(c0.id)}).logline === '' && document.querySelector('${sel} .logline').value === ''`, "Ctrl/Cmd+Z in the board undoes the card text");
    await heard("Card change undone", "announced");
    await undoInBoard(true);
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(c0.id)}).logline === 'A logline to undo'`, "redo puts it back");
    // A new card: undo removes it.
    const n0 = (await cards()).length;
    await app.evaluate("(document.querySelector('#board .board-head button:not(.panel-pop)').click(), true)");
    await waitFor(app, `__cirth.board.beats.length === ${n0 + 1}`, "new card added");
    await undoInBoard();
    await waitFor(app, `__cirth.board.beats.length === ${n0}`, "undo removes the new card");
    // B2: a planning-only move leaves the script alone; undo restores the board order.
    await app.evaluate("__cirth.setStructural(false)");
    const b0 = await boardOrder();
    await app.evaluate(`__cirth.moveCard(${JSON.stringify(c0.id)}, null)`);
    await waitFor(app, `[...document.querySelectorAll('#board .card')].map(c => c.dataset.beatId).join() !== ${JSON.stringify(b0)}`, "card moved on the board");
    assert((await order()) === order0, "B2: script order unchanged");
    await undoInBoard();
    await waitFor(app, `[...document.querySelectorAll('#board .card')].map(c => c.dataset.beatId).join() === ${JSON.stringify(b0)}`, "undo restores the board order");
    assert(JSON.stringify(await blocks()) === script0, "no planning step touched the script");
    // B4: two cards on one scene. Moving one never clones or moves the scene.
    const extra = { id: "b4-second-card", logline: "Second card on scene 2", summary: "", scene_id: scenes[1], pos: 999 };
    await app.evaluate(`__cirth.putBeat(${JSON.stringify(extra)})`);
    await waitFor(app, "__cirth.board.beats.filter(b => b.scene_id === " + JSON.stringify(scenes[1]) + ").length === 2", "two cards on scene 2");
    const ids0 = (await blocks()).map((b) => b.id).sort().join();
    await app.evaluate(`__cirth.moveCard('b4-second-card', null)`);
    await sleep(200);
    assert((await order()) === order0 && (await blocks()).map((b) => b.id).sort().join() === ids0, "B4: moving one of two cards leaves the scene where it is, unclone");
    // B3 from the board: with permission on, a card move reorders the script once; Ctrl/Cmd+Z in the board undoes it once.
    await app.evaluate("__cirth.setStructural(true)");
    const first = (await cards()).find((b) => b.scene_id === scenes[0]);
    const third = (await cards()).find((b) => b.scene_id === scenes[2]);
    await app.evaluate(`__cirth.moveCard(${JSON.stringify(first.id)}, ${JSON.stringify(third.id)})`);
    await waitFor(app, `__cirth.scenes()[0].sceneId === ${JSON.stringify(scenes[1])}`, "the script order changed");
    assert((await blocks()).map((b) => b.id).sort().join() === ids0, "B3: same block ids, no clones");
    await undoInBoard();
    await waitFor(app, `__cirth.scenes().map(s => s.sceneId).join() === ${JSON.stringify(order0)}`, "one undo in the board restores the script order");
    await heard("Scene move undone", "announced");
    assert(await storedMatchesEditor(), "stored order equals the editor");
    // If the script changed after the move, the board does not undo something else.
    await app.evaluate(`__cirth.moveCard(${JSON.stringify(first.id)}, ${JSON.stringify(third.id)})`);
    await waitFor(app, `__cirth.scenes()[0].sceneId === ${JSON.stringify(scenes[1])}`, "moved again");
    await caretAtEndOf(1);
    await typeText(" EDIT");
    await sleep(700);
    const typed = JSON.stringify(await blocks());
    await undoInBoard();
    await heard("The script has changed since that move", "the board explains");
    assert(JSON.stringify(await blocks()) === typed, "the board left the script alone");
    // The permission is stored per document: kept after reopening, off in another project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, "document.getElementById('structural').checked && __cirth.board.structural", "permission kept after reopening");
    await openFixture("unicode-marks");
    assert(!(await app.evaluate("document.getElementById('structural').checked")), "another document starts with it off");
  });

  await test("Episodes and series: File > Episodes and Documents adds a season folder and an episode; each document has its own script, scene list and cards; rename and move; the open episode is kept", async () => {
    await openFixture("page-boundaries");
    const pilotBlocks = JSON.stringify(await blocks());
    const pilotScenes = (await app.evaluate("__cirth.scenes()")).length;
    const pilotCards = await app.evaluate("__cirth.board.beats.length");
    const treeRows = () => app.evaluate("[...document.querySelectorAll('#tree-list li')].map(li => li.querySelector('.tree-name').textContent + '|' + li.style.paddingLeft + '|' + li.querySelector('.tree-meta').textContent)");
    const click = (id) => app.evaluate(`(document.getElementById('${id}').click(), true)`);
    const choose = (title) => app.evaluate(`(() => { const li = [...document.querySelectorAll('#tree-list li')].find(l => l.querySelector('.tree-name').textContent.replace('▸ ', '') === ${JSON.stringify(title)}); li.click(); return !!li; })()`);
    const submitTitle = (t) => app.evaluate(`(() => { const i = document.getElementById('tree-rename-input'); i.value = ${JSON.stringify(t)}; i.form.requestSubmit(); return true; })()`);
    await app.evaluate("(__cirth.menu('project_tree'), true)");
    await waitFor(app, "document.getElementById('tree-dialog').open && document.querySelectorAll('#tree-list li').length === 1", "the tree lists the project's one script");
    assert(/open/.test((await treeRows())[0]), `the open document is marked: ${await treeRows()}`);
    // A season folder, then an episode inside it.
    await click("tree-new-folder");
    await submitTitle("Season 1");
    await waitFor(app, "[...document.querySelectorAll('#tree-list .tree-name')].some(n => n.textContent === '▸ Season 1')", "folder added");
    await choose("Season 1");
    await click("tree-new-episode");
    await submitTitle("Episode 1: Low Water");
    await waitFor(app, "document.querySelectorAll('#tree-list li').length === 3", "episode added");
    const rows = await treeRows();
    assert(rows[2].startsWith("Episode 1: Low Water|26px"), `the episode sits inside the season: ${rows}`);
    // Open it: an empty script with one scene, no cards; the status bar names both.
    await choose("Episode 1: Low Water");
    await click("tree-open");
    await waitFor(app, "!document.getElementById('tree-dialog').open && __cirth.scenes().length === 1 && __cirth.board.beats.length === 0", "the episode opens with one empty scene and no cards");
    assert(/›\s*Episode 1: Low Water$/.test(await app.evaluate("document.getElementById('project-title').textContent")), "the status bar shows project › episode");
    await caretAtEndOf(0);
    await typeText("INT. HARBOUR - DAWN");
    await app.evaluate("(document.querySelector('#board .board-head button:not(.panel-pop)').click(), true)");
    await waitFor(app, "__cirth.board.beats.length === 1", "a card in the episode");
    assert(await storedMatchesEditor(), "the episode's edits are stored");
    // Back to the pilot: its script and cards as they were.
    await app.evaluate("(__cirth.menu('project_tree'), true)");
    await waitFor(app, "document.getElementById('tree-dialog').open", "tree again");
    await choose((await app.evaluate("[...document.querySelectorAll('#tree-list .tree-name')].map(n => n.textContent)"))[0]);
    await click("tree-open");
    await waitFor(app, `__cirth.scenes().length === ${pilotScenes} && __cirth.board.beats.length === ${pilotCards}`, "the pilot opens with its own scenes and cards");
    assert(JSON.stringify(await blocks()) === pilotBlocks, "the pilot's script is unchanged");
    // Rename and move: the episode up to the top level, renamed; a folder is never offered as its own target.
    await app.evaluate("(__cirth.menu('project_tree'), true)");
    await waitFor(app, "document.getElementById('tree-dialog').open", "tree again");
    await choose("Season 1");
    assert(!(await app.evaluate("[...document.getElementById('tree-into').options].some(o => o.textContent.trim() === 'Season 1')")), "a folder cannot be moved into itself");
    await choose("Episode 1: Low Water");
    await click("tree-rename");
    await submitTitle("Episode 1: Neap Tide");
    await waitFor(app, "[...document.querySelectorAll('#tree-list .tree-name')].some(n => n.textContent === 'Episode 1: Neap Tide')", "renamed");
    await app.evaluate("(() => { const s = document.getElementById('tree-into'); s.value = '__top'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "(() => { const li = [...document.querySelectorAll('#tree-list li')].find(l => l.querySelector('.tree-name').textContent === 'Episode 1: Neap Tide'); return li && li.style.paddingLeft === '8px'; })()", "moved to the top level");
    await click("tree-close");
    // Kept with the project: reopening shows the same tree, on the last open document.
    await app.evaluate("__cirth.openDocument(" + JSON.stringify(await app.evaluate("(async () => (await window.__TAURI_INTERNALS__.invoke('project_tree')).find(i => i.title === 'Episode 1: Neap Tide').id)()")) + ")");
    await waitFor(app, "__cirth.scenes().length === 1 && __cirth.scenes()[0].heading === 'INT. HARBOUR - DAWN'", "the episode again");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, "__cirth.scenes().length === 1 && /Neap Tide$/.test(document.getElementById('project-title').textContent)", "reopening lands on the episode that was open");
    const tree = await app.evaluate("window.__TAURI_INTERNALS__.invoke('project_tree')");
    assert(tree.length === 3 && tree.some((i) => i.title === "Season 1" && i.kind === "folder"), `tree kept: ${JSON.stringify(tree.map((i) => i.title))}`);
  });

  await test("Navigator tabs: scenes show page, length in eighths, speakers and their card; filter; labels with names and undo; Characters tab; whole-project scope opens another episode", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => ({ id: s.sceneId, heading: s.heading }))");
    await waitFor(app, `document.querySelectorAll('#navigator .nav-list li .nav-page').length === ${scenes.length}`, "every scene shows its page and length");
    const rows = await app.evaluate("[...document.querySelectorAll('#navigator .nav-list li')].map(li => ({ page: li.querySelector('.nav-page')?.textContent, len: li.querySelector('.nav-len')?.textContent, chars: li.querySelector('.nav-chars')?.textContent ?? '' }))");
    assert(rows[0].page === "p. 1" && /^(\d+ )?\d\/8$|^\d+$/.test(rows[0].len), `page and eighths: ${JSON.stringify(rows[0])}`);
    assert(rows.some((r) => /INES/.test(r.chars)) && rows.some((r) => /PELL/.test(r.chars)), `speakers listed: ${JSON.stringify(rows.map((r) => r.chars))}`);
    assert(/estimate/.test(await app.evaluate("document.querySelector('#navigator .nav-len').title")), "length is labelled as an estimate");
    // Filter: matches headings, speakers, labels and card text; typing keeps focus.
    await app.evaluate("(document.getElementById('nav-filter').focus(), true)");
    await typeText("pell");
    await waitFor(app, "[...document.querySelectorAll('#navigator .nav-list li')].every(li => /PELL/.test(li.textContent)) && document.activeElement?.id === 'nav-filter'", "filtered to PELL's scenes, focus kept");
    const kept = await app.evaluate("document.querySelectorAll('#navigator .nav-list li').length");
    assert(kept > 0 && kept < scenes.length, `some scenes hidden: ${kept} of ${scenes.length}`);
    await app.evaluate("(() => { const f = document.getElementById('nav-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return true; })()");
    await waitFor(app, `document.querySelectorAll('#navigator .nav-list li').length === ${scenes.length}`, "filter cleared");
    // A label: shown by name, undone from the scene list.
    const pick = (i, v) => app.evaluate(`(() => { const s = document.querySelectorAll('#navigator .nav-list li .nav-label')[${i}]; s.value = '${v}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await pick(0, "blue");
    await waitFor(app, `document.querySelector('#navigator .nav-list li[data-scene-id="${scenes[0].id}"]')?.dataset.label === 'blue'`, "the scene is labelled");
    await app.evaluate("(document.querySelector('#navigator .nav-list .nav-go[tabindex=\"0\"]').focus(), true)");
    await press("z", [MOD_KEY]);
    await waitFor(app, `!document.querySelector('#navigator .nav-list li[data-scene-id="${scenes[0].id}"]').dataset.label`, "Ctrl/Cmd+Z in the scene list undoes the label");
    await press("z", [MOD_KEY, "shift"]);
    await waitFor(app, `document.querySelector('#navigator .nav-list li[data-scene-id="${scenes[0].id}"]').dataset.label === 'blue'`, "and redoes it");
    // Label names: renamed for this project; the colour stays.
    await app.evaluate("(document.getElementById('nav-label-names').click(), true)");
    await waitFor(app, "document.getElementById('labels-dialog').open", "Labels… opens");
    await app.evaluate("(() => { const i = document.getElementById('label-name-blue'); i.value = 'Act One'; document.getElementById('labels-save').click(); return true; })()");
    await waitFor(app, "[...document.querySelector('#navigator .nav-list li .nav-label').options].some(o => o.value === 'blue' && o.textContent === 'Act One')", "the label is called Act One");
    // Characters tab: counts, and Enter goes to the first appearance.
    await app.evaluate("(document.getElementById('nav-tab-characters').click(), true)");
    await waitFor(app, "document.querySelectorAll('#navigator .char-list li').length >= 2", "characters listed");
    const ines = await app.evaluate("[...document.querySelectorAll('#navigator .char-list li')].find(li => li.querySelector('strong').textContent === 'INES')?.querySelector('.char-meta').textContent");
    assert(/\d+ speech/.test(ines ?? "") && /\d+ words/.test(ines ?? ""), `INES counted: ${ines}`);
    await app.evaluate("([...document.querySelectorAll('#navigator .char-go')].find(b => b.textContent === 'PELL').click(), true)");
    const pellFirst = scenes[rows.findIndex((r) => /PELL/.test(r.chars))].id;
    await waitFor(app, `(() => { const at = __cirth.view.state.selection.from; const s = __cirth.scenes().find(x => at >= x.from && at < x.to); return s?.sceneId === ${JSON.stringify(pellFirst)}; })()`, "PELL goes to his first appearance");
    await app.evaluate("(document.getElementById('nav-tab-scenes').click(), true)");
    // Whole project: another episode's scenes; choosing one opens it there.
    const pilot = await app.evaluate("(async () => (await window.__TAURI_INTERNALS__.invoke('project_tree'))[0].id)()");
    const ep = await app.evaluate("window.__TAURI_INTERNALS__.invoke('create_episode', { title: 'Episode 2', folder: null })");
    await app.evaluate(`__cirth.openDocument(${JSON.stringify(ep)})`);
    await caretAtEndOf(0);
    await typeText("INT. BOAT - NIGHT");
    await sleep(700);
    await app.evaluate(`__cirth.openDocument(${JSON.stringify(pilot)})`);
    await waitFor(app, `__cirth.scenes().length === ${scenes.length}`, "back in the pilot");
    await app.evaluate("(() => { const s = document.getElementById('nav-scope'); s.value = 'project'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "[...document.querySelectorAll('#navigator .nav-doc')].some(h => h.textContent === 'Episode 2') && [...document.querySelectorAll('#navigator .nav-list.other .nav-go')].some(b => b.textContent === 'INT. BOAT - NIGHT')", "the other episode's scenes are listed");
    await app.evaluate("([...document.querySelectorAll('#navigator .nav-list.other .nav-go')].find(b => b.textContent === 'INT. BOAT - NIGHT').click(), true)");
    await waitFor(app, "__cirth.scenes().length === 1 && __cirth.scenes()[0].heading === 'INT. BOAT - NIGHT'", "choosing it opens Episode 2 at that scene");
    await app.evaluate("(() => { const s = document.getElementById('nav-scope'); s.value = 'doc'; s.dispatchEvent(new Event('change')); return true; })()");
  });

  await test("Outline tab: acts, sequences and beats in one tree with the board; add, nest, edit, move, delete, undo; with permission a beat move reorders the script once", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const items = () => app.evaluate("JSON.parse(JSON.stringify(__cirth.board.beats))");
    const rowsText = () => app.evaluate("[...document.querySelectorAll('#navigator .outline-list li')].map(li => li.querySelector('.outline-go')?.textContent + '@' + li.style.paddingLeft)");
    const focusRow = (id) => app.evaluate(`(() => { const b = document.querySelector('#navigator .outline-list li[data-item="${id}"] .outline-go'); b.click(); b.focus(); return true; })()`);
    await app.evaluate("(document.getElementById('nav-tab-outline').click(), true)");
    await waitFor(app, "document.querySelectorAll('#navigator .outline-list li').length === 4", "the outline lists the four beats");
    const beats0 = await items();
    // An act, moved to the top, titled.
    await app.evaluate("(document.getElementById('outline-add-act').click(), true)");
    await waitFor(app, "__cirth.board.beats.some(b => b.kind === 'act')", "act added");
    const act = (await items()).find((b) => b.kind === "act");
    await focusRow(act.id);
    for (let i = 0; i < 4; i++) await press("ArrowUp", ["alt"]);
    await waitFor(app, `document.querySelector('#navigator .outline-list li')?.dataset.item === ${JSON.stringify(act.id)}`, "the act is first");
    await app.evaluate("(() => { const t = document.getElementById('outline-title'); t.value = 'Act One'; t.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(act.id)}).title === 'Act One'`, "act titled");
    // The first beat goes inside the act (Alt+Right); the board still shows four cards, no act.
    await focusRow(beats0[0].id);
    await press("ArrowRight", ["alt"]);
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(beats0[0].id)}).parent === ${JSON.stringify(act.id)}`, "beat nested in the act");
    assert((await rowsText()).some((r) => r.endsWith("@14px")), `nested row indented: ${await rowsText()}`);
    assert((await app.evaluate("document.querySelectorAll('#board .card').length")) === 4, "the board shows beats only");
    // A beat's logline edited in the outline is the board card's logline: one item.
    await focusRow(beats0[1].id);
    await app.evaluate("(() => { const t = document.getElementById('outline-title'); t.value = 'Edited in the outline'; t.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `document.querySelector('#board .card[data-beat-id="${beats0[1].id}"] .logline')?.value === 'Edited in the outline'`, "the board card shows the outline's text");
    // Undo in the outline list.
    await focusRow(beats0[1].id);
    await press("z", [MOD_KEY]);
    await waitFor(app, `__cirth.board.beats.find(b => b.id === ${JSON.stringify(beats0[1].id)}).logline === ''`, "Ctrl/Cmd+Z in the outline undoes the edit");
    // An act that holds a beat cannot be deleted; an empty sequence can, and undo brings it back.
    await focusRow(act.id);
    await press("Delete");
    await waitFor(app, "/Not deleted/.test(document.getElementById('banner').textContent)", "deleting an act that holds items is refused");
    await focusRow(act.id);
    await app.evaluate("(document.getElementById('outline-add-sequence').click(), true)");
    await waitFor(app, `__cirth.board.beats.some(b => b.kind === 'sequence' && b.parent === ${JSON.stringify(act.id)})`, "a sequence inside the act");
    const seq = (await items()).find((b) => b.kind === "sequence");
    await focusRow(seq.id);
    await press("Delete");
    await waitFor(app, "!__cirth.board.beats.some(b => b.kind === 'sequence')", "empty sequence deleted");
    await focusRow(act.id);
    await press("z", [MOD_KEY]);
    await waitFor(app, "__cirth.board.beats.some(b => b.kind === 'sequence')", "undo brings it back");
    // With "Board may reorder script" on, a beat moved below the next one moves its scene once.
    await app.evaluate("__cirth.setStructural(true)");
    const order0 = await app.evaluate("__cirth.scenes().map(s => s.sceneId).join()");
    const b2 = beats0.find((b) => b.scene_id === scenes[1]);
    await focusRow(b2.id);
    await press("ArrowDown", ["alt"]);
    await waitFor(app, `__cirth.scenes().map(s => s.sceneId).join() === ${JSON.stringify([scenes[0], scenes[2], scenes[1], scenes[3]].join())}`, "the script follows the outline");
    assert(await storedMatchesEditor(), "stored order equals the editor");
    await app.evaluate("__cirth.view.focus()");
    await press("z", [MOD_KEY]);
    await waitFor(app, `__cirth.scenes().map(s => s.sceneId).join() === ${JSON.stringify(order0)}`, "one undo in the script restores its order");
    await app.evaluate("__cirth.setStructural(false)");
    await app.evaluate("(document.getElementById('nav-tab-scenes').click(), true)");
  });

  await test("Beat and pacing board: a pacing strip and page/minute estimates; three acts from a starting structure; cards move into acts by menu; act lengths; the script is untouched", async () => {
    await openFixture("page-boundaries");
    const script0 = JSON.stringify(await blocks());
    const cards = await app.evaluate("__cirth.board.beats.filter(b => b.kind === 'beat').length");
    await waitFor(app, `document.querySelectorAll('#board .pacing-beat').length === ${cards}`, "one pacing mark per linked card");
    assert(/estimate/.test(await app.evaluate("document.querySelector('#board .pacing-track').getAttribute('aria-label')")), "the pacing strip says it is an estimate");
    assert(/^p\. 1 · ≈ 0 min$/.test(await app.evaluate("document.querySelector('#board .card .card-pace span:last-child').textContent")), "the first card shows its page and minutes");
    // Three acts from the starting structures: generic names, empty acts ready for cards.
    await app.evaluate("(() => { const s = document.getElementById('board-structure'); s.value = '3'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "[...document.querySelectorAll('#board .board-act-title')].map(h => h.firstChild.textContent).join() === 'Not in an act,Act One,Act Two,Act Three'", "three acts on the board");
    assert((await app.evaluate("__cirth.board.beats.filter(b => b.kind === 'act').map(a => a.title).join()")) === "Act One,Act Two,Act Three", "the acts are outline items");
    // Two cards into Act Two by each card's Act menu.
    const act2 = await app.evaluate("__cirth.board.beats.find(b => b.title === 'Act Two').id");
    for (let i = 0; i < 2; i++) {
      await app.evaluate(`(() => { const s = document.querySelector('#board .no-act .card .card-act'); s.value = ${JSON.stringify(act2)}; s.dispatchEvent(new Event('change')); return true; })()`);
      await waitFor(app, `document.querySelectorAll('#board .board-act[data-act="${act2}"] .card').length === ${i + 1}`, `card ${i + 1} in Act Two`);
    }
    const meta = await app.evaluate(`document.querySelector('#board .board-act[data-act="${act2}"] .board-act-meta').textContent`);
    assert(/2 beats · ≈ \d+(\.\d)? pages \(estimate\)/.test(meta), `Act Two's length: ${meta}`);
    assert((await app.evaluate("document.querySelectorAll('#board .pacing-act').length")) === 1, "Act Two shows on the pacing strip");
    await screenshot(app, "pacing-board");
    // The script never moved.
    assert(JSON.stringify(await blocks()) === script0, "the script is unchanged");
  });

  await test("Overview map: scenes as blocks sized by length, coloured by label or act, a list view as text, arrow keys and Enter go to a scene; the project's episodes too", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    await waitFor(app, `document.querySelectorAll('#navigator .nav-list li .nav-page').length === ${scenes.length}`, "stats ready");
    // A label on the first scene, an act holding the second scene's card.
    await app.evaluate("(() => { const s = document.querySelectorAll('#navigator .nav-list li .nav-label')[0]; s.value = 'green'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `document.querySelector('#navigator .nav-list li[data-scene-id="${scenes[0]}"]')?.dataset.label === 'green'`, "labelled");
    await app.evaluate("__cirth.menu('overview')");
    await waitFor(app, `document.getElementById('overview-dialog').open && document.querySelectorAll('#overview-dialog .overview-block').length === ${scenes.length}`, "one block per scene");
    const blocks = await app.evaluate("[...document.querySelectorAll('#overview-dialog .overview-block')].map(b => ({ w: b.getBoundingClientRect().width, tint: b.style.getPropertyValue('--tint'), title: b.title, current: b.classList.contains('current') }))");
    const stats = await app.evaluate("__cirth.pagination.scene_stats.map(s => s.eighths)");
    assert(Math.abs(blocks[0].w / blocks[3].w - Math.max(1, stats[0]) / Math.max(1, stats[3])) < 0.25, `widths follow lengths: ${blocks.map((b) => Math.round(b.w))} for eighths ${stats}`);
    assert(blocks[0].tint.includes("label-green") && !blocks[1].tint, `coloured by label: ${blocks.map((b) => b.tint)}`);
    assert(/estimate/.test(blocks[0].title) && blocks[0].current, "titles say lengths are estimates; the caret's scene is marked");
    await screenshot(app, "overview-map");
    // The list view is the same data as text.
    await app.evaluate("(document.getElementById('overview-list-toggle').click(), true)");
    const rows = await app.evaluate("[...document.querySelectorAll('#overview-dialog .overview-table tbody tr')].map(tr => [...tr.cells].map(c => c.textContent))");
    assert(rows.length === scenes.length && rows[0][2] === "1" && rows[0][4] === "Green", `list rows: ${JSON.stringify(rows[0])}`);
    await app.evaluate("(document.getElementById('overview-list-toggle').click(), true)");
    // Arrow keys and Enter: to the third scene.
    await app.evaluate("(document.querySelector('#overview-dialog .overview-block[tabindex=\"0\"]').focus(), true)");
    await press("ArrowRight");
    await press("ArrowRight");
    await press("Enter");
    await waitFor(app, `!document.getElementById('overview-dialog').open && (() => { const at = __cirth.view.state.selection.from; const s = __cirth.scenes().find(x => at >= x.from && at < x.to); return s?.sceneId === ${JSON.stringify(scenes[2])}; })()`, "Enter goes to that scene");
    // Project scope: another episode's scenes as their own row.
    const ep = await app.evaluate("window.__TAURI_INTERNALS__.invoke('create_episode', { title: 'Episode 2', folder: null })");
    await app.evaluate("__cirth.menu('overview')");
    await waitFor(app, "document.getElementById('overview-dialog').open", "open again");
    await app.evaluate("(() => { const s = document.getElementById('overview-scope'); s.value = 'project'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `document.querySelectorAll('#overview-dialog .overview-row').length === 2 && document.querySelectorAll('#overview-dialog .overview-block[data-doc="${ep}"]').length === 1`, "two scripts, the episode's one scene");
    await app.evaluate("(document.getElementById('overview-close').click(), true)");
  });

  await test("Bible: candidates from cues and headings with evidence; accept, describe, undo, merge as alias, reject; previewed rename changes cues only; unreferenced entries stay; kept with the project", async () => {
    await openFixture("page-boundaries");
    const actionCaps = await app.evaluate("__cirth.view.state.doc.textContent.match(/\\b[A-Z]{4,}\\b/g) ?? []");
    await app.evaluate("__cirth.menu('bible')");
    await waitFor(app, "document.getElementById('bible-dialog').open && document.querySelectorAll('#bible-candidates .bible-cand').length > 0", "the bible opens with candidates");
    const cands = await app.evaluate("[...document.querySelectorAll('#bible-candidates .bible-cand')].map(li => li.dataset.name)");
    assert(["INES", "PELL"].every((n) => cands.includes(n)), `cue names are candidates: ${cands}`);
    assert(cands.every((n) => !/^FILLER|^SENTENCE/.test(n)), `nothing from action or dialogue text: ${cands} (caps in the script: ${actionCaps.slice(0, 5)})`);
    const cand = (n) => `#bible-candidates .bible-cand[data-name="${n}"]`;
    const click = (sel) => app.evaluate(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
    // Evidence: choosing a candidate lists where it appears.
    await click(`${cand("INES")} .bible-cand-name`);
    await waitFor(app, "document.querySelectorAll('#bible-detail .bible-evidence li').length >= 1", "evidence listed");
    // Accept INES, describe her, then undo the description.
    await click(`${cand("INES")} .bible-accept`);
    await waitFor(app, "document.getElementById('bible-name')?.value === 'INES' && /Appears \\d+ time/.test(document.getElementById('bible-detail').textContent)", "INES is an entry with her occurrences");
    await app.evaluate("(() => { const d = document.getElementById('bible-description'); d.value = 'Harbour clerk.'; d.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "document.getElementById('bible-description')?.value === 'Harbour clerk.'", "description saved");
    await click("#bible-undo");
    await waitFor(app, "document.getElementById('bible-description')?.value === ''", "Undo takes the description back");
    // Merge TOBIAS into INES as another name: the Characters tab counts them as one.
    await app.evaluate(`(() => { const s = document.querySelector('${cand("TOBIAS")} .bible-merge'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(app, "document.getElementById('bible-aliases')?.value === 'TOBIAS'", "TOBIAS is another name of INES");
    // Reject PELL; accept a location.
    await click(`${cand("PELL")} .bible-reject`);
    await waitFor(app, `!document.querySelector('${cand("PELL")}')`, "PELL is no longer suggested");
    await app.evaluate("(() => { const k = document.getElementById('bible-kind'); k.value = 'location'; k.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `!!document.querySelector('${cand("COUNTING HOUSE")}')`, "locations from headings");
    await click(`${cand("COUNTING HOUSE")} .bible-accept`);
    await waitFor(app, "document.getElementById('bible-name')?.value === 'COUNTING HOUSE'", "location entry");
    await app.evaluate("(() => { const k = document.getElementById('bible-kind'); k.value = 'character'; k.dispatchEvent(new Event('change')); document.querySelector('#bible-entries .bible-entry')?.click(); return true; })()");
    await sleep(300);
    await screenshot(app, "bible");
    // A new character no script mentions: marked, kept.
    await app.evaluate("(() => { const k = document.getElementById('bible-kind'); k.value = 'character'; k.dispatchEvent(new Event('change')); return true; })()");
    await click("#bible-new");
    await waitFor(app, "!!document.getElementById('bible-unreferenced')", "an entry with no mentions is marked unreferenced");
    await click("#bible-delete");
    await waitFor(app, "![...document.querySelectorAll('#bible-entries .bible-entry')].some(b => b.textContent.startsWith('NEW NAME')) && /deleted/.test(document.getElementById('bible-status').textContent)", "the new entry deleted");
    // Rename INES to Inez: preview, then the cues change and nothing else does.
    await app.evaluate("([...document.querySelectorAll('#bible-entries .bible-entry')].find(b => b.textContent.startsWith('INES')).click(), true)");
    await waitFor(app, "document.getElementById('bible-name')?.value === 'INES' && !!document.getElementById('bible-rename')", "INES chosen, rename panel");
    const before = await blocks();
    const inesCues = before.filter((b) => b.kind === "character" && /^INES/.test(text(b))).length;
    await app.evaluate("(() => { document.getElementById('bible-rename').open = true; document.getElementById('bible-rename-to').value = 'Inez'; document.getElementById('bible-rename-preview').click(); return true; })()");
    await waitFor(app, "!!document.getElementById('bible-rename-apply')", "preview shown");
    assert((await app.evaluate("document.querySelectorAll('#bible-rename-out .bible-changes li').length")) === inesCues, "the preview lists every INES cue");
    await click("#bible-rename-apply");
    await waitFor(app, "document.getElementById('bible-name')?.value === 'INEZ' && document.getElementById('bible-aliases').value.split(', ').includes('INES')", "the entry is INEZ, INES kept as another name");
    const after = await blocks();
    assert(after.filter((b) => b.kind === "character" && /^INEZ/.test(text(b))).length === inesCues && !after.some((b) => b.kind === "character" && /^INES/.test(text(b))), "every INES cue is now INEZ");
    assert(after.filter((b) => b.kind !== "character").map(text).join("|") === before.filter((b) => b.kind !== "character").map(text).join("|"), "no other text changed");
    await click("#bible-close");
    // The Characters tab counts TOBIAS under INEZ.
    await app.evaluate("(document.getElementById('nav-tab-characters').click(), true)");
    await waitFor(app, "(() => { const n = [...document.querySelectorAll('#navigator .char-list strong')].map(s => s.textContent); return n.includes('INEZ') && !n.includes('TOBIAS'); })()", "aliases count under the entry's name");
    await app.evaluate("(document.getElementById('nav-tab-scenes').click(), true)");
    // Kept with the project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    const st = await app.evaluate("window.__TAURI_INTERNALS__.invoke('bible_state')");
    assert(st.entries.some((e) => e.name === "INEZ" && e.aliases.includes("TOBIAS")) && st.entries.some((e) => e.name === "COUNTING HOUSE") && !st.candidates.some((c) => c.name === "PELL"), `kept: ${JSON.stringify(st.entries.map((e) => e.name))}`);
  });

  await test("Timeline (B5): events in story order linked to scenes; a flashback is marked; moving an event never moves a scene; story order applied to the script only with permission, as one undoable edit", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const order = () => app.evaluate("__cirth.scenes().map(s => s.sceneId).join()");
    const script0 = JSON.stringify(await blocks());
    // An event for the scene with the caret, through the dialog.
    await caretAtEndOf(0);
    await app.evaluate("__cirth.menu('timeline')");
    await waitFor(app, "document.getElementById('timeline-dialog').open", "the timeline opens");
    await app.evaluate("(document.getElementById('timeline-new-here').click(), true)");
    await waitFor(app, "document.querySelectorAll('#timeline-list .timeline-event').length === 1 && document.querySelectorAll('#timeline-linked li').length === 1", "an event linked to the current scene");
    await app.evaluate("(() => { const w = document.getElementById('timeline-when'); w.value = 'Day 2, night'; w.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "/Day 2, night/.test(document.querySelector('#timeline-list .timeline-event').textContent)", "time saved");
    await app.evaluate("(document.getElementById('timeline-close').click(), true)");
    // Two more events: what scene 3 shows happens first (a flashback), then scene 2.
    const put = async (e) => {
      const base = (await app.evaluate("window.__TAURI_INTERNALS__.invoke('planning_state_now')")).version;
      await app.evaluate(`window.__TAURI_INTERNALS__.invoke('planning_command', { op: { PutEvent: ${JSON.stringify(e)} }, base: ${base} })`);
    };
    await put({ id: "ev-childhood", title: "Childhood", summary: "", when: "Years before", uncertain: true, simultaneous: false, pos: -10, scenes: [scenes[2]] });
    await put({ id: "ev-weigh", title: "The weighing", summary: "", when: "Day 3", uncertain: false, simultaneous: false, pos: 10, scenes: [scenes[1]] });
    await app.evaluate("__cirth.reloadPlanning()");
    await app.evaluate("__cirth.menu('timeline')");
    await waitFor(app, "document.querySelectorAll('#timeline-list .timeline-event').length === 3", "three events");
    const rows = await app.evaluate("[...document.querySelectorAll('#timeline-list .timeline-event')].map(b => b.textContent)");
    assert(/Childhood/.test(rows[0]) && /flashback/.test(rows[0]) && /\(\?\)/.test(rows[0]), `story order first; the flashback and the uncertain time marked: ${rows}`);
    await screenshot(app, "timeline");
    // B5: moving an event in the timeline never moves a scene.
    await app.evaluate("(document.querySelector('#timeline-list .timeline-event[data-id=\"ev-weigh\"]').click(), document.querySelector('#timeline-list .timeline-event[data-id=\"ev-weigh\"]').focus(), true)");
    await press("ArrowUp", ["alt"]);
    await waitFor(app, "[...document.querySelectorAll('#timeline-list .timeline-event')].map(b => b.dataset.id).indexOf('ev-weigh') === 1", "the event moved earlier in the story");
    assert(JSON.stringify(await blocks()) === script0, "B5: the script did not move");
    await app.evaluate("(document.getElementById('timeline-undo').click(), true)");
    await waitFor(app, "[...document.querySelectorAll('#timeline-list .timeline-event')].map(b => b.dataset.id).indexOf('ev-weigh') === 2", "Undo puts it back");
    // Story order needs the permission; then it is one script edit.
    assert(await app.evaluate("document.getElementById('timeline-apply-go').disabled"), "without the permission the script cannot be reordered from here");
    await app.evaluate("(document.getElementById('timeline-close').click(), true)");
    await app.evaluate("__cirth.setStructural(true)");
    await app.evaluate("__cirth.menu('timeline')");
    await waitFor(app, "document.getElementById('timeline-dialog').open && !document.getElementById('timeline-apply-go').disabled", "with permission");
    const story = [scenes[2], scenes[3], scenes[0], scenes[1]].join();
    await app.evaluate("(document.getElementById('timeline-apply-go').click(), true)");
    await waitFor(app, `__cirth.scenes().map(s => s.sceneId).join() === ${JSON.stringify(story)}`, "the script follows the story (an unlinked scene stays after the scene it followed)");
    assert(await storedMatchesEditor(), "stored order equals the editor");
    await app.evaluate("__cirth.view.focus()");
    await press("z", [MOD_KEY]);
    await waitFor(app, `__cirth.scenes().map(s => s.sceneId).join() === ${JSON.stringify(scenes.join())}`, "one undo in the script restores the order");
    assert(JSON.stringify(await blocks()) === script0, "and the script is exactly as before");
    await app.evaluate("__cirth.setStructural(false)");
  });

  await test("Evidence board (C4): notes, scene cards, pictures in the project file, video links never fetched, labelled strings; moving never touches the script; delete and undo; bookmarks", async () => {
    await openFixture("page-boundaries");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const script0 = JSON.stringify(await blocks());
    const cards = () => app.evaluate("[...document.querySelectorAll('#evidence-canvas .evidence-card')].map(c => ({ id: c.dataset.id, kind: c.className, x: c.offsetLeft, text: c.textContent }))");
    await app.evaluate("__cirth.menu('evidence')");
    await waitFor(app, "document.getElementById('evidence-dialog').open", "the board opens");
    // A note, and a card for the second scene.
    await app.evaluate("(document.getElementById('evidence-add-note').click(), true)");
    await waitFor(app, "document.querySelectorAll('#evidence-canvas .evidence-card').length === 1 && !!document.getElementById('evidence-card-body')", "note added and chosen");
    await app.evaluate("(() => { const b = document.getElementById('evidence-card-body'); b.value = 'Who took the ledger?'; b.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "/Who took the ledger/.test(document.getElementById('evidence-canvas').textContent)", "note text shown");
    await app.evaluate(`(() => { const s = document.getElementById('evidence-add-scene'); s.value = ${JSON.stringify(scenes[1])}; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(app, "document.querySelectorAll('#evidence-canvas .evidence-card.scene').length === 1", "scene card added");
    const sceneCard = (await cards()).find((c) => c.kind.includes("scene"));
    const note = (await cards()).find((c) => c.kind.includes("note"));
    assert(/WEIGH STATION/.test(sceneCard.text), `the scene card shows the scene's current heading: ${sceneCard.text}`);
    // A labelled string from the note to the scene.
    await app.evaluate(`(document.querySelector('#evidence-canvas .evidence-card[data-id="${note.id}"]').focus(), true)`);
    await app.evaluate(`(() => { document.getElementById('evidence-string-to').value = ${JSON.stringify(sceneCard.id)}; document.getElementById('evidence-string-label').value = 'answered in'; document.getElementById('evidence-string-add').click(); return true; })()`);
    await waitFor(app, "document.querySelectorAll('#evidence-canvas .evidence-string').length === 1 && document.querySelector('#evidence-canvas .evidence-string-label')?.textContent === 'answered in'", "a labelled string");
    // Moving a card by keyboard: the board changes, the script does not.
    await app.evaluate(`(document.querySelector('#evidence-canvas .evidence-card[data-id="${note.id}"]').focus(), true)`);
    await press("ArrowRight", ["alt"]);
    await waitFor(app, `document.querySelector('#evidence-canvas .evidence-card[data-id="${note.id}"]').offsetLeft === ${note.x + 20}`, "Alt+Right moves the card");
    assert(JSON.stringify(await blocks()) === script0, "moving a card never touches the script");
    // A picture, packaged: shown from the project file as data.
    const png = join(dataDir, "harbour.png");
    writeFileSync(png, Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201" + "f8a3a1b00000000049454e44ae426082", "hex"));
    const pic = await app.evaluate(`window.__TAURI_INTERNALS__.invoke('add_picture', { path: ${JSON.stringify(png)} })`);
    await app.evaluate(`__cirth.evidence.addCard({ kind: 'image', ref_id: null, title: 'harbour.png', body: '', url: '', asset: ${JSON.stringify(pic.id)} })`);
    await waitFor(app, "document.querySelector('#evidence-canvas .evidence-card.image img')?.src.startsWith('data:image/png;base64,')", "the picture shows from the project file");
    // A video link: stored as text, never loaded.
    await app.evaluate("__cirth.evidence.addCard({ kind: 'video', ref_id: null, title: 'Tide footage', body: '', url: 'https://example.com/tides', asset: null })");
    await waitFor(app, "/example\\.com\\/tides/.test(document.querySelector('#evidence-canvas .evidence-card.video')?.textContent ?? '')", "the link is shown as text");
    assert(await app.evaluate("!document.querySelector('#evidence-dialog iframe, #evidence-dialog video, #evidence-dialog img[src^=\"http\"]')"), "nothing is embedded or fetched");
    // Deleting the scene card cuts its string; Undo brings both back.
    await app.evaluate(`(document.querySelector('#evidence-canvas .evidence-card[data-id="${sceneCard.id}"]').focus(), true)`);
    await press("Delete");
    await waitFor(app, "document.querySelectorAll('#evidence-canvas .evidence-card.scene').length === 0 && document.querySelectorAll('#evidence-canvas .evidence-string').length === 0", "card and its string removed");
    await app.evaluate("(document.getElementById('evidence-undo').click(), true)");
    await waitFor(app, "document.querySelectorAll('#evidence-canvas .evidence-card.scene').length === 1 && document.querySelectorAll('#evidence-canvas .evidence-string').length === 1", "Undo restores both");
    // The same board as text.
    await app.evaluate("(document.getElementById('evidence-list-toggle').click(), true)");
    assert(/answered in/.test(await app.evaluate("document.getElementById('evidence-list-strings').textContent")), "list view names the string");
    await app.evaluate("(document.getElementById('evidence-list-toggle').click(), true)");
    await screenshot(app, "evidence-board");
    await app.evaluate("(document.getElementById('evidence-close').click(), true)");
    // A bookmark at the third block, then back to it from the start.
    await caretAtEndOf(2);
    await app.evaluate("(__cirth.menu('bookmark_add'), true)");
    await waitFor(app, "document.getElementById('bookmarks-dialog').open", "bookmarks open");
    await app.evaluate("(() => { document.getElementById('bookmark-name').value = 'The speech'; document.getElementById('bookmark-name').form.requestSubmit(); return true; })()");
    await waitFor(app, "/The speech/.test(document.getElementById('bookmarks-list').textContent)", "bookmark added");
    await app.evaluate("(document.querySelector('#bookmarks-dialog .dialog-actions button').click(), true)");
    await caretAtEndOf(0);
    await app.evaluate("(__cirth.menu('bookmarks'), true)");
    await waitFor(app, "document.querySelector('#bookmarks-list .bible-go')", "listed");
    const third = (await blocks())[2].id;
    await app.evaluate("(document.querySelector('#bookmarks-list .bible-go').click(), true)");
    await waitFor(app, `__cirth.view.state.selection.$from.node(1)?.attrs.id === ${JSON.stringify(third)}`, "the bookmark goes to its block");
    // Kept with the project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    const st = await app.evaluate("window.__TAURI_INTERNALS__.invoke('evidence_state')");
    assert(st.cards.length === 4 && st.threads.length === 1 && st.bookmarks.length === 1, `kept: ${st.cards.length} cards, ${st.threads.length} strings, ${st.bookmarks.length} bookmarks`);
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
    assert(/changed outside Kolbítar. It will not be overwritten/.test(banner), `early warning '${banner}'`);
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
    assert(t.includes("Based on Kolbítar by Jared Hoy"), "attribution");
    assert(/GNU General Public License, version 3 only/.test(t) && /no warranty/i.test(t), "GPL notice and no warranty");
    assert(t.includes("ADDITIONAL TERMS UNDER SECTION 7(b)"), "NOTICE text with the 7(b) term");
    await clickHome(app, '[data-about-tab="gpl"]');
    assert((await pageText()).includes("GNU GENERAL PUBLIC LICENSE") && (await pageText()).includes("Version 3, 29 June 2007"), "full GPL text");
    assert((await pageHeight()) > 150, `GPL tab visible: ${await pageHeight()} px`);
    await clickHome(app, '[data-about-tab="third"]');
    const third = await pageText();
    assert((await pageHeight()) > 150, `third-party tab visible: ${await pageHeight()} px`);
    // The dialog keeps one height across tabs, so the tab row does not jump.
    const dialogHeights = [];
    for (const tab of ["about", "gpl", "third"]) {
      await clickHome(app, `[data-about-tab="${tab}"]`);
      dialogHeights.push(Math.round(await app.evaluate("document.getElementById('about-dialog').getBoundingClientRect().height")));
    }
    assert(new Set(dialogHeights).size === 1, `About dialog height per tab: ${dialogHeights}`);
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
    // The scene list is one Tab stop; the navigator's tabs, filter and scope are one stop each besides (M3 step 3).
    assert((await tabStops("#navigator .nav-list")) === 1, `scene list tab stops ${await tabStops("#navigator .nav-list")}`);
    assert((await tabStops("#navigator .nav-tabs")) === 1, `the tabs are one stop: ${await tabStops("#navigator .nav-tabs")}`);
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
    // Undo and redo work with focus still in the scene list (macOS pass found
    // Mod+Z did nothing there); it is the script's one undo history.
    assert(await app.evaluate("document.getElementById('navigator').contains(document.activeElement)"), "focus in the scene list");
    await press("z", [MOD_KEY]);
    await waitFor(app, `JSON.stringify(__cirth.scenes().map(s => s.sceneId)) === ${JSON.stringify(JSON.stringify(order0))}`, "undo from the scene list");
    await waitAnnounced("Undone", "undo announced");
    await press("z", [MOD_KEY, "shift"]);
    await waitFor(app, `__cirth.scenes()[2]?.sceneId === ${JSON.stringify(order0[1])}`, "redo from the scene list");
    await press("z", [MOD_KEY]);
    await waitFor(app, `JSON.stringify(__cirth.scenes().map(s => s.sceneId)) === ${JSON.stringify(JSON.stringify(order0))}`, "undo again");
    assert(JSON.stringify(await ids()) === JSON.stringify(order0), "one undo restores the order");
    // Board (planning only): arrows choose, Alt+Right moves the card, script untouched.
    await sleep(300);
    const cardOrder = () => app.evaluate("[...document.querySelectorAll('#board .card')].map(c => c.dataset.item)");
    const cards0 = await cardOrder();
    await app.evaluate("document.querySelector('#board .card[tabindex=\"0\"]').focus()");
    assert((await focusedScene()) === cards0[0], "first card focused");
    const boardStops = await tabStops("#board .cards");
    assert(boardStops === 5, `board tab stops: chosen card and its 4 enabled controls (link, logline, summary, move), got ${boardStops}`);
    await press("ArrowRight", ["alt"]);
    await waitFor(app, `JSON.stringify([...document.querySelectorAll('#board .card')].map(c => c.dataset.item)) !== ${JSON.stringify(JSON.stringify(cards0))}`, "card moved");
    assert((await cardOrder())[1] === cards0[0], "card now second");
    assert((await focusedScene()) === cards0[0], "focus stays on the moved card");
    await waitAnnounced("The script is unchanged", "card move announced");
    assert(JSON.stringify(await ids()) === JSON.stringify(order0), "script order untouched in planning mode");
    await press("ArrowRight");
    assert((await focusedScene()) === (await cardOrder())[2], "ArrowRight: next card");
    await press("Enter");
    assert(await app.evaluate("document.activeElement?.dataset.part === 'logline'"), "Enter: edit the logline");
    await press("Enter");
    assert(await app.evaluate("document.activeElement?.dataset.part === 'summary'"), "Enter in the logline: on to the summary");
    await press("Escape");
    assert(await app.evaluate("document.activeElement?.classList.contains('card')"), "Escape: back to the card");
    // Linked mode: a card move changes the script; Mod+Z with the card focused undoes it.
    await app.evaluate("__cirth.setStructural(true)");
    await sleep(300);
    await app.evaluate("document.querySelector('#board .card[tabindex=\"0\"]').focus()");
    const linked0 = await ids();
    await press("ArrowRight", ["alt"]);
    await waitFor(app, `JSON.stringify(__cirth.scenes().map(s => s.sceneId)) !== ${JSON.stringify(JSON.stringify(linked0))}`, "linked card move changes the script");
    assert(await app.evaluate("document.getElementById('board').contains(document.activeElement) && !document.activeElement.matches('textarea')"), "focus still on the board");
    await press("z", [MOD_KEY]);
    await waitFor(app, `JSON.stringify(__cirth.scenes().map(s => s.sceneId)) === ${JSON.stringify(JSON.stringify(linked0))}`, "undo from the board");
    await app.evaluate("__cirth.setStructural(false)");
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

  await test("Themes: Day, Night, Midnight, OLED and Match System from View > Appearance > Theme; every one meets contrast minimums, with high contrast too; stored per user", async () => {
    await openFixture("unicode-marks");
    const ratios = `(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => { let h = css.getPropertyValue(v).trim().replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };
      const lum = (v) => { const [r, g, b] = rgb(v); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const out = {};
      for (const fg of ['--ink', '--muted', '--accent', '--warn', '--bad']) for (const bg of ['--bg', '--panel']) out[fg + ' on ' + bg] = Math.round(cr(fg, bg) * 100) / 100;
      return { bg: css.getPropertyValue('--bg').trim(), scheme: css.colorScheme, out };
    })()`;
    const seen = {};
    for (const t of ["day", "night", "midnight", "oled", "system"]) {
      await app.evaluate(`__cirth.menu('theme_${t}')`);
      await waitFor(app, `__cirth.prefs().theme === '${t}' && (document.documentElement.dataset.theme ?? 'system') === '${t}'`, `theme ${t} applied`);
      await waitFor(app, `window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.filter(i => i.id.startsWith('theme_') && i.checked).map(i => i.id).join() === 'theme_${t}')`, `only ${t} checked`);
      const r = await app.evaluate(ratios);
      const low = Object.entries(r.out).filter(([, v]) => !(v >= 4.5));
      assert(!low.length, `${t}: below 4.5:1: ${JSON.stringify(low)}`);
      seen[t] = r.bg;
      if (t !== "system") assert(r.scheme === (t === "day" ? "light" : "dark"), `${t}: native controls follow the theme (${r.scheme})`);
    }
    const black = (c) => ["#000", "#000000"].includes(c);
    assert(black(seen.oled) && new Set([seen.day, seen.night, seen.midnight, seen.oled]).size === 4, `four distinct themes, OLED true black: ${JSON.stringify(seen)}`);
    // High contrast on top of a dark theme stays dark and reaches 7:1.
    await app.evaluate("__cirth.menu('theme_oled')");
    await app.evaluate("__cirth.menu('ui_contrast')");
    await waitFor(app, "document.documentElement.dataset.contrast === 'high'", "high contrast on");
    const hc = await app.evaluate(ratios);
    assert(black(hc.bg) && Object.values(hc.out).every((v) => v >= 7), `OLED + high contrast: ${JSON.stringify(hc)}`);
    await app.evaluate("__cirth.menu('ui_contrast')");
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(saved.theme === "oled", `stored per user: ${saved.theme}`);
    await app.evaluate("__cirth.menu('theme_system')");
    await waitFor(app, "!document.documentElement.dataset.theme && __cirth.prefs().theme === 'system'", "back to Match System");
  });

  await test("Shortcuts: Help > Keyboard Shortcuts rebinds a command; the menu shows the new keys; a taken key moves; fixed and plain keys are refused; stored; Reset all", async () => {
    await openFixture("unicode-marks");
    const prefsKeys = () => app.evaluate("__cirth.prefs().keys");
    const exportOpen = () => app.evaluate("document.getElementById('export-dialog').open");
    const closeExport = () => app.evaluate("(document.getElementById('export-cancel').click(), true)");
    const status = () => app.evaluate("document.getElementById('shortcuts-status').textContent");
    const change = (id) => app.evaluate(`(document.querySelector('#shortcuts-dialog tr[data-command="${id}"] .shortcut-change').click(), true)`);
    // The default keys work.
    await app.evaluate("__cirth.view.focus()");
    await press("e", [MOD_KEY]);
    await waitFor(app, "document.getElementById('export-dialog').open", "Ctrl/Cmd+E opens Export by default");
    await closeExport();
    // Rebind Export to Ctrl/Cmd+Shift+E.
    await app.evaluate("(__cirth.menu('shortcuts'), true)");
    await waitFor(app, "document.getElementById('shortcuts-dialog').open", "dialog open");
    await change("export");
    assert(/Press the new keys/.test(await status()), "waiting for keys");
    await press("e", [MOD_KEY, "shift"]);
    await waitFor(app, "__cirth.prefs().keys.export === 'Mod+Shift+E'", "Export rebound");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => /\\((Ctrl|Cmd)\\+Shift\\+E\\)$/.test(m.find(i => i.id === 'export').path))", "the File menu shows the new keys");
    // A taken key moves: Italic gets Ctrl/Cmd+B, Bold has none.
    await change("italic");
    await press("b", [MOD_KEY]);
    await waitFor(app, "__cirth.prefs().keys.italic === 'Mod+B' && __cirth.prefs().keys.bold === ''", "Ctrl/Cmd+B moved to Italic");
    assert(/Bold/.test(await status()), `the writer is told Bold lost it: ${await status()}`);
    // Fixed keys and plain letters are refused; Escape leaves it unchanged.
    await change("underline");
    await press("z", [MOD_KEY]);
    assert(/fixed/.test(await status()), `Ctrl/Cmd+Z refused: ${await status()}`);
    await press("k");
    assert(/would type/.test(await status()), `a plain letter refused: ${await status()}`);
    await press("Escape");
    assert((await app.evaluate("document.getElementById('shortcuts-dialog').open")) && !("underline" in (await prefsKeys())), "Escape cancels without closing the dialog or changing anything");
    await app.evaluate("(document.getElementById('shortcuts-close').click(), true)");
    // In force at once: the old keys do nothing, the new ones work.
    await app.evaluate("__cirth.view.focus()");
    await press("e", [MOD_KEY]);
    await sleep(300);
    assert(!(await exportOpen()), "Ctrl/Cmd+E no longer opens Export");
    await press("e", [MOD_KEY, "shift"]);
    await waitFor(app, "document.getElementById('export-dialog').open", "Ctrl/Cmd+Shift+E opens Export");
    await closeExport();
    const b0 = await blocks();
    const ai = b0.findIndex((b) => b.kind === "action");
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 5]`);
    await press("b", [MOD_KEY]);
    await waitFor(app, `__cirth.view.state.doc.child(${ai}).firstChild?.marks.some(m => m.type.name === 'em')`, "Ctrl/Cmd+B now makes italic in the script");
    assert(!(await app.evaluate(`__cirth.view.state.doc.child(${ai}).firstChild?.marks.some(m => m.type.name === 'strong')`)), "and not bold");
    await press("z", [MOD_KEY]);
    // Stored per user.
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(saved.keys.export === "Mod+Shift+E" && saved.keys.italic === "Mod+B" && saved.keys.bold === "", `stored: ${JSON.stringify(saved.keys)}`);
    // Reset all: the defaults again, menus too.
    await app.evaluate("(__cirth.menu('shortcuts'), true)");
    await app.evaluate("(document.getElementById('shortcuts-reset-all').click(), true)");
    await waitFor(app, "Object.keys(__cirth.prefs().keys).length === 0", "every override removed");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => /\\((Ctrl|Cmd)\\+E\\)$/.test(m.find(i => i.id === 'export').path))", "menu back to the default keys");
    await app.evaluate("(document.getElementById('shortcuts-close').click(), true)");
    await app.evaluate("__cirth.view.focus()");
    await press("e", [MOD_KEY]);
    await waitFor(app, "document.getElementById('export-dialog').open", "Ctrl/Cmd+E opens Export again");
    await closeExport();
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
    assert(/another Kolbítar window or process/.test(banner), `banner '${banner}'`);
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
    assert(await app.evaluate(`__cirth.exportPdf(${JSON.stringify(join(dataDir, "offline.pdf"))})`), "PDF export");
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

  await test("Navigator click goes to the scene: no scene numbers, heading scrolled into view, caret at its end, Enter continues the scene", async () => {
    await openFixture("long-120");
    await app.evaluate("(() => { document.querySelector('.editor-wrap').scrollTop = 0; return true; })()");
    const scenes = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    const target = scenes[Math.floor(scenes.length * 0.6)];
    // No scene numbers anywhere until scene numbers are locked (not built yet).
    const shown = await app.evaluate(`(() => ({
      nav: [...document.querySelectorAll('#navigator .nav-go')].map(b => b.textContent),
      headings: __cirth.scenes().map(s => s.heading || '(empty heading)'),
      labels: [...document.querySelectorAll('#navigator [aria-label], #board [aria-label]')].map(e => e.getAttribute('aria-label')),
      links: [...document.querySelectorAll('#board .card-link')].map(e => e.textContent) }))()`);
    assert(JSON.stringify(shown.nav) === JSON.stringify(shown.headings), `scene list shows headings only: ${shown.nav.slice(0, 3)}`);
    const numbered = [...shown.labels, ...shown.links].filter((t) => /\bscene \d/i.test(t));
    assert(!numbered.length, `scene numbers shown: ${numbered.slice(0, 3)}`);
    await clickHome(app, `#navigator [data-item="${target}"] [data-part="go"]`);
    await sleep(300);
    const where = await app.evaluate(`(() => {
      const v = __cirth.view; const h = document.querySelector('.ProseMirror [data-scene-id="${target}"]').getBoundingClientRect();
      const wrap = document.querySelector('.editor-wrap').getBoundingClientRect();
      const $p = v.state.selection.$from;
      return { top: h.top - wrap.top, bottom: wrap.bottom - h.bottom, inHeading: $p.parent.attrs.sceneId === ${JSON.stringify(target)}, atEnd: $p.parentOffset === $p.parent.content.size, focused: v.hasFocus() };
    })()`);
    // 2 px slack: aligning to the top lands on sub-pixel positions (-0.47 px on WebKitGTK).
    assert(where.top >= -2 && where.bottom >= -2, `heading visible in the script: ${JSON.stringify(where)}`);
    assert(where.inHeading && where.atEnd && where.focused, `caret at the end of the heading: ${JSON.stringify(where)}`);
    const before = await blocks();
    const i = before.findIndex((b) => b.scene_id === target);
    await press("Enter");
    const after = await blocks();
    assert(after.length === before.length + 1, "one block added");
    assert(after[i].id === before[i].id && text(after[i]) === text(before[i]), "heading unchanged and still in place");
    assert(after[i + 1].kind !== "heading" && text(after[i + 1]) === "", `Enter adds an empty ${after[i + 1].kind} after the heading, not a heading above it`);
  });

  await test("View: panels hide from the View menu and the toolbar dropdown, survive a restart; focus mode shows only the script", async () => {
    await openFixture("page-boundaries");
    const shown = (sel) => app.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
    const editorWidth = () => app.evaluate("Math.round(document.querySelector('.editor-wrap').getBoundingClientRect().width)");
    const w0 = await editorWidth();
    assert((await shown("#navigator")) && (await shown("#board")) && (await shown(".toolbar")) && (await shown("footer")), "all panels shown at first");
    // Native View menu (same handler as the menu items).
    await app.evaluate("__cirth.menu('view_nav')");
    await waitFor(app, "!document.getElementById('navigator').getClientRects().length", "scene list hidden");
    await waitAnnounced("Scene list hidden", "hiding announced");
    assert((await editorWidth()) > w0 + 100, `script takes the space: ${w0} -> ${await editorWidth()}`); // panels may be at their narrower widths (layout-mode.ts)
    // Toolbar dropdown: keyboard only.
    await app.evaluate("document.getElementById('view-menu-btn').focus()");
    await press("Enter");
    await waitFor(app, "!document.getElementById('view-menu').hidden", "View dropdown open");
    assert(await app.evaluate("document.activeElement?.dataset.panel === 'focus' && document.getElementById('view-menu-btn').getAttribute('aria-expanded') === 'true'"), "first item focused");
    await press("ArrowDown"); // Typewriter mode
    await press("ArrowDown");
    assert(await app.evaluate("document.activeElement?.dataset.panel === 'nav' && document.activeElement.getAttribute('aria-checked') === 'false'"), "Scene list item shows it is hidden");
    await press("Enter");
    await waitFor(app, "document.getElementById('navigator').getClientRects().length > 0", "scene list shown from the dropdown");
    await waitFor(app, "document.querySelector('#view-menu [data-panel=nav]')?.getAttribute('aria-checked') === 'true' && document.activeElement?.dataset.panel === 'nav'", "check mark updated, menu still open");
    await screenshot(app, "view-dropdown");
    await press("ArrowDown");
    await press(" ");
    await waitFor(app, "!document.getElementById('board').getClientRects().length", "board hidden with Space");
    await press("Escape");
    assert(await app.evaluate("document.getElementById('view-menu').hidden && document.activeElement?.id === 'view-menu-btn'"), "Escape closes and returns to the button");
    await app.evaluate("__cirth.menu('view_status')");
    await app.evaluate("__cirth.menu('view_toolbar')");
    await waitFor(app, "!document.querySelector('.toolbar').getClientRects().length && !document.querySelector('footer').getClientRects().length", "toolbar and status bar hidden");
    const top = await app.evaluate("Math.round(document.querySelector('.editor-wrap').getBoundingClientRect().top)");
    assert(top <= 2, `script moves up into the toolbar's space (top ${top})`);
    // Stored app-wide: a hard kill keeps them.
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-panels-kill");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, "!document.getElementById('board').getClientRects().length && !document.querySelector('.toolbar').getClientRects().length && document.getElementById('navigator').getClientRects().length > 0", "panel choices restored");
    for (const p of ["board", "toolbar", "status"]) await app.evaluate(`__cirth.menu('view_${p}')`);
    await waitFor(app, "['#board', '.toolbar', 'footer', '#navigator'].every(s => document.querySelector(s).getClientRects().length > 0)", "all panels back");
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(JSON.stringify(saved.panels) === JSON.stringify({ nav: true, board: true, toolbar: true, status: true, notes: false }), `stored ${JSON.stringify(saved.panels)}`);

    // Focus mode: Ctrl/Cmd+Shift+F, only the script, full screen; Escape leaves.
    await caretAtEndOf(1);
    await press("f", [MOD_KEY, "shift"]);
    await waitFor(app, "document.body.dataset.focus === 'on'", "focus mode on");
    await waitFor(app, "['#board', '.toolbar', 'footer', '#navigator'].every(s => !document.querySelector(s).getClientRects().length)", "only the script shown");
    await waitAnnounced("Focus mode", "focus mode announced");
    assert(await app.evaluate("__cirth.view.hasFocus()"), "caret stays in the script");
    if (process.platform === "win32") await waitFor(app, "window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2", "window fills the screen");
    await press("F6");
    assert(await app.evaluate("__cirth.view.hasFocus()"), "F6 has nowhere else to go");
    await typeText(" FOCUSED");
    await screenshot(app, "focus-mode");
    await press("Escape");
    await waitFor(app, "!document.body.dataset.focus && document.querySelector('.toolbar').getClientRects().length > 0", "Escape leaves focus mode");
    if (process.platform === "win32") await waitFor(app, "window.innerWidth < screen.width - 2 || window.innerHeight < screen.height - 2", "window back from full screen");
    assert(text((await blocks())[1]).endsWith(" FOCUSED"), "typing in focus mode reached the script");
    // From the View dropdown and the native menu too.
    await clickHome(app, "#view-menu-btn");
    await clickHome(app, "#view-menu [data-panel=focus]");
    await waitFor(app, "document.body.dataset.focus === 'on'", "focus mode from the dropdown");
    await app.evaluate("__cirth.menu('focus_mode')");
    await waitFor(app, "!document.body.dataset.focus", "View > Focus Mode turns it off");
    // Going Home ends it.
    await app.evaluate("__cirth.menu('focus_mode')");
    await waitFor(app, "document.body.dataset.focus === 'on'", "on again");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    assert(!(await app.evaluate("document.body.dataset.focus")), "Home ends focus mode");
  });

  await test("Menus: File, Edit, View, Format, Help hold every action; formatting, elements, page size and spelling work from them; check marks follow", async () => {
    await openFixture("unicode-marks");
    const menu = () => app.evaluate("window.__TAURI_INTERNALS__.invoke('menu_items')");
    let items = await menu();
    const tops = [...new Set(items.map((i) => i.path.split(" > ")[0]))];
    assert(JSON.stringify(tops) === JSON.stringify(["File", "Edit", "View", "Format", "Help"]), `top-level menus: ${tops}`);
    const ids = new Set(items.map((i) => i.id));
    const want = ["new", "open", "import", "save", "save_as", "export", "home", "quit", "undo", "redo", "find", "spell_suggest", "spell_en_US", "spell_en_GB", "spell_off",
      "mode_normal", "mode_page", "view_typewriter", "focus_mode", "full_screen", "view_nav", "view_board", "view_toolbar", "view_status", "storyscry", "ui_larger", "ui_smaller", "ui_reset", "ui_contrast",
      "goto_page", "goto_scene", "win_minimize", "win_zoom", "focus_next",
      "bold", "italic", "underline", "dual", "page_break", "page_letter", "page_a4", "title_page", "page_furniture", "shortcuts", "latency", "updates", "licences", "about",
      ...["heading", "action", "character", "parenthetical", "dialogue", "transition", "shot", "section", "lyric"].map((k) => `kind_${k}`)];
    const missing = want.filter((id) => !ids.has(id));
    assert(!missing.length, `missing menu items: ${missing}`);
    const editNative = items.filter((i) => i.path.startsWith("Edit > ") && !want.includes(i.id));
    assert(editNative.length >= 4, `Edit has the OS's Cut, Copy, Paste and Select All: ${editNative.map((i) => i.path)}`);
    // Owner's layout (2026-10-28): one Import and one Export; modes, tools, appearance, go to and window under View;
    // elements, screen font, title page, headers and footers and spelling under Format; Free Writing is not in File.
    const at = (id) => items.find((i) => i.id === id)?.path ?? "(missing)";
    const where = { import: "File > Import…", mode_page: "View > Mode > Page View", view_typewriter: "View > Mode > Typewriter Mode", view_nav: "View > Tools > Scene List", storyscry: "View > Tools > StoryScry…", ui_contrast: "View > Appearance > High Contrast",
      goto_page: "View > Go To > Page…", win_minimize: "View > Window > Minimise", title_page: "Format > Title Page…", page_furniture: "Format > Headers and Footers…", spell_off: "Format > Spelling > Off",
      font_mono: "Format > Screen Font > System Monospace", shortcuts: "Help > Keyboard Shortcuts…", updates: "Help > Check for Updates…", licences: "Help > Licences…" };
    for (const [id, path] of Object.entries(where)) assert(at(id).startsWith(path), `${id} at ${path}: ${at(id)}`);
    assert(at("export").startsWith("File > Export…") && items.some((i) => i.path.startsWith("Format > Element > Dialogue (")), `one Export and an Element menu: ${at("export")}`);
    assert(!ids.has("free_writing") && !ids.has("import_fountain") && !ids.has("export_pdf") && !items.some((i) => i.path.startsWith("Edit > Spelling")), "no separate imports or exports, no Free Writing in File, no Spelling in Edit");
    const checked = (id) => items.find((i) => i.id === id)?.checked;
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'page_letter').checked && !m.find(i => i.id === 'page_a4').checked && m.find(i => i.id === 'spell_en_US').checked)", "check marks match this document on open");

    // Format > Bold on a selection; Block Type on the caret's block.
    const b0 = await blocks();
    const ai = b0.findIndex((b) => b.kind === "action");
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 5]`);
    await app.evaluate("__cirth.menu('bold')");
    assert((await blocks())[ai].runs.some((r) => r.bold), "Format > Bold");
    await app.evaluate("__cirth.menu('bold')");
    assert(!(await blocks())[ai].runs.some((r) => r.bold), "Format > Bold again removes it");
    await app.evaluate("__cirth.menu('kind_transition')");
    assert((await blocks())[ai].kind === "transition", "Format > Element > Transition");
    await press("z", [MOD_KEY]);
    assert((await blocks())[ai].kind === "action", "one undo restores the type");

    // Page size and spelling from the menu: the toolbar and the check marks follow.
    await app.evaluate("__cirth.menu('page_a4')");
    await waitFor(app, "document.getElementById('profile').value === 'a4' && __cirth.pagination?.map.profile.includes('a4')", "A4 from the Format menu");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'page_a4').checked && !m.find(i => i.id === 'page_letter').checked)", "A4 checked, Letter not");
    await app.evaluate("__cirth.menu('page_letter')");
    await waitFor(app, "document.getElementById('profile').value === 'letter'", "back to Letter");
    await app.evaluate("__cirth.menu('spell_en_GB')");
    await waitFor(app, "document.getElementById('spelling').value === 'en_GB'", "UK spelling from the Format menu");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'spell_en_GB').checked && !m.find(i => i.id === 'spell_en_US').checked)", "UK checked");
    await app.evaluate("__cirth.menu('spell_en_US')");
    await waitFor(app, "document.getElementById('spelling').value === 'en_US'", "back to US");
    // View > Mode: Page View and Normal View switch the view and keep their check marks in step.
    await app.evaluate("__cirth.menu('mode_page')");
    await waitFor(app, "document.body.dataset.pageview === 'pages'", "View > Mode > Page View");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'mode_page').checked && !m.find(i => i.id === 'mode_normal').checked)", "Page View checked");
    await app.evaluate("__cirth.menu('mode_normal')");
    await waitFor(app, "document.body.dataset.pageview === 'continuous'", "View > Mode > Normal View");
    // Import reads the format from the file: Final Draft by content or extension, otherwise Fountain/plain text.
    const det = await app.evaluate(`[__cirth.importerFor('a.fdx', ''), __cirth.importerFor('script.txt', '<?xml version="1.0"?><FinalDraft DocumentType="Script">'), __cirth.importerFor('b.fountain', 'INT. ROOM'), __cirth.importerFor('c.txt', 'INT. ROOM'), __cirth.importerFor('d.pdf', '%PDF')]`);
    assert(JSON.stringify(det) === JSON.stringify(["fdx", "fdx", "fountain", "fountain", null]), `import detection: ${det}`);
    // File > Export… lists every format; changed pages only with an active revision set.
    await app.evaluate("(__cirth.menu('export'), true)");
    await waitFor(app, "document.getElementById('export-dialog').open", "File > Export… opens the dialog");
    const formats = await app.evaluate("[...document.querySelectorAll('#export-dialog input[name=export-format]')].map(r => r.value + (r.disabled ? ':off' : ''))");
    assert(formats.join() === "pdf,pdf_changed:off,txt,fountain,fdx,docx,rtf,html,reports", `export formats: ${formats}`);
    await app.evaluate("(document.getElementById('export-cancel').click(), true)");
    // View > Go To > Scene… and Page…: the caret moves there.
    const scenes = await app.evaluate("__cirth.scenes()");
    await app.evaluate("(__cirth.menu('goto_scene'), true)");
    await waitFor(app, "document.getElementById('goto-dialog').open", "Go To Scene opens");
    await app.evaluate(`(() => { const i = document.getElementById('goto-input'); i.value = ${JSON.stringify(String(scenes.length))}; document.getElementById('goto-go').click(); return true; })()`);
    await waitFor(app, `!document.getElementById('goto-dialog').open && __cirth.view.state.selection.from >= __cirth.scenes()[${scenes.length - 1}].from`, "Go To Scene: caret in the last scene");
    await app.evaluate("(__cirth.menu('goto_page'), true)");
    await app.evaluate("(() => { const i = document.getElementById('goto-input'); i.value = '999'; document.getElementById('goto-go').click(); return true; })()");
    assert(/no page 999/.test(await app.evaluate("document.getElementById('goto-error').textContent")) && (await app.evaluate("document.getElementById('goto-dialog').open")), "Go To Page: a page that does not exist is reported, the dialog stays");
    await app.evaluate("(() => { const i = document.getElementById('goto-input'); i.value = '1'; document.getElementById('goto-go').click(); return true; })()");
    await waitFor(app, "!document.getElementById('goto-dialog').open && __cirth.view.state.selection.from <= 2", "Go To Page 1: caret at the start");
    // Help > Keyboard Shortcuts… lists the shortcuts.
    await app.evaluate("(__cirth.menu('shortcuts'), true)");
    await waitFor(app, "document.getElementById('shortcuts-dialog').open && document.querySelectorAll('#shortcuts-dialog .shortcut-table tr').length >= 15", "Help > Keyboard Shortcuts…");
    await app.evaluate("(document.getElementById('shortcuts-close').click(), true)");
    // The comment button is a placeholder until M5: it says so and changes nothing.
    const before = JSON.stringify(await blocks());
    await app.evaluate("(document.getElementById('tool-comments').click(), true)");
    assert((await app.evaluate("document.getElementById('tool-comments').getAttribute('aria-disabled')")) === "true" && /not built yet/.test(await app.evaluate("document.getElementById('banner').textContent")), "comment placeholder says comments are not built yet");
    assert(JSON.stringify(await blocks()) === before, "the comment placeholder changes nothing");
    // Free Writing is in the island's More menu (and on Home), no longer in File.
    await app.evaluate("__cirth.menu('free_writing')");
    await waitFor(app, "document.body.dataset.view === 'free'", "Free Writing still opens");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    items = await menu();
    return { menuItems: items.length, checked: ["page_letter", "spell_en_US"].map((id) => [id, checked(id)]) };
  });

  await test("Island toolbar: one island centred over the script; panels and tools on it; rare settings in More; B/I/U and block type follow the caret", async () => {
    await openFixture("unicode-marks");
    const visible = (sel) => app.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
    const islands = await app.evaluate("document.querySelectorAll('.toolbar > .island').length");
    const groups = await app.evaluate("[...document.querySelectorAll('.island > .island-group')].map(g => g.getAttribute('aria-label'))");
    assert(islands === 1 && JSON.stringify(groups) === JSON.stringify(["Project and history", "Format", "Panels and tools"]), `one island with groups: ${islands} ${groups}`);
    // Centred over the script, also when a side panel is hidden.
    const offCentre = () => app.evaluate("(() => { const i = document.querySelector('.island').getBoundingClientRect(); const w = document.querySelector('.editor-wrap').getBoundingClientRect(); return Math.round((i.left + i.right) / 2 - (w.left + w.right) / 2); })()");
    assert(Math.abs(await offCentre()) <= 2, `island centred over the script: ${await offCentre()} px`);
    // Panel toggles on the island.
    assert((await app.evaluate("document.getElementById('toggle-board').getAttribute('aria-pressed')")) === "true", "board button shows the board is on");
    await clickHome(app, "#toggle-board");
    await waitFor(app, "!document.getElementById('board').getClientRects().length && document.getElementById('toggle-board').getAttribute('aria-pressed') === 'false'", "board hidden from the island");
    assert(Math.abs(await offCentre()) <= 2, `still centred with the board hidden: ${await offCentre()} px`);
    await clickHome(app, "#toggle-board");
    await waitFor(app, "document.getElementById('board').getClientRects().length > 0", "board back");
    // Rarely used settings are not on the island; they are in More.
    for (const sel of ["#profile", "#spelling", "#view-mode", "#zoom", "#save", "#go-free"]) assert(!(await visible(sel)), `${sel} is not on the island`);
    assert(!(await app.evaluate("!!document.querySelector('.toolbar #save-as, .toolbar #pdf, .toolbar #txt')")), "Save As and Export are menu-only");
    await clickHome(app, "#view-menu-btn");
    await waitFor(app, "!document.getElementById('view-menu').hidden", "More open");
    for (const sel of ["#profile", "#spelling", "#view-mode", "#zoom", "#save", "#go-free"]) assert(await visible(`#view-menu ${sel}`), `${sel} in More`);
    await audit("island and More");
    await screenshot(app, "island-more");
    // Tab cycles inside More and never leaves into the script (macOS check N18).
    const kinds0 = (await blocks()).map((b) => b.kind).join();
    const inMore = () => app.evaluate("document.getElementById('view-menu').contains(document.activeElement)");
    // Where focus is, for failure messages: "select#view-mode", "body" …
    const focusAt = () => app.evaluate("(() => { const a = document.activeElement; return a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.dataset.panel ? '[' + a.dataset.panel + ']' : '') : 'none'; })()");
    for (let i = 0; i < 9; i++) {
      await press("Tab");
      assert(await inMore(), `Tab ${i + 1} stays inside More (focus on ${await focusAt()})`);
    }
    const before = await focusAt();
    await press("Tab", ["shift"]);
    assert(await inMore(), `Shift+Tab stays inside More (from ${before}, focus now on ${await focusAt()})`);
    assert((await blocks()).map((b) => b.kind).join() === kinds0, "no block type changed while tabbing");
    await press("Escape");
    assert(await app.evaluate("document.getElementById('view-menu').hidden && document.activeElement?.id === 'view-menu-btn'"), "Escape closes More and returns to ⋮");
    // Arrow keys move along the island (toolbar pattern), Home and End jump.
    await press("Home");
    assert((await app.evaluate("document.activeElement?.id")) === "go-home", "Home: first island control");
    await press("ArrowRight");
    assert((await app.evaluate("document.activeElement?.id")) === "tool-undo", "ArrowRight: next control");
    await press("End");
    assert((await app.evaluate("document.activeElement?.id")) === "view-menu-btn", "End: last control");
    await press("ArrowLeft");
    assert((await app.evaluate("document.activeElement?.id")) === "tool-focus", "ArrowLeft: previous control");
    assert((await blocks()).map((b) => b.kind).join() === kinds0, "arrowing along the island edits nothing");
    assert(await app.evaluate("!!document.querySelector('#board #structural') && !document.querySelector('.toolbar #structural')"), "the board's reorder switch lives on the board");
    // Undo and redo from the island keep the caret in the script.
    const ai0 = (await blocks()).findIndex((b) => b.kind === "action");
    await caretAtEndOf(ai0);
    await typeText(" UNDOME");
    await sleep(600);
    await app.evaluate("(() => { const b = document.getElementById('tool-undo'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); b.click(); return true; })()");
    assert(!text((await blocks())[ai0]).includes("UNDOME") && (await app.evaluate("__cirth.view.hasFocus()")), "island undo, focus kept");
    await app.evaluate("(() => { document.getElementById('tool-redo').click(); return true; })()");
    assert(text((await blocks())[ai0]).includes("UNDOME"), "island redo");
    await audit("island toolbar");
    const pressed = () => app.evaluate("['fmt-bold', 'fmt-italic', 'fmt-underline'].map(id => document.getElementById(id).getAttribute('aria-pressed'))");
    // Press like a mouse does: mousedown (must not take focus), then click.
    const pressButton = (id) => app.evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); b.click(); return true; })()`);
    const b0 = await blocks();
    const ai = b0.findIndex((b) => b.kind === "action" && text(b).length > 8);
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 6]`);
    const sel0 = await app.evaluate("[__cirth.view.state.selection.from, __cirth.view.state.selection.to]");
    await pressButton("fmt-bold");
    assert((await blocks())[ai].runs[0].bold && (await blocks())[ai].runs[0].text.length === 5, `B bolds the selection: ${JSON.stringify((await blocks())[ai].runs)}`);
    assert(JSON.stringify(await app.evaluate("[__cirth.view.state.selection.from, __cirth.view.state.selection.to]")) === JSON.stringify(sel0) && (await app.evaluate("__cirth.view.hasFocus()")), "selection and focus kept");
    assert((await pressed())[0] === "true", "B shows pressed on bold text");
    await pressButton("fmt-italic");
    await pressButton("fmt-underline");
    assert(JSON.stringify(await pressed()) === JSON.stringify(["true", "true", "true"]), `all three pressed: ${await pressed()}`);
    await press("b", [MOD_KEY]);
    assert((await pressed())[0] === "false" && !(await blocks())[ai].runs.some((r) => r.bold), "Ctrl/Cmd+B turns bold off and the button follows");
    // Caret elsewhere: plain text shows nothing pressed.
    await caretAtEndOf(ai);
    assert(JSON.stringify(await pressed()) === JSON.stringify(["false", "false", "false"]), `plain text: ${await pressed()}`);
    // Block type follows the caret, and choosing one changes the block (one undo step).
    const ci = b0.findIndex((b) => b.kind === "character");
    await caretAtEndOf(ci);
    assert((await app.evaluate("document.getElementById('block-kind').value")) === "character", "block type shows the caret's block");
    await app.evaluate("(() => { const s = document.getElementById('block-kind'); s.value = 'transition'; s.dispatchEvent(new Event('change')); return true; })()");
    assert((await blocks())[ci].kind === "transition" && (await app.evaluate("__cirth.view.hasFocus()")), "choosing a type changes the block and returns to the script");
    await press("z", [MOD_KEY]);
    assert((await blocks())[ci].kind === "character" && (await app.evaluate("document.getElementById('block-kind').value")) === "character", "undo restores it and the control follows");
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 6]`);
    await screenshot(app, "island-toolbar");
  });

  await test("Typewriter mode: the typing line stays at the middle while typing and arrowing; a View toggle stored per user", async () => {
    await openFixture("long-120");
    const offset = () => app.evaluate(`(() => { const v = __cirth.view; const c = v.coordsAtPos(v.state.selection.head); const w = document.querySelector('.editor-wrap'); const b = w.getBoundingClientRect(); return Math.round((c.top + c.bottom) / 2 - (b.top + w.clientHeight / 2)) || 0; })()`); // -0 is not serialisable over DevTools
    await caretAtEndOf(3);
    await press("t", [MOD_KEY, "shift"]);
    await waitFor(app, "__cirth.prefs().typewriter === true && document.body.hasAttribute('data-typewriter')", "typewriter on");
    await waitAnnounced("Typewriter mode on", "announced");
    await typeText(" kept centred");
    assert(Math.abs(await offset()) <= 3, `typing line at the middle near the top of the script: ${await offset()} px`);
    for (let i = 0; i < 25; i++) await press("ArrowDown");
    assert(Math.abs(await offset()) <= 3, `still centred after arrowing down: ${await offset()} px`);
    await press("Enter");
    await typeText("New line in typewriter mode.");
    assert(Math.abs(await offset()) <= 3, `still centred after a new line: ${await offset()} px`);
    const items = await app.evaluate("window.__TAURI_INTERNALS__.invoke('menu_items')");
    assert(items.find((i) => i.id === "view_typewriter")?.checked === true, "View > Typewriter Mode is checked");
    await clickHome(app, "#view-menu-btn");
    assert((await app.evaluate("document.querySelector('#view-menu [data-panel=typewriter]').getAttribute('aria-checked')")) === "true", "the toolbar dropdown shows it");
    await clickHome(app, "#view-menu [data-panel=typewriter]");
    await waitFor(app, "__cirth.prefs().typewriter === false", "off from the dropdown");
    await app.evaluate("__cirth.view.focus()");
    // Off: typing does not move the script.
    const top0 = await app.evaluate("document.querySelector('.editor-wrap').scrollTop");
    await typeText(" x");
    assert(Math.abs((await app.evaluate("document.querySelector('.editor-wrap').scrollTop")) - top0) < 2, "no recentring when off");
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(saved.typewriter === false, `stored ${JSON.stringify(saved)}`);
  });

  await test("Screen font and size change only the screen: text stays inside the page, Pages view and the page map keep the standard font", async () => {
    await openFixture("page-boundaries");
    const pages0 = await app.evaluate("window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => p.map.pages.length)");
    const look = () => app.evaluate(`(() => { const pm = getComputedStyle(document.querySelector('.ProseMirror')); const page = document.getElementById('editor').getBoundingClientRect();
      const over = [...document.querySelectorAll('.ProseMirror p')].filter(p => p.getBoundingClientRect().right > page.right + 1).length;
      return { family: pm.fontFamily, size: pm.fontSize, over }; })()`);
    let l = await look();
    assert(l.family.includes("Courier Prime") && l.size === "16px" && l.over === 0, `standard at first: ${JSON.stringify(l)}`);
    // Toolbar: serif, 18 pt.
    await app.evaluate("(() => { const s = document.getElementById('screen-font'); s.value = 'serif'; s.dispatchEvent(new Event('change')); return true; })()");
    await app.evaluate("(() => { const s = document.getElementById('screen-size'); s.value = '18'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "__cirth.prefs().editor_font === 'serif' && __cirth.prefs().editor_size === 18", "serif 18 pt stored");
    l = await look();
    assert(/Georgia|serif/.test(l.family) && l.size === "24px", `serif 18 pt on screen: ${JSON.stringify(l)}`);
    assert(l.over === 0, `${l.over} paragraphs run past the page edge at 18 pt`);
    await screenshot(app, "screen-font-serif-18");
    await waitAnnounced("Screen text size 18 points", "size announced");
    // The page map is the authority and does not change.
    assert((await app.evaluate("window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => p.map.pages.length)")) === pages0, "page count unchanged");
    // Pages view shows the real pages: standard font and size.
    await app.evaluate("(() => { const s = document.getElementById('view-mode'); s.value = 'pages'; s.dispatchEvent(new Event('change')); return true; })()");
    l = await look();
    assert(l.family.includes("Courier Prime") && l.size === "16px", `Pages view uses the standard font: ${JSON.stringify(l)}`);
    await app.evaluate("(() => { const s = document.getElementById('view-mode'); s.value = 'continuous'; s.dispatchEvent(new Event('change')); return true; })()");
    // View menu: font items with check marks, larger and standard size.
    await app.evaluate("__cirth.menu('font_mono')");
    await app.evaluate("__cirth.menu('font_larger')");
    await waitFor(app, "__cirth.prefs().editor_font === 'mono' && __cirth.prefs().editor_size === 19", "View > Screen Font from the menu");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'font_mono').checked && !m.find(i => i.id === 'font_serif').checked)", "check mark on the chosen font");
    assert((await app.evaluate("[document.getElementById('screen-font').value, document.getElementById('screen-size').value]")).join() === "mono,19", "toolbar follows the menu");
    const saved = JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"));
    assert(saved.editor_font === "mono" && saved.editor_size === 19, `stored ${JSON.stringify(saved)}`);
    await app.evaluate("__cirth.menu('font_courier-prime')");
    await app.evaluate("__cirth.menu('font_reset')");
    await waitFor(app, "__cirth.prefs().editor_font === 'courier-prime' && __cirth.prefs().editor_size === 12", "back to standard");
  });

  await test("Text colour and highlight: on-screen markup that is stored and undoable but never reaches the text export", async () => {
    await openFixture("unicode-marks");
    const txtBefore = join(dataDir, "markup-before.txt");
    const txtAfter = join(dataDir, "markup-after.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(txtBefore)})`), "export before");
    const b0 = await blocks();
    const ai = b0.findIndex((b) => b.kind === "action" && text(b).length > 12);
    const choose = (id, value) => app.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return true; })()`);
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 5]`);
    await choose("fmt-color", "red");
    let r = (await blocks())[ai].runs;
    assert(r[0].color === "red" && r[0].text.length === 4 && !r[1].color, `red on the selection only: ${JSON.stringify(r)}`);
    assert(await app.evaluate("__cirth.view.hasFocus()"), "back in the script after choosing");
    await choose("fmt-highlight", "yellow");
    r = (await blocks())[ai].runs;
    assert(r[0].color === "red" && r[0].highlight === "yellow", `both marks: ${JSON.stringify(r)}`);
    const shown = await app.evaluate(`(() => { const s = document.querySelector('.ProseMirror .tc-red'); const m = document.querySelector('.ProseMirror mark.hl-yellow'); return !!s && !!m && getComputedStyle(s).color !== getComputedStyle(document.querySelector('.ProseMirror')).color; })()`);
    assert(shown, "the red text and the yellow highlight are visible on screen");
    // The toolbar follows the caret.
    await setCaret(`[ps[${ai}][0] + 3]`);
    assert((await app.evaluate("[document.getElementById('fmt-color').value, document.getElementById('fmt-highlight').value]")).join() === "red,yellow", "toolbar shows the marks at the caret");
    // Format menu, and one undo per change.
    await setCaret(`[ps[${ai}][0] + 1, ps[${ai}][0] + 5]`);
    await app.evaluate("__cirth.menu('highlight_none')");
    assert(!(await blocks())[ai].runs.some((x) => x.highlight), "Format > Highlight > None removes it");
    await app.evaluate("__cirth.menu('color_blue')");
    assert((await blocks())[ai].runs[0].color === "blue", "Format > Text Colour > Blue replaces red");
    await press("z", [MOD_KEY]);
    assert((await blocks())[ai].runs[0].color === "red", "one undo restores red");
    await choose("fmt-highlight", "green");
    // Stored with the text and kept after reopening.
    assert(await storedMatchesEditor(), "stored equals editor");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("unicode-marks", false);
    r = (await blocks())[ai].runs;
    assert(r[0].color === "red" && r[0].highlight === "green", `kept after reopening: ${JSON.stringify(r)}`);
    // Never printed or exported: the text export is identical.
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(txtAfter)})`), "export after");
    assert(readFileSync(txtBefore, "utf8") === readFileSync(txtAfter, "utf8"), "text export unchanged by colour and highlight");
    // Our own copy and paste keeps the markup.
    const own = await app.evaluate(`(() => { const v = __cirth.view; let p0 = 0; v.state.doc.forEach((n, p, i) => { if (i === ${ai}) p0 = p; });
      const r = v.serializeForClipboard(v.state.doc.slice(p0 + 1, p0 + 5)); return { html: r.dom.innerHTML, text: r.text }; })()`);
    await caretAtEndOf(ai);
    await pasteEvent({ "text/html": own.html, "text/plain": own.text });
    r = (await blocks())[ai].runs;
    assert(r.at(-1).color === "red" && r.at(-1).highlight === "green", `pasted copy keeps markup: ${JSON.stringify(r)}`);
    await screenshot(app, "colour-highlight");
  });

  await test("Narrow script column: panels shrink, then float over the script and open from the island; the page always fits", async () => {
    await openFixture("page-boundaries");
    const setZoom = (z) => app.evaluate(`(() => { const s = document.getElementById('zoom'); s.value = '${z}'; s.dispatchEvent(new Event('input')); return true; })()`);
    const state = () => app.evaluate(`(() => { const w = document.querySelector('.editor-wrap'); const page = document.getElementById('editor').getBoundingClientRect().width;
      const shown = (id) => document.getElementById(id).getClientRects().length > 0;
      return { layout: document.body.dataset.layout, fits: w.clientWidth >= page, nav: shown('navigator'), board: shown('board'),
        navPressed: document.getElementById('toggle-nav').getAttribute('aria-pressed'), boardPressed: document.getElementById('toggle-board').getAttribute('aria-pressed'), editorW: Math.round(w.getBoundingClientRect().width) }; })()`);
    let s = await state();
    assert(s.layout !== "overlay" && s.fits && s.nav && s.board, `at 100% the page fits beside both panels: ${JSON.stringify(s)}`);
    // A page too wide for the column: the panels float instead of squeezing it.
    await setZoom(160);
    s = await state();
    assert(s.layout === "overlay" && !s.nav && !s.board && s.fits, `overlay: panels out of the way, page fits: ${JSON.stringify(s)}`);
    assert(s.navPressed === "false" && s.boardPressed === "false", "island buttons show the panels closed");
    const w0 = s.editorW;
    await clickHome(app, "#toggle-nav");
    s = await state();
    assert(s.nav && s.navPressed === "true" && s.editorW === w0, `scene list floats over the script without squeezing it: ${JSON.stringify(s)}`);
    assert(await app.evaluate("document.getElementById('navigator').contains(document.activeElement)"), "focus moves into the floating panel");
    await waitAnnounced("open over the script", "announced");
    // Tab stays inside the floating panel (it used to drop into the script,
    // where Tab changes the block type: macOS check N19).
    const kindsBefore = (await blocks()).map((b) => b.kind).join();
    for (let i = 0; i < 3; i++) await press("Tab");
    await press("Tab", ["shift"]);
    assert((await state()).nav && (await app.evaluate("document.getElementById('navigator').contains(document.activeElement)")), "Tab stays in the floating scene list");
    assert((await blocks()).map((b) => b.kind).join() === kindsBefore, "no block type changed");
    await press("Escape");
    s = await state();
    assert(!s.nav && (await app.evaluate("__cirth.view.hasFocus()")), `Escape closes it and returns to the script: ${JSON.stringify(s)}`);
    await clickHome(app, "#toggle-board");
    assert((await state()).board, "board floats");
    // Arrow keys on the board's first control stay in the board (macOS note:
    // they seemed to close it and move the script caret).
    const sel0 = await app.evaluate("__cirth.view.state.selection.head");
    await app.evaluate("(() => { document.getElementById('structural').focus(); return true; })()");
    await press("ArrowDown");
    await press("ArrowRight");
    assert((await state()).board && (await app.evaluate("__cirth.view.state.selection.head")) === sel0, `arrows on the floating board leave the script alone: ${JSON.stringify(await state())}`);
    await app.evaluate("__cirth.view.focus()");
    assert(!(await state()).board, "going back to the script closes it");
    const panelsNow = await app.evaluate("__cirth.prefs().panels");
    assert(["nav", "board", "toolbar", "status"].every((k) => panelsNow[k] === true), `floating never changes the stored panel choices: ${JSON.stringify(panelsNow)} layout ${JSON.stringify(await state())}`);
    await screenshot(app, "overlay-closed");
    await setZoom(100);
    s = await state();
    assert(s.layout !== "overlay" && s.nav && s.board, `back beside the script at 100%: ${JSON.stringify(s)}`);
  });

  await test("Title page: File > Title Page… fields are kept in the project and printed before page 1 in text and PDF exports", async () => {
    await openFixture("page-boundaries");
    await app.evaluate("__cirth.menu('title_page')");
    await waitFor(app, "document.getElementById('title-dialog')?.open === true", "Title page dialog open");
    assert((await app.evaluate("document.getElementById('tp-title').value")) === "", "empty at first");
    await audit("title page dialog");
    const fill = { title: "THE TIDE LEDGER", credit: "Written by", authors: "Jared Hoy", draft_label: "Second Draft", draft_date: "27 October 2026", wga: "1234567", contact: "jared@example.invalid\n555 0100" };
    await app.evaluate(`(() => { const f = ${JSON.stringify(fill)}; for (const k in f) document.getElementById('tp-' + k).value = f[k]; document.getElementById('tp-save').click(); return true; })()`);
    await waitFor(app, "!document.getElementById('title-dialog').open", "saved and closed");
    await waitAnnounced("Title page saved", "save announced");
    // Kept in the project file.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await app.evaluate("__cirth.menu('title_page')");
    await waitFor(app, "document.getElementById('title-dialog').open && document.getElementById('tp-title').value === 'THE TIDE LEDGER' && document.getElementById('tp-wga').value === '1234567'", "fields kept after reopening");
    await app.evaluate("(() => { document.getElementById('tp-cancel').click(); return true; })()");
    // Text export: the title page, a form feed, then the same script pages.
    const pages = await app.evaluate("window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => p.map.pages.length)");
    const out = join(dataDir, "with-title.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "text exported");
    const txt = readFileSync(out, "utf8");
    const parts = txt.split("\f");
    assert(parts.length === pages + 1, `${parts.length} text pages for ${pages} script pages plus the title page`);
    assert(/^ {20,}THE TIDE LEDGER$/m.test(parts[0]) && parts[0].includes("WGA Registration No. 1234567") && parts[0].includes("555 0100"), `title page text: ${parts[0].trim().slice(0, 300)}`);
    assert(!/^\s*\d+\.\s*$/m.test(parts[0]), "the title page has no page number");
    // PDF: one more page than the script.
    const pdf = await app.evaluate("window.__TAURI_INTERNALS__.invoke('export_pdf', { profileName: 'letter' })");
    const bytes = readFileSync(pdf.path, "latin1");
    const pdfPages = (bytes.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    assert(pdfPages === pages + 1, `PDF has ${pdfPages} pages for ${pages} script pages plus the title page`);
    // No title: no title page.
    await app.evaluate("__cirth.menu('title_page')");
    await waitFor(app, "document.getElementById('title-dialog').open", "reopened");
    await app.evaluate("(() => { document.getElementById('tp-title').value = ''; document.getElementById('tp-save').click(); return true; })()");
    await waitFor(app, "!document.getElementById('title-dialog').open", "saved without a title");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "text exported again");
    assert(readFileSync(out, "utf8").split("\f").length === pages, "no title page without a title");
  });

  await test("Fountain: import a .fountain file as a new project (with report), export it back, and the round trip keeps the script", async () => {
    const src = join(dataDir, "salt and iron.fountain");
    writeFileSync(src, "Title: SALT AND IRON\nCredit: Written by\nAuthor: Jared Hoy\nDraft date: 1 May 2026\n\nINT. FORGE - NIGHT #12#\n\nSparks fly. *Somewhere* a bell rings.\n\nMARA\n(quietly)\nHand me the **tongs**.\n\nBRAM ^\nNo.\n\nCUT TO:\n\n===\n\nEXT. QUAY - DAWN\n\nThe tide is out.\n");
    await app.evaluate(`__cirth.importFountain(${JSON.stringify(src)})`);
    await waitFor(app, "__cirth.lastOpen && __cirth.lastOpen.doc.title === 'SALT AND IRON'", "imported project open");
    const b = await blocks();
    assert(b.map((x) => x.kind).join() === "heading,action,character,parenthetical,dialogue,character,dialogue,transition,heading,action", `kinds: ${b.map((x) => x.kind)}`);
    assert(text(b[0]) === "INT. FORGE - NIGHT" && b[2].kind === "character" && b[5].dual === true && b[8].break_before === true, `structure: ${JSON.stringify(b.map((x) => [x.kind, text(x), x.dual, x.break_before]))}`);
    assert(b[1].runs.some((r) => r.italic && r.text === "Somewhere") && b[4].runs.some((r) => r.bold && r.text === "tongs"), "emphasis imported");
    const banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(banner.includes("Imported") && banner.includes("12"), `import report shown: ${banner}`);
    const tp = await app.evaluate("window.__TAURI_INTERNALS__.invoke('title_page')");
    assert(tp.title === "SALT AND IRON" && tp.authors === "Jared Hoy" && tp.draft_date === "1 May 2026", `title page imported: ${JSON.stringify(tp)}`);
    assert(await storedMatchesEditor(), "stored equals editor");
    // It is a normal library project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    assert(await app.evaluate("[...document.querySelectorAll('#home [data-project]')].some(e => e.dataset.project === 'salt-and-iron')"), "listed on Home");
    await clickHome(app, '[data-project="salt-and-iron"]');
    await waitOpen(app);
    // Export and re-import: same script.
    const out = join(dataDir, "salt export.fountain");
    assert(await app.evaluate(`__cirth.exportFountain(${JSON.stringify(out)})`), "exported");
    const exported = readFileSync(out, "utf8");
    assert(exported.startsWith("Title: SALT AND IRON\n") && exported.includes("\nBRAM ^\n") && exported.includes("\n===\n") && exported.includes("*Somewhere*"), `Fountain text: ${exported.slice(0, 400)}`);
    assert((await app.evaluate("document.getElementById('banner').textContent")).includes("Fountain written"), "export reported");
    const shapeOf = (bs) => JSON.stringify(bs.map((x) => [x.kind, x.runs.filter((r) => r.text).map((r) => [r.text, !!r.bold, !!r.italic, !!r.underline]), !!x.dual, !!x.break_before]));
    const before = shapeOf(await blocks());
    await app.evaluate(`__cirth.importFountain(${JSON.stringify(out)})`);
    await waitFor(app, "__cirth.lastOpen && __cirth.lastOpen.name === 'salt-and-iron-2'", "re-imported as a second project");
    assert(shapeOf(await blocks()) === before, "round trip keeps every block, type and emphasis");
  });

  await test("Final Draft: import a .fdx file as a new project (with report), export it back, and the round trip keeps the script", async () => {
    const src = join(dataDir, "forge scene.fdx");
    writeFileSync(src, `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Number="3" Type="Scene Heading"><Text>INT. FORGE - NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><Text>Sparks fly &amp; a </Text><Text Style="Italic">bell</Text><Text> rings.</Text></Paragraph>
    <Paragraph><DualDialogue>
      <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text Style="Bold">Now</Text><Text>.</Text></Paragraph>
      <Paragraph Type="Character"><Text>BRAM</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>No.</Text></Paragraph>
    </DualDialogue></Paragraph>
    <Paragraph Type="Cast List"><Text>MARA, BRAM</Text></Paragraph>
    <Paragraph StartsNewPage="Yes" Type="Scene Heading"><Text>EXT. QUAY - DAWN</Text></Paragraph>
  </Content>
  <TitlePage><Content>
    <Paragraph Alignment="Center"><Text>FORGE SCENE</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Jared Hoy</Text></Paragraph>
  </Content></TitlePage>
</FinalDraft>`);
    await app.evaluate(`__cirth.importFdx(${JSON.stringify(src)})`);
    await waitFor(app, "__cirth.lastOpen && __cirth.lastOpen.doc.title === 'FORGE SCENE'", "imported project open");
    const b = await blocks();
    assert(b.map((x) => x.kind).join() === "heading,action,character,dialogue,character,dialogue,action,heading", `kinds: ${b.map((x) => x.kind)}`);
    assert(text(b[1]) === "Sparks fly & a bell rings." && b[1].runs.some((r) => r.italic && r.text === "bell"), "text, entities and italic");
    assert(!b[2].dual && b[4].dual && b[7].break_before, "dual dialogue and page break");
    const banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(banner.includes("Imported") && banner.includes("Cast List") && banner.includes("3"), `import report shown: ${banner}`);
    const tp = await app.evaluate("window.__TAURI_INTERNALS__.invoke('title_page')");
    assert(tp.title === "FORGE SCENE" && tp.credit === "Written by" && tp.authors === "Jared Hoy", `title page: ${JSON.stringify(tp)}`);
    // Export and re-import: same script.
    const out = join(dataDir, "forge export.fdx");
    assert(await app.evaluate(`__cirth.exportFdx(${JSON.stringify(out)})`), "exported");
    const xml = readFileSync(out, "utf8");
    assert(xml.includes("<DualDialogue>") && xml.includes('StartsNewPage="Yes"') && xml.includes('Style="Italic"') && xml.includes("&amp;"), `FDX text: ${xml.slice(0, 300)}`);
    const shapeOf = (bs) => JSON.stringify(bs.map((x) => [x.kind, x.runs.filter((r) => r.text).map((r) => [r.text, !!r.bold, !!r.italic, !!r.underline]), !!x.dual, !!x.break_before]));
    const before = shapeOf(await blocks());
    await app.evaluate(`__cirth.importFdx(${JSON.stringify(out)})`);
    await waitFor(app, "__cirth.lastOpen && __cirth.lastOpen.name === 'forge-scene-2'", "re-imported as a second project");
    assert(shapeOf(await blocks()) === before, "round trip keeps every block, type and emphasis");
    // Not an FDX: refused with a message, nothing opened.
    const bad = join(dataDir, "not a script.fdx");
    writeFileSync(bad, "<html><body>hello</body></html>");
    assert(!(await app.evaluate(`__cirth.importFdx(${JSON.stringify(bad)})`)), "refused");
    assert(/not an \.fdx script/.test(await app.evaluate("document.getElementById('banner').textContent")), "says why");
  });

  await test("Scene numbers: none until locked; lock numbers 1..N; a new scene gets 1A; omit and restore; numbers in text and Fountain exports; unlock asks first", async () => {
    await openFixture("page-boundaries");
    const navNums = () => app.evaluate("[...document.querySelectorAll('#navigator .nav-go .num')].map(n => n.textContent)");
    const marginNums = () => app.evaluate("document.querySelectorAll('.ProseMirror .scene-num').length");
    assert((await navNums()).length === 0 && (await marginNums()) === 0, "no numbers while unlocked");
    const scenes0 = await app.evaluate("__cirth.scenes().length");
    await app.evaluate("__cirth.menu('scenes_lock')");
    await waitFor(app, `document.querySelectorAll('#navigator .nav-go .num').length === ${scenes0}`, "numbers in the scene list after locking");
    assert(JSON.stringify(await navNums()) === JSON.stringify(Array.from({ length: scenes0 }, (_, i) => String(i + 1))), `1..N: ${await navNums()}`);
    assert((await marginNums()) === scenes0 * 2, "a number in both margins of each heading");
    await waitAnnounced("Scene numbers locked", "announced");
    // Add a scene after scene 1: it becomes 1A, and scene 2 keeps 2.
    const b0 = await blocks();
    const second = b0.findIndex((b, i) => i > 0 && b.kind === "heading");
    await caretAtEndOf(second - 1);
    await press("Enter");
    await press("1", [MOD_KEY]);
    await typeText("INT. NEW ROOM - DAY");
    await waitSynced();
    await app.evaluate("__cirth.repaginate ? __cirth.repaginate() : null");
    await waitFor(app, `JSON.stringify([...document.querySelectorAll('#navigator .nav-go .num')].map(n => n.textContent).slice(0, 3)) === '["1","1A","2"]'`, "new scene numbered 1A, the rest unchanged");
    await screenshot(app, "scene-numbers");
    // Text export: numbers on both sides of the heading line.
    const out = join(dataDir, "numbered.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "exported");
    assert(/^\s*1A\s+INT\. NEW ROOM - DAY\s+1A$/m.test(readFileSync(out, "utf8")), "1A on both sides in the text export");
    // Omit scene 2: OMITTED in the list and the export; its text is kept in the script.
    const sceneTwo = (await blocks()).findIndex((b) => b.kind === "heading" && text(b) === text(b0[second]));
    const hiddenText = text((await blocks())[sceneTwo + 1]);
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out.replace(".txt", "-before.txt"))})`), "exported before omitting");
    await caretAtEndOf(sceneTwo);
    await app.evaluate("__cirth.menu('scene_omit')");
    await waitFor(app, "[...document.querySelectorAll('#navigator .nav-go')].some(b => /^\\s*2\\s+OMITTED$/.test(b.textContent))", "scene 2 shown as OMITTED");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "exported again");
    const omittedTxt = readFileSync(out, "utf8");
    const omittedLine = omittedTxt.split("\n").find((l) => l.includes("OMITTED"));
    assert(/^\s*2\s+OMITTED\s+2$/.test(omittedLine ?? ""), `printed as OMITTED with its number: ${JSON.stringify(omittedLine)}`);
    // The scene's own first line of text is not printed (it may repeat elsewhere, so compare counts).
    const count = (t) => t.split(hiddenText.slice(0, 40)).length - 1;
    assert(count(omittedTxt) < count(readFileSync(out.replace(".txt", "-before.txt"), "utf8")), "body left out of the pages");
    assert(text((await blocks())[sceneTwo + 1]) === hiddenText, "the scene's text is still in the script");
    await app.evaluate("__cirth.menu('scene_restore')");
    await waitFor(app, "![...document.querySelectorAll('#navigator .nav-go')].some(b => b.textContent.includes('OMITTED'))", "restored");
    // Kept after reopening; Fountain carries the numbers.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `document.querySelectorAll('#navigator .nav-go .num').length === ${scenes0 + 1}`, "numbers kept after reopening");
    const fountain = join(dataDir, "numbered.fountain");
    assert(await app.evaluate(`__cirth.exportFountain(${JSON.stringify(fountain)})`), "Fountain exported");
    assert(readFileSync(fountain, "utf8").includes("INT. NEW ROOM - DAY #1A#"), "Fountain has #1A#");
    // Unlock asks first; Cancel keeps them, Unlock removes them.
    await app.evaluate("(__cirth.menu('scenes_unlock'), true)"); // not awaited in the page: WebDriver runs one script at a time
    await waitFor(app, "document.getElementById('confirm-dialog')?.open === true", "unlock asks for confirmation");
    await app.evaluate("(() => { document.getElementById('confirm-cancel').click(); return true; })()");
    await sleep(300);
    assert((await navNums()).length === scenes0 + 1, "Cancel keeps the numbers");
    await app.evaluate("(__cirth.menu('scenes_unlock'), true)"); // not awaited in the page: WebDriver runs one script at a time
    await waitFor(app, "document.getElementById('confirm-dialog')?.open === true", "asked again");
    await app.evaluate("(() => { document.getElementById('confirm-ok').click(); return true; })()");
    await waitFor(app, "document.querySelectorAll('#navigator .nav-go .num').length === 0 && document.querySelectorAll('.ProseMirror .scene-num').length === 0", "numbers removed after unlocking");
  });

  await test("Revision sets: revision mode marks changed text (undo removes it); changed pages print alone with label, date and marks; sets kept; a new set takes over; clearing marks asks first", async () => {
    await openFixture("page-boundaries");
    const rev = (expr) => app.evaluate(`(() => { const r = __cirth.revisions.state; return ${expr}; })()`);
    const revSpans = (set) => app.evaluate(`[...document.querySelectorAll('.ProseMirror .rev${set ? `[data-rev="${set}"]` : ""}')].map(e => e.textContent).join('|')`);
    await app.evaluate("__cirth.menu('revision_sets')");
    await waitFor(app, "document.getElementById('revisions-dialog')?.open === true", "Revision Sets dialog open");
    await audit("revision sets dialog");
    await app.evaluate("(() => { document.getElementById('rev-add').click(); return true; })()");
    await waitFor(app, "__cirth.revisions.state.sets.length === 1 && __cirth.revisions.state.active === __cirth.revisions.state.sets[0].id", "first set added and active");
    assert((await rev("r.sets[0].label + '/' + r.sets[0].colour")) === "Blue Revision/blue", "the first set is Blue");
    const blue = await rev("r.active");
    await app.evaluate("(() => { document.getElementById('rev-close').click(); return true; })()");
    // Nothing changed yet: no changed pages to print.
    const changed = join(dataDir, "changed.txt");
    assert(!(await app.evaluate(`__cirth.exportText(${JSON.stringify(changed)}, true)`)), "changed pages refused without changes");
    assert(/No page has changes in Blue Revision/.test(await app.evaluate("document.getElementById('banner').textContent")), "says why");
    // Revision mode on: typed text is marked, and undo takes the mark with the text.
    await app.evaluate("__cirth.menu('revision_mode')");
    await waitFor(app, "__cirth.revisions.state.mode === true", "revision mode on");
    assert(/Revising: Blue Revision/.test(await app.evaluate("document.getElementById('revision-status').textContent")), "status bar names the set (not colour alone)");
    const b0 = await blocks();
    const dlg = b0.findIndex((b, i) => b.kind === "dialogue" && i > 3);
    await caretAtEndOf(dlg);
    await typeText(" Count it again.");
    await waitSynced();
    assert((await revSpans(blue)).includes("Count it again."), `typed text marked: ${await revSpans(blue)}`);
    assert(await app.evaluate(`document.querySelectorAll('.ProseMirror p.revised[data-rev-mark="*"]').length === 1`), "the block shows the mark in the margin");
    assert((await blocks())[dlg].runs.some((r) => r.revision === blue && r.text.includes("again")), "the run carries the set id");
    for (let i = 0; i < 20 && (await revSpans()); i++) await press("z", [MOD_KEY]);
    await waitSynced();
    assert(!(await revSpans()) && text((await blocks())[dlg]) === text(b0[dlg]), "undo removes the text and its mark");
    // A deletion marks where it happened.
    await caretAtEndOf(dlg);
    await press("Backspace");
    await typeText(" Count it again.");
    await waitSynced();
    assert((await revSpans(blue)).length > 0, "deletion and typing marked");
    // Text export: the changed page alone, with the set's header and line marks.
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(changed)}, true)`), "changed pages exported");
    const ch = readFileSync(changed, "utf8");
    const today = await rev("r.sets[0].date");
    assert(ch.split("\f").length === 1, `one changed page: ${ch.split("\f").length}`);
    assert(new RegExp(`Blue Revision \\(${today}\\)`).test(ch), `revision header: ${ch.slice(0, 200)}`);
    assert(ch.split("\n").some((l) => l.includes("again") && / \*$/.test(l)), `a mark beside the changed line: ${ch}`);
    const full = join(dataDir, "full.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(full)})`), "full export");
    const fullTxt = readFileSync(full, "utf8");
    assert((fullTxt.match(/\*$/gm) ?? []).length === (ch.match(/\*$/gm) ?? []).length, "the full script carries the same marks");
    // Revision mode off: typing is not marked.
    await app.evaluate("__cirth.menu('revision_mode')");
    await waitFor(app, "__cirth.revisions.state.mode === false", "revision mode off");
    await caretAtEndOf(1);
    await typeText(" Plain words.");
    await waitSynced();
    assert(!(await revSpans()).includes("Plain words."), "unmarked outside revision mode");
    // Kept in the project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `__cirth.revisions.state.active === ${JSON.stringify(blue)}`, "set kept after reopening");
    assert((await revSpans(blue)).includes("again."), "marks kept after reopening");
    // A second set takes over: Blue's marks no longer print.
    await app.evaluate("__cirth.menu('revision_sets')");
    await waitFor(app, "document.getElementById('revisions-dialog')?.open === true", "dialog again");
    await app.evaluate("(() => { document.getElementById('rev-add').click(); return true; })()");
    await waitFor(app, "__cirth.revisions.state.sets.length === 2 && __cirth.revisions.state.sets[1].label === 'Pink Revision' && __cirth.revisions.state.active === __cirth.revisions.state.sets[1].id", "Pink added and active");
    assert(!(await app.evaluate(`__cirth.exportText(${JSON.stringify(changed)}, true)`)), "no Pink changes yet");
    assert(await app.evaluate(`document.querySelector('#revisions-dialog tr[data-id="${blue}"] .rev-delete').disabled`), "a set that marks text cannot be deleted");
    // Back to Blue, clear its marks (asks first), then it can be deleted.
    await app.evaluate(`(() => { const r = document.querySelector('#revisions-dialog tr[data-id="${blue}"] input[type=radio]'); r.click(); return true; })()`);
    await waitFor(app, `__cirth.revisions.state.active === ${JSON.stringify(blue)}`, "Blue active again");
    await app.evaluate("(() => { document.getElementById('rev-close').click(); return true; })()");
    await app.evaluate("(__cirth.menu('revision_clear'), true)"); // not awaited in the page: WebDriver runs one script at a time
    await waitFor(app, "document.getElementById('confirm-dialog')?.open === true", "clearing asks first");
    await app.evaluate("(() => { document.getElementById('confirm-ok').click(); return true; })()");
    await waitFor(app, `!document.querySelector('.ProseMirror .rev[data-rev="${blue}"]')`, "Blue marks cleared");
    await waitSynced();
    await app.evaluate("__cirth.menu('revision_sets')");
    await waitFor(app, `document.getElementById('revisions-dialog')?.open === true && !document.querySelector('#revisions-dialog tr[data-id="${blue}"] .rev-delete').disabled`, "deletable once unused");
    await app.evaluate("(() => { document.getElementById('rev-close').click(); return true; })()");
  });

  await test("Locked pages: lock the pages; added text goes onto A pages and later pages keep their numbers; kept after reopening; page size fixed; unlock asks first", async () => {
    await openFixture("page-boundaries");
    const pag = () => app.evaluate("window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => ({ locked: p.pages_locked, labels: p.map.pages.map(pg => pg.label), starts: p.map.page_starts }))");
    const before = await pag();
    assert(!before.locked && before.labels.join() === before.labels.map((_, i) => i + 1).join(), `unlocked pages are 1..N: ${before.labels}`);
    await app.evaluate("__cirth.menu('pages_lock')");
    await waitAnnounced("Pages locked", "lock announced");
    assert((await pag()).locked, "locked");
    assert(/pages locked/.test(await app.evaluate("document.getElementById('info').textContent")), "the status bar says so");
    // Add text on the first page after page 1 that has an action block starting on it.
    const b = await blocks();
    const startOf = (k) => b.findIndex((x) => x.id === before.starts[k].block_id);
    let k = 1;
    let action = -1;
    for (; k < before.starts.length - 1 && action < 0; k++) action = b.findIndex((x, i) => i > startOf(k) && i < startOf(k + 1) && x.kind === "action");
    k -= 1;
    assert(action >= 0, "an action block on a page after page 1");
    const [page, next, added] = [String(k + 1), String(k + 2), `${k + 1}A`];
    await caretAtEndOf(action);
    for (let i = 0; i < 30; i++) {
      await press("Enter");
      await typeText(`Added ${i}.`);
    }
    await waitSynced();
    await app.evaluate("__cirth.repaginate ? __cirth.repaginate() : null");
    const after = await pag();
    assert(after.labels.includes(added), `page ${page} runs onto ${added}: ${after.labels}`);
    assert(after.labels[after.labels.length - 1] === before.labels[before.labels.length - 1], `the last page keeps its number: ${after.labels}`);
    const between = after.labels.slice(after.labels.indexOf(page) + 1, after.labels.indexOf(next));
    assert(between.length > 0 && between.every((l) => l.startsWith(page) && /[A-Z]$/.test(l)), `only added pages between ${page} and ${next}: ${after.labels}`);
    assert(after.labels.slice(0, after.labels.indexOf(page) + 1).join() === before.labels.slice(0, k + 1).join(), "earlier pages unchanged");
    // The page markers in the editor show the labels.
    await waitFor(app, `[...document.querySelectorAll('.page-mark')].some(m => m.textContent.trim() === 'page ${added}')`, `editor marker for ${added}`);
    // Text export prints the labels.
    const out = join(dataDir, "locked.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(out)})`), "exported");
    assert(new RegExp(`^ +${added}\\.$`, "m").test(readFileSync(out, "utf8")), `${added}. printed as the page number`);
    // Page size cannot change while locked.
    await app.evaluate("__cirth.menu('page_a4')");
    await waitFor(app, "/unlock pages/.test(document.getElementById('banner').textContent)", "page size change refused");
    assert((await app.evaluate("document.getElementById('profile').value")) === "letter", "still US Letter");
    // Kept after reopening.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => p.pages_locked &&p.map.pages.some(pg => pg.label === '${added}'))`, "lock kept after reopening");
    // Unlock asks first; then pages flow freely again.
    await app.evaluate("(__cirth.menu('pages_unlock'), true)"); // not awaited in the page: WebDriver runs one script at a time
    await waitFor(app, "document.getElementById('confirm-dialog')?.open === true", "unlock asks first");
    await app.evaluate("(() => { document.getElementById('confirm-ok').click(); return true; })()");
    await waitAnnounced("Pages unlocked", "unlock announced");
    const free = await pag();
    assert(!free.locked && free.labels.every((l, i) => l === String(i + 1)), `unlocked: plain numbers again: ${free.labels}`);
  });

  await test("Word, RTF and HTML export: chosen path, title page, element styles, scene numbers and a report of what each format cannot keep", async () => {
    await openFixture("page-boundaries");
    // A title page, locked scene numbers and some emphasis to carry through.
    await app.evaluate("__cirth.menu('title_page')");
    await waitFor(app, "document.getElementById('title-dialog')?.open === true", "title page dialog");
    await app.evaluate("(() => { document.getElementById('tp-title').value = 'THE TIDE LEDGER'; document.getElementById('tp-authors').value = 'A. Writer'; document.getElementById('tp-save').click(); return true; })()");
    await waitFor(app, "!document.getElementById('title-dialog').open", "title page saved");
    await app.evaluate("__cirth.menu('scenes_lock')");
    await waitAnnounced("Scene numbers locked", "numbers locked");
    const heading = text((await blocks()).find((x) => x.kind === "heading")).toUpperCase();
    // Word: a real zip package; read word/document.xml out of it.
    const docxPath = join(dataDir, "export test.docx");
    assert(await app.evaluate(`__cirth.exportDocument('docx', ${JSON.stringify(docxPath)})`), "DOCX exported");
    const zip = readFileSync(docxPath);
    assert(zip.subarray(0, 2).toString() === "PK", "a zip package");
    const part = (name) => {
      for (let at = 0; at + 30 < zip.length; ) {
        if (zip.readUInt32LE(at) !== 0x04034b50) break;
        const [method, size, nameLen, extraLen] = [zip.readUInt16LE(at + 8), zip.readUInt32LE(at + 18), zip.readUInt16LE(at + 26), zip.readUInt16LE(at + 28)];
        const n = zip.subarray(at + 30, at + 30 + nameLen).toString();
        const data = zip.subarray(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
        if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
        at += 30 + nameLen + extraLen + size;
      }
      throw new Error(`${name} not in the package`);
    };
    const doc = part("word/document.xml");
    assert(doc.includes("THE TIDE LEDGER") && doc.includes(heading.replace(/&/g, "&amp;")), "title page and script text");
    assert(doc.includes('<w:pStyle w:val="SceneHeading"/>') && doc.includes('<w:pStyle w:val="Dialogue"/>'), "one style per element");
    assert(/<w:t xml:space="preserve">1<\/w:t>/.test(doc), "scene number 1 written");
    assert(part("word/styles.xml").includes("Courier Prime"), "Courier Prime named");
    assert(/Word document written: .*export test\.docx\..*lays out its own pages/.test(await app.evaluate("document.getElementById('banner').textContent")), "report shown");
    // RTF.
    const rtfPath = join(dataDir, "export test.rtf");
    assert(await app.evaluate(`__cirth.exportDocument('rtf', ${JSON.stringify(rtfPath)})`), "RTF exported");
    const rtf = readFileSync(rtfPath, "latin1");
    assert(rtf.startsWith("{\\rtf1") && rtf.includes("THE TIDE LEDGER") && rtf.includes("Scene Heading;"), "RTF with styles and title page");
    assert(rtf.includes("\\paperw12240\\paperh15840"), "US Letter");
    // HTML.
    const htmlPath = join(dataDir, "export test.html");
    assert(await app.evaluate(`__cirth.exportDocument('html', ${JSON.stringify(htmlPath)})`), "HTML exported");
    const html = readFileSync(htmlPath, "utf8");
    assert(html.startsWith("<!DOCTYPE html>") && html.includes("<title>THE TIDE LEDGER</title>") && html.includes('<p class="scene-heading"><span class="num left">1 </span>'), "HTML with numbered headings");
    assert(!/<script|https?:\/\//.test(html), "nothing to run or fetch");
    // Menus.
    const items = await app.evaluate("window.__TAURI_INTERNALS__.invoke('menu_items')");
    assert(items.some((i) => i.id === "export" && i.path.startsWith("File > Export…")), "File > Export… holds every format (its dialog is tested in Menus)");
  });

  await test("Notes panel: View > Tools > Notes opens a scratchpad kept with the project (through Home and a hard kill); the script is untouched", async () => {
    await openFixture("page-boundaries");
    const before = JSON.stringify(await blocks());
    assert(!(await app.evaluate("document.getElementById('notes').getClientRects().length")), "notes are hidden at first");
    await app.evaluate("__cirth.menu('view_notes')");
    await waitFor(app, "document.getElementById('notes').getClientRects().length > 0 && document.activeElement?.id === 'notes-text'", "View > Tools > Notes shows the panel and focuses it");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('menu_items').then(m => m.find(i => i.id === 'view_notes').checked)", "Notes checked in View > Tools");
    const text = "Call Sam about the lighthouse.\nZoë's line → cut? 🌊";
    await app.evaluate(`(() => { const t = document.getElementById('notes-text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); return true; })()`);
    await waitFor(app, "document.querySelector('.notes-state').textContent === 'Kept'", "written to the working store after a pause");
    assert(JSON.stringify(await blocks()) === before, "the script is unchanged");
    // Moved with the arrow keys on its title bar; it stays inside the script area.
    const left0 = await app.evaluate("document.getElementById('notes').offsetLeft");
    await app.evaluate("(document.querySelector('.notes-grip').focus(), true)");
    await press("ArrowLeft");
    assert((await app.evaluate("document.getElementById('notes').offsetLeft")) < left0, "ArrowLeft on the title bar moves the panel");
    // Home and back: the notes come back with the project.
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `document.getElementById('notes-text').value === ${JSON.stringify(text)}`, "notes kept through Home and reopening");
    // A hard kill right after typing keeps the text too (it is in the working store at once).
    await app.evaluate(`(() => { const t = document.getElementById('notes-text'); t.value += '\\nafter save'; t.dispatchEvent(new Event('input')); return true; })()`);
    await waitFor(app, "document.querySelector('.notes-state').textContent === 'Kept'", "second note kept");
    await app.kill();
    await sleep(1500);
    app = await driver.launch("after-notes-kill");
    await waitHome(app);
    await openFixture("page-boundaries", false);
    await waitFor(app, `document.getElementById('notes-text').value === ${JSON.stringify(text + "\nafter save")}`, "notes survive a hard kill");
    // Another project has its own (empty) notes; hiding the panel keeps the text.
    await openFixture("unicode-marks");
    assert((await app.evaluate("document.getElementById('notes-text').value")) === "", "notes belong to their project");
    await app.evaluate("__cirth.menu('view_notes')");
    await waitFor(app, "!document.getElementById('notes').getClientRects().length", "View > Tools > Notes hides it again");
  });

  await test("Pop-out panels: scene list, board and notes open in their own windows, draw from the main window, send changes back (moves undo in the script), and dock", async () => {
    await openFixture("page-boundaries");
    const labels = () => app.evaluate("window.__TAURI_INTERNALS__.invoke('window_labels')");
    const scenes0 = await app.evaluate("__cirth.scenes().map(s => ({ id: s.sceneId, heading: s.heading }))");
    // Scene list: View > Tools > Scene List in Its Own Window.
    await app.evaluate("(__cirth.menu('popout_nav'), true)");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('window_labels').then(l => l.includes('panel-nav'))", "the scene list window opens");
    await waitFor(app, `__cirth.panels.rendered.nav?.items === ${scenes0.length} && __cirth.panels.rendered.nav.first === ${JSON.stringify(scenes0[0].heading)}`, "the window drew every scene from the main window's snapshot");
    assert(!(await app.evaluate("document.getElementById('navigator').getClientRects().length")), "the main window's scene list makes room");
    // A move sent from the panel window is one script edit: the window redraws, and undo from the window reverts it.
    await app.evaluate(`__cirth.panelCommand({ panel: 'nav', cmd: 'move', sceneId: ${JSON.stringify(scenes0[1].id)}, before: ${JSON.stringify(scenes0[0].id)} })`);
    await waitFor(app, `__cirth.scenes()[0].sceneId === ${JSON.stringify(scenes0[1].id)}`, "the move reached the script");
    await waitFor(app, `__cirth.panels.rendered.nav.first === ${JSON.stringify(scenes0[1].heading)}`, "the window redrew with the new order");
    await app.evaluate("__cirth.panelCommand({ panel: 'nav', cmd: 'undo' })");
    await waitFor(app, `__cirth.scenes()[0].sceneId === ${JSON.stringify(scenes0[0].id)}`, "undo from the window reverts the move in the script");
    assert(await storedMatchesEditor(), "stored order equals the editor");
    // Board: a card edited in its window is stored once, in the main window's list.
    await app.evaluate("(__cirth.menu('popout_board'), true)");
    await waitFor(app, "__cirth.panels.rendered.board !== undefined", "the board window drew");
    const beat = await app.evaluate("JSON.parse(JSON.stringify(__cirth.board.beats[0]))");
    beat.logline = "Edited in its own window";
    await app.evaluate(`__cirth.panelCommand({ panel: 'board', cmd: 'putBeat', beat: ${JSON.stringify(beat)} })`);
    await waitFor(app, "__cirth.board.beats.find(b => b.logline === 'Edited in its own window') && __cirth.panels.rendered.board.first === 'Edited in its own window'", "card edit stored and redrawn");
    assert((await app.evaluate("__cirth.board.beats.length")) === (await app.evaluate("new Set(__cirth.board.beats.map(b => b.id)).size")), "no duplicate card");
    // Closing the board window with its own close button docks the board.
    await app.evaluate("window.__TAURI_INTERNALS__.invoke('close_panel_window', { panel: 'board' })");
    await waitFor(app, "!__cirth.panels.isPopped('board') && document.getElementById('board').getClientRects().length > 0", "closing its window puts the board back");
    // Notes: typed in their window, kept by the main window.
    await app.evaluate("(__cirth.menu('popout_notes'), true)");
    await waitFor(app, "__cirth.panels.rendered.notes !== undefined", "the notes window drew");
    await app.evaluate("__cirth.panelCommand({ panel: 'notes', cmd: 'notes', text: 'From the notes window' })");
    await waitFor(app, "__cirth.notes.value === 'From the notes window' && document.querySelector('.notes-state').textContent === 'Kept'", "notes from their window are kept");
    // Dock from the window's Dock button; going Home closes the rest.
    await app.evaluate("__cirth.panelCommand({ panel: 'nav', cmd: 'dock' })");
    await waitFor(app, "window.__TAURI_INTERNALS__.invoke('window_labels').then(l => !l.includes('panel-nav'))", "Dock closes the scene list window");
    assert(await app.evaluate("document.getElementById('navigator').getClientRects().length > 0"), "the scene list is back in the main window");
    await app.evaluate("__cirth.goHome()");
    await waitHome(app);
    assert(JSON.stringify(await labels()) === JSON.stringify(["main"]), `going Home closes every panel window: ${await labels()}`);
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
    assert(/^Kolbítar \d+\.\d+\.\d+ typing latency/.test(r), `app version shown: ${r.split("\n")[0]}`);
    await app.evaluate("(() => { document.getElementById('latency-reset').click(); return true; })()");
    r = await report();
    assert(r.includes("Key presses measured: 0"), "Start over clears the samples");
    await app.evaluate("(() => { document.getElementById('latency-copy').click(); return true; })()");
    await waitFor(app, "/Copied|Selected/.test(document.querySelector('#latency-dialog .latency-note').textContent)", "copy feedback");
    await app.evaluate("__cirth.latency.close()");
    assert(!(await app.evaluate("document.getElementById('latency-dialog').open")), "closed");
  });

  await test("PDF export: saved where chosen, with title page, headers and footers (from page 2) and the title page's metadata", async () => {
    await openFixture("page-boundaries");
    // Title page and headers/footers through their dialogs.
    await app.evaluate("__cirth.menu('title_page')");
    await waitFor(app, "document.getElementById('title-dialog')?.open === true", "title page dialog");
    await app.evaluate("(() => { document.getElementById('tp-title').value = 'PAGE BOUNDARIES'; document.getElementById('tp-authors').value = 'Jared Hoy'; document.getElementById('tp-draft_label').value = 'Blue Revision'; document.getElementById('tp-save').click(); return true; })()");
    await waitFor(app, "!document.getElementById('title-dialog').open", "title page saved");
    await app.evaluate("__cirth.menu('page_furniture')");
    await waitFor(app, "document.getElementById('furniture-dialog')?.open === true", "headers and footers dialog");
    await audit("headers and footers dialog");
    await app.evaluate("(() => { document.getElementById('pf-header').value = '{title} - {draft}'; document.getElementById('pf-footer').value = 'Confidential'; document.getElementById('pf-save').click(); return true; })()");
    await waitFor(app, "!document.getElementById('furniture-dialog').open", "saved");
    // Text export shows exactly what the PDF prints around the pages.
    const txtPath = join(dataDir, "furniture.txt");
    assert(await app.evaluate(`__cirth.exportText(${JSON.stringify(txtPath)})`), "text exported");
    const pages = readFileSync(txtPath, "utf8").split("\f");
    assert(!pages[1].includes("PAGE BOUNDARIES - Blue Revision") && !pages[1].includes("Confidential"), "nothing on page 1 of the script");
    assert(/^ *PAGE BOUNDARIES - Blue Revision +2\.$/m.test(pages[2]) && /^ +Confidential$/m.test(pages[2]), `header and footer on page 2: ${pages[2].slice(0, 200)}`);
    // PDF: saved at the chosen path, metadata from the title page, title page + script pages.
    const pdfPath = join(dataDir, "chosen name.pdf");
    assert(await app.evaluate(`__cirth.exportPdf(${JSON.stringify(pdfPath)})`), "PDF exported");
    const banner = await app.evaluate("document.getElementById('banner').textContent");
    assert(banner.includes("PDF written") && !/proof/i.test(banner), `banner: ${banner}`);
    const bytes = readFileSync(pdfPath, "latin1");
    const scriptPages = await app.evaluate("window.__TAURI_INTERNALS__.invoke('paginate', { profile: 'letter' }).then(p => p.map.pages.length)");
    assert((bytes.match(/\/Type\s*\/Page(?!s)/g) ?? []).length === scriptPages + 1, "title page plus script pages");
    assert(bytes.includes("(PAGE BOUNDARIES)") && bytes.includes("(Jared Hoy)") && bytes.includes("(Blue Revision)"), "title, author and draft in the PDF's properties");
    return { banner };
  });

  await test("StoryScry (B6, E6–E8): SVG charts and tables from the same report rows; scope and omitted scenes; sort, filter and scene links; flagged out of date on edit until refreshed", async () => {
    await openFixture("page-boundaries");
    const scenes0 = await app.evaluate("__cirth.scenes().map(s => s.sceneId)");
    // Lock scene numbers and omit the second scene so we can test omitted-scene filtering.
    await app.evaluate("window.__TAURI_INTERNALS__.invoke('scene_numbers_command', { action: 'lock', sceneId: null })");
    await app.evaluate(`window.__TAURI_INTERNALS__.invoke('scene_numbers_command', { action: 'omit', sceneId: ${JSON.stringify(scenes0[1])} })`);
    // Merge TOBIAS as an alias of INES in the bible so character reports combine them.
    const pBase = (await app.evaluate("window.__TAURI_INTERNALS__.invoke('planning_state_now')")).version;
    await app.evaluate(`window.__TAURI_INTERNALS__.invoke('planning_command', { op: { PutEntity: { id: 'ent-ines', kind: 'character', name: 'INES', aliases: ['TOBIAS'], description: '', tags: [] } }, base: ${pBase} })`);
    await app.evaluate("__cirth.reloadPlanning()");

    await app.evaluate("(__cirth.menu('storyscry'), true)");
    await waitFor(app, "document.getElementById('storyscry-dialog')?.open === true && !!__cirth.storyScry.data", "StoryScry opens with data");
    await audit("StoryScry dashboard");
    await screenshot(app, "storyscry-dashboard");

    const d0 = await app.evaluate("__cirth.storyScry.data");
    assert(d0.scenes.length === scenes0.length - 1 && d0.omitted_in_scope === 1, `omitted scene excluded by default: ${d0.scenes.length} shown, ${d0.omitted_in_scope} omitted`);
    const stamp0 = await app.evaluate("document.getElementById('storyscry-stamp').textContent");
    assert(stamp0.includes(`v${d0.source_version}`) && /1 omitted scene excluded/.test(stamp0) && /estimate/.test(stamp0), `stamp states scope, version and estimate: ${stamp0}`);
    assert((await app.evaluate("document.querySelectorAll('#storyscry-body .storyscry-card').length")) === 7, "seven report cards on the dashboard");
    assert((await app.evaluate("document.querySelectorAll('#storyscry-body svg.storyscry-svg').length")) >= 6, "SVG charts rendered");
    // Every Nightingale slice has a stroke-dasharray and every legend item has a symbol + text so colour is never the only signal.
    const a11ySignals = await app.evaluate(`(() => {
      const slices = [...document.querySelectorAll('#storyscry-body .chart-slice[stroke-dasharray]')].length;
      const swatches = [...document.querySelectorAll('#storyscry-body .chart-swatch')].map(s => s.textContent.trim()).filter(Boolean).length;
      return { slices, swatches };
    })()`);
    assert(a11ySignals.slices > 0 && a11ySignals.swatches > 0, `non-colour signals present: ${JSON.stringify(a11ySignals)}`);

    // E8: "Show charts as tables" renders tables from the exact same report rows.
    await app.evaluate("(document.getElementById('storyscry-tables-toggle').click(), true)");
    await waitFor(app, "document.querySelectorAll('#storyscry-body table.storyscry-mini-table').length === 7", "seven mini tables shown");
    const miniSceneRows = await app.evaluate("document.querySelectorAll('#storyscry-body [data-report=\"scenes\"] tbody tr').length");
    assert(miniSceneRows === d0.scenes.length, `dashboard table rows (${miniSceneRows}) match report scenes (${d0.scenes.length})`);
    await app.evaluate("(document.getElementById('storyscry-tables-toggle').click(), true)");

    // Include omitted scenes: the omitted scene returns with its measured stats and omitted flag.
    await app.evaluate("(() => { const c = document.getElementById('storyscry-omitted'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `__cirth.storyScry.data.scenes.length === ${scenes0.length} && __cirth.storyScry.data.include_omitted === true`, "omitted scene included");
    assert((await app.evaluate("__cirth.storyScry.data.scenes.some(s => s.omitted && s.eighths >= 1)")), "omitted scene has measured eighths and omitted flag");
    await app.evaluate("(() => { const c = document.getElementById('storyscry-omitted'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, `__cirth.storyScry.data.scenes.length === ${scenes0.length - 1}`, "omitted scene excluded again");

    // Characters report: bible alias TOBIAS is merged under INES; sorting and filtering work.
    await app.evaluate("(document.querySelector('#storyscry-dialog [data-tab=\"characters\"]').click(), true)");
    await waitFor(app, "!!document.getElementById('storyscry-characters-table')", "Characters report table");
    await audit("StoryScry characters report");
    const charNames = await app.evaluate("__cirth.storyScry.data.characters.map(c => c.name)");
    assert(charNames.includes("INES") && !charNames.includes("TOBIAS"), `TOBIAS merged into INES: ${charNames}`);
    await app.evaluate("(() => { const f = document.getElementById('storyscry-filter'); f.value = 'ines'; f.dispatchEvent(new Event('input')); return true; })()");
    assert((await app.evaluate("document.querySelectorAll('#storyscry-characters-table tbody tr').length")) === 1, "filter narrows to INES");
    await app.evaluate("(() => { const f = document.getElementById('storyscry-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return true; })()");
    await app.evaluate("(document.querySelector('#storyscry-characters-table [data-sort=\"name\"]').click(), true)");
    const sortedAsc = await app.evaluate("[...document.querySelectorAll('#storyscry-characters-table tbody tr')].map(r => r.cells[0].textContent)");
    assert(JSON.stringify(sortedAsc) === JSON.stringify([...sortedAsc].sort()), `sorted ascending by name: ${sortedAsc}`);

    // B6: if the script changes while StoryScry is open, the report is flagged out of date with its old version until refreshed.
    const vBefore = await app.evaluate("__cirth.storyScry.data.source_version");
    assert(!(await app.evaluate("__cirth.storyScry.isStale")) && (await app.evaluate("document.getElementById('storyscry-stale').hidden")), "fresh before edit");
    await app.evaluate("(() => { const v = __cirth.view; v.dispatch(v.state.tr.insertText(' REVISED', v.state.doc.content.size - 1)); return true; })()");
    await waitFor(app, "__cirth.storyScry.isStale && !document.getElementById('storyscry-stale').hidden", "B6: flagged out of date at once when script changes");
    const staleMsg = await app.evaluate("document.getElementById('storyscry-stale-text').textContent");
    assert(staleMsg.includes(`v${vBefore}`), `stale banner names the report's source version: ${staleMsg}`);
    await app.evaluate("__cirth.flush()");
    await waitSynced();
    await app.evaluate("(document.getElementById('storyscry-refresh').click(), true)");
    await waitFor(app, `!__cirth.storyScry.isStale && document.getElementById('storyscry-stale').hidden && __cirth.storyScry.data.source_version > ${vBefore}`, "Refresh updates the report to the new version");

    // Whole project and Selected scripts scopes with a second episode.
    const ep2 = await app.evaluate("window.__TAURI_INTERNALS__.invoke('create_episode', { title: 'Episode 2', folder: null })");
    await app.evaluate("(() => { const s = document.getElementById('storyscry-scope'); s.value = 'project'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "__cirth.storyScry.data.documents.length === 2", "whole project has 2 scripts");
    await app.evaluate("(() => { const s = document.getElementById('storyscry-scope'); s.value = 'episodes'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "!document.getElementById('storyscry-episodes').hidden && document.querySelectorAll('#storyscry-episodes input[type=checkbox]').length === 2", "episode picker shown");
    await app.evaluate(`(() => { const cb = [...document.querySelectorAll('#storyscry-episodes input[type=checkbox]')].find(c => c.value === ${JSON.stringify(ep2)}); cb.checked = false; cb.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(app, "__cirth.storyScry.data.documents.length === 1", "episode unchecked");
    await app.evaluate("(() => { const s = document.getElementById('storyscry-scope'); s.value = 'document'; s.dispatchEvent(new Event('change')); return true; })()");
    await waitFor(app, "__cirth.storyScry.data.scope.mode === 'document'", "back to This script");

    // Scenes report: clicking a scene jumps to it and closes StoryScry.
    await app.evaluate("(document.querySelector('#storyscry-dialog [data-tab=\"scenes\"]').click(), true)");
    await waitFor(app, "!!document.getElementById('storyscry-scenes-table')", "Scenes report table");
    const targetSceneId = await app.evaluate("__cirth.storyScry.data.scenes.at(-1).scene_id");
    await app.evaluate("(document.querySelectorAll('#storyscry-scenes-table .storyscry-go')[document.querySelectorAll('#storyscry-scenes-table .storyscry-go').length - 1].click(), true)");
    await waitFor(app, `!document.getElementById('storyscry-dialog').open && (() => { const at = __cirth.view.state.selection.from; const s = __cirth.scenes().find(x => at >= x.from && at < x.to); return s?.sceneId === ${JSON.stringify(targetSceneId)}; })()`, "clicking a scene row jumps to that scene");
  });

  await test("Report exports (E1, E8, E9): each report and all reports in CSV, TSV, XLSX, HTML, PDF and RTF; scope, version stamp, stable IDs and formula safety", async () => {
    await openFixture("page-boundaries");
    // Put a formula-like logline on the first scene's beat card to verify CSV/TSV/XLSX formula-injection protection.
    const firstBeat = await app.evaluate("__cirth.board.beats.find(b => b.kind === 'beat' && b.scene_id)");
    await app.evaluate(`__cirth.putBeat({ ...${JSON.stringify(firstBeat)}, logline: '=1+1 dangerous, "quoted" logline' })`);

    // File > Export… > Reports (StoryScry)… opens StoryScry.
    await app.evaluate("(__cirth.menu('export'), true)");
    await waitFor(app, "document.getElementById('export-dialog')?.open === true", "Export dialog opens");
    await app.evaluate("(() => { document.getElementById('export-reports').checked = true; document.getElementById('export-go').click(); return true; })()");
    await waitFor(app, "!document.getElementById('export-dialog').open && document.getElementById('storyscry-dialog')?.open === true && !!__cirth.storyScry.data", "StoryScry opened from File > Export…");

    // Switching tabs updates the report export selector automatically.
    assert((await app.evaluate("document.getElementById('storyscry-export-report').value")) === "all", "Dashboard defaults export selector to all");
    await app.evaluate("(document.querySelector('#storyscry-dialog [data-tab=\"scenes\"]').click(), true)");
    assert((await app.evaluate("document.getElementById('storyscry-export-report').value")) === "scenes", "Scenes tab selects scenes report for export");

    // 1. CSV (Scenes report): UTF-8, quoted, formula-safe, scope + version stamp, human number + stable scene_id.
    const csvPath = join(dataDir, "report-scenes.csv");
    const rCsv = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(csvPath)}, 'scenes', 'csv')`);
    assert(rCsv && rCsv.report === "scenes" && rCsv.format === "csv", `CSV export result: ${JSON.stringify(rCsv)}`);
    const statusText = await app.evaluate("document.getElementById('storyscry-export-status').textContent");
    assert(statusText.includes("Scenes Report (CSV) written") && statusText.includes(`v${rCsv.source_version}`), `export status in dialog: ${statusText}`);
    const csv = readFileSync(csvPath, "utf8");
    assert(csv.includes("Report,Scenes Report") && csv.includes(`Source Script Version,${rCsv.source_version}`), "CSV header stamps report title and source version");
    assert(csv.includes("Methodology,Page and eighth lengths are estimates from the layout engine (1 page = 8 eighths)."), "CSV states estimate note");
    assert(csv.includes("Scene Number,Omitted,INT/EXT,Location,Time of Day,Heading,Page") && csv.includes("Document ID,Scene ID"), "CSV includes both human Scene Number and stable Scene ID / Document ID");
    assert(csv.includes(`"'=1+1 dangerous, ""quoted"" logline"`), `CSV neutralizes formula and escapes quotes: ${csv}`);
    assert(csv.includes(firstBeat.scene_id), "CSV carries the canonical scene_id");

    // 2. TSV (Characters report): tab-delimited, stable IDs and numbers.
    const tsvPath = join(dataDir, "report-characters.tsv");
    const rTsv = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(tsvPath)}, 'characters', 'tsv')`);
    assert(rTsv && rTsv.report === "characters" && rTsv.format === "tsv", "TSV exported");
    const tsv = readFileSync(tsvPath, "utf8");
    assert(tsv.includes("Report\tCharacters Report") && tsv.includes("Character\tSpeeches\tDual Speeches\tDialogue Words"), "TSV headers present");
    assert(tsv.includes("First Appearance Scene\tFirst Appearance Page\tFirst Document Title\tFirst Document ID\tFirst Scene ID"), "TSV has both human scene number and stable scene ID");

    // 3. XLSX (All 7 reports): valid OpenXML ZIP with 7 worksheets.
    const xlsxPath = join(dataDir, "report-all.xlsx");
    const rXlsx = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(xlsxPath)}, 'all', 'xlsx')`);
    assert(rXlsx && rXlsx.report === "all" && rXlsx.format === "xlsx" && rXlsx.bytes > 1000, "XLSX exported");
    const xlsxRaw = readFileSync(xlsxPath, "latin1");
    assert(xlsxRaw.startsWith("PK\x03\x04"), "XLSX is a ZIP package");
    for (let i = 1; i <= 7; i++) {
      assert(xlsxRaw.includes(`xl/worksheets/sheet${i}.xml`), `XLSX contains worksheet ${i}`);
    }

    // 4. HTML (Locations report), RTF (Action vs Dialogue report), and PDF (All reports).
    const htmlPath = join(dataDir, "report-locations.html");
    const rHtml = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(htmlPath)}, 'locations', 'html')`);
    assert(rHtml && rHtml.format === "html", "HTML report exported");
    const html = readFileSync(htmlPath, "utf8");
    assert(html.startsWith("<!DOCTYPE html>") && html.includes("Locations Report") && html.includes(`v${rHtml.source_version}`) && html.includes("estimates"), "HTML has doctype, title, version and estimate note");

    const rtfPath = join(dataDir, "report-ad.rtf");
    const rRtf = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(rtfPath)}, 'action_dialogue', 'rtf')`);
    assert(rRtf && rRtf.format === "rtf", "RTF report exported");
    const rtf = readFileSync(rtfPath, "utf8");
    assert(rtf.startsWith("{\\rtf1\\ansi") && rtf.includes("Action vs Dialogue Report") && rtf.includes("\\trowd"), "RTF has header, title and table rows");

    const pdfPath = join(dataDir, "report-all.pdf");
    const rPdf = await app.evaluate(`__cirth.storyScry.export(${JSON.stringify(pdfPath)}, 'all', 'pdf')`);
    assert(rPdf && rPdf.format === "pdf", "PDF report exported");
    const pdf = readFileSync(pdfPath, "latin1");
    assert(pdf.startsWith("%PDF-") && (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length >= 1 && pdf.includes("All Reports"), "PDF report rendered with pages and heading");

    await app.evaluate("(document.getElementById('storyscry-close').click(), true)");
    await waitFor(app, "!document.getElementById('storyscry-dialog').open", "StoryScry closed");
  });

  await app.close();
}
