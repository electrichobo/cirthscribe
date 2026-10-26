const log = [];
const state = async (label) => log.push(label + " => " + (await evaluate(`(() => { const v = __cirth.view; const s = v.state.selection; const p = s.$from.parent; return p.attrs.kind + ' [' + p.textContent + '] off=' + s.$from.parentOffset; })()`)).result.value);
const key = async (k, extra = {}) => { await send("Input.dispatchKeyEvent", { type: extra.text ? "keyDown" : "rawKeyDown", ...k, ...extra }); await send("Input.dispatchKeyEvent", { type: "keyUp", ...k }); };
const type = async (s) => { for (const ch of s) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); } };
await evaluate(`(() => { const v = __cirth.view; let pos = 0; v.state.doc.forEach((n, p) => { pos = p + n.nodeSize - 1; }); v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos)))); v.focus(); })()`);
const ENTER = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
const TAB = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
await key(ENTER, { text: "\r" }); await state("enter");
await key(TAB); await state("tab");
await type("Noor"); await state("type");
await key(ENTER, { text: "\r" }); await state("enter");
await key(TAB); await state("tab");
await type("softly"); await state("type softly");
await key({ key: "End", code: "End", windowsVirtualKeyCode: 35 }, { commands: ["moveToEndOfLine"] }); await state("end"); log.push("dom: " + (await evaluate("(() => { const s = getSelection(); return s.anchorNode && (s.anchorNode.nodeName + \u0027:\u0027 + JSON.stringify(s.anchorNode.textContent) + \u0027@\u0027 + s.anchorOffset + \u0027 active=\u0027 + document.activeElement.className); })()")).result.value); await key({ key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }); await state("arrowright"); await evaluate("__cirth.view.focus()"); await key({ key: "End", code: "End", windowsVirtualKeyCode: 35 }); await state("end-after-focus");
await key(ENTER, { text: "\r" }); await state("enter");
return log;


