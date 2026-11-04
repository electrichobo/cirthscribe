// Tools > Cork Board… (M3 step 9, ACCEPTANCE C4; a free canvas in 0.8.2):
// cards placed anywhere and joined by labelled strings. A card is a note, a
// picture, a video link, or a view of a scene, beat, bible entry or timeline
// event (by its stable id: the card shows its current title and holds no
// copy). Moving a card never moves anything in the script.
//
// Pictures are packaged in the project file; video links are stored as text
// and open in the browser only when the writer asks. Nothing is fetched.
//
// Mouse: drag a card to move it; drag from its pin onto another card to tie
// a string (or use the String tool and drag from anywhere on a card); click a
// string to name or cut it; double-click the board for a note there; drag
// the empty board to pan; Ctrl+wheel or the zoom buttons to zoom.
// Keyboard: Tab reaches each card; Alt+arrows move the focused card (Shift
// for bigger steps); Enter edits it on the right; Delete removes it.
// "Show as list" gives the cards and strings as text.
// Every change is a planning step; "Undo" takes back the board's last change.

import { announce } from "./a11y";

export interface Card {
  id: string;
  kind: "note" | "scene" | "beat" | "entity" | "event" | "image" | "video";
  ref_id: string | null;
  title: string;
  body: string;
  url: string;
  asset: string | null;
  x: number;
  y: number;
}
export interface Thread {
  id: string;
  from: string;
  to: string;
  label: string;
}
interface BoardState {
  cards: Card[];
  threads: Thread[];
  titles: Record<string, string>;
  places: Record<string, { document_id: string; document_title: string; heading: string }>;
}
export type EvidenceOp = { PutCard: Card } | { DeleteCard: string } | { PutThread: Thread } | { DeleteThread: string };
type Source = { id: string; title: string };

const KIND = { note: "Note", scene: "Scene", beat: "Beat", entity: "Bible", event: "Event", image: "Picture", video: "Video link" } as const;
const W = 200;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const NS = "http://www.w3.org/2000/svg";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};
/** Keep the pointer while dragging (a pointer the system does not know, as in tests, simply is not captured). */
const capture = (target: Element, e: PointerEvent) => {
  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    // not a live pointer
  }
};
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function createEvidenceBoard(hooks: {
  state: () => Promise<BoardState>;
  apply: (op: EvidenceOp) => Promise<boolean>;
  undo: () => Promise<boolean>;
  sources: () => Promise<{ scene: Source[]; beat: Source[]; entity: Source[]; event: Source[] }>;
  pickPicture: () => Promise<{ id: string; name: string; large: boolean } | null>;
  pictureData: (id: string) => Promise<string>;
  openLink: (url: string) => Promise<void>;
  go: (documentId: string, sceneId: string) => void;
  newId: () => string;
}) {
  const dialog = el("dialog", { id: "evidence-dialog", className: "about evidence" });
  dialog.setAttribute("aria-labelledby", "evidence-title");
  const status = el("p", { id: "evidence-status", className: "form-note" });
  status.setAttribute("role", "status");
  const tools = el("div", { className: "evidence-tools" });
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Cork board tools");
  const canvas = el("div", { className: "evidence-canvas", id: "evidence-canvas" });
  canvas.setAttribute("role", "group");
  canvas.setAttribute("aria-label", "Cork board: Tab reaches each card, Alt+arrows move it, Enter edits it, Delete removes it");
  const svg = svgEl("svg", { class: "evidence-strings", "aria-hidden": "true" }) as SVGSVGElement;
  const sizer = el("div", { className: "evidence-sizer" }, canvas);
  const scroller = el("div", { className: "evidence-scroll" }, sizer);
  const listView = el("div", { className: "evidence-listview", id: "evidence-listview", hidden: true });
  const detail = el("div", { className: "evidence-detail", id: "evidence-detail" });
  const undoBtn = el("button", { type: "button", id: "evidence-undo", disabled: true }, "Undo");
  const asList = el("button", { type: "button", id: "evidence-list-toggle" }, "Show as list");
  asList.setAttribute("aria-pressed", "false");
  const close = el("button", { type: "button", id: "evidence-close" }, "Close");
  const hint = el("p", { className: "form-note evidence-hint" }, "Drag a card to move it. Drag from its pin to another card to tie a string. Double-click the board to add a note.");
  dialog.append(
    el("h2", { id: "evidence-title" }, "Cork Board"),
    el("div", { className: "evidence-bar" }, tools, status),
    el("div", { className: "evidence-cols" }, el("div", { className: "evidence-main" }, scroller, listView, hint), detail),
    el("div", { className: "dialog-actions" }, asList, undoBtn, close),
  );
  document.body.append(dialog);

  let st: BoardState = { cards: [], threads: [], titles: {}, places: {} };
  let chosen: string | null = null;
  let chosenThread: string | null = null;
  let steps = 0;
  let busy = false;
  let mode: "select" | "string" = "select";
  let zoom = 1;
  try {
    const z = Number(localStorage.getItem("cirth.corkZoom"));
    if (ZOOMS.includes(z)) zoom = z;
  } catch {
    // no stored zoom
  }
  const pictures = new Map<string, string>();
  let els = new Map<string, HTMLElement>();

  const say = (t: string) => {
    status.textContent = t;
    announce(t);
  };
  const titleOf = (c: Card) => (c.ref_id ? (st.titles[c.ref_id] ?? "(no longer exists)") : c.title || KIND[c.kind]);
  const cardById = (id: string) => st.cards.find((c) => c.id === id);
  const threadsOf = (id: string) => st.threads.filter((t) => t.from === id || t.to === id);

  async function change(op: EvidenceOp, done: string, focus?: string) {
    if (busy) return false;
    busy = true;
    try {
      if (!(await hooks.apply(op))) return false;
      steps++;
      undoBtn.disabled = false;
      say(done);
      await reload(focus);
      return true;
    } catch (e) {
      say(`Not changed: ${e}`);
      return false;
    } finally {
      busy = false;
    }
  }

  async function reload(focus?: string) {
    st = await hooks.state();
    if (!st.cards.some((c) => c.id === chosen)) chosen = null;
    if (!st.threads.some((t) => t.id === chosenThread)) chosenThread = null;
    for (const c of st.cards) if (c.asset && !pictures.has(c.asset)) pictures.set(c.asset, await hooks.pictureData(c.asset));
    draw(focus);
  }

  /** A board point from a pointer position (the canvas is scaled from its top left). */
  function toBoard(e: { clientX: number; clientY: number }) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }

  /** A free spot for a new card: the nearest gap to the middle of what is in view, with room for strings between cards. */
  function spot() {
    const cx = Math.max(0, (scroller.scrollLeft + scroller.clientWidth / 2) / zoom - W / 2);
    const cy = Math.max(0, (scroller.scrollTop + scroller.clientHeight / 2) / zoom - 60);
    const boxes = st.cards.map((c) => {
      const e = els.get(c.id);
      return { x: c.x, y: c.y, w: e?.offsetWidth ?? W, h: e?.offsetHeight ?? 120 };
    });
    const free = (x: number, y: number) => boxes.every((b) => x + W + 40 <= b.x || b.x + b.w + 40 <= x || y + 120 + 30 <= b.y || b.y + b.h + 30 <= y);
    const tries: { x: number; y: number; d: number }[] = [];
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++) {
        const x = Math.round(cx + i * (W + 60));
        const y = Math.round(cy + j * 170);
        if (x >= 0 && y >= 0) tries.push({ x, y, d: Math.hypot(i * 1.2, j) });
      }
    tries.sort((a, b) => a.d - b.d);
    const at = tries.find((t) => free(t.x, t.y));
    return at ? { x: at.x, y: at.y } : { x: Math.round(cx + (st.cards.length % 6) * 28), y: Math.round(cy + (st.cards.length % 6) * 28) };
  }
  async function add(card: Omit<Card, "id" | "x" | "y">, done: string, at?: { x: number; y: number }) {
    const c: Card = { ...card, id: hooks.newId(), ...(at ?? spot()) };
    chosen = c.id;
    chosenThread = null;
    await change({ PutCard: c }, done, c.id);
  }

  function setMode(m: typeof mode) {
    mode = m;
    canvas.dataset.mode = m;
    for (const b of tools.querySelectorAll<HTMLButtonElement>("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    say(m === "string" ? "String tool: drag from one card to another" : "Select tool: drag cards to move them");
  }

  function setZoom(z: number, about?: { clientX: number; clientY: number }) {
    z = Math.min(2, Math.max(0.25, z));
    const r = scroller.getBoundingClientRect();
    const px = about ? about.clientX - r.left : scroller.clientWidth / 2;
    const py = about ? about.clientY - r.top : scroller.clientHeight / 2;
    const bx = (scroller.scrollLeft + px) / zoom;
    const by = (scroller.scrollTop + py) / zoom;
    zoom = z;
    try {
      localStorage.setItem("cirth.corkZoom", String(z));
    } catch {
      // not kept
    }
    layout();
    scroller.scrollLeft = bx * zoom - px;
    scroller.scrollTop = by * zoom - py;
  }
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))]);
  };
  function fit() {
    if (!st.cards.length) return setZoom(1);
    const minX = Math.min(...st.cards.map((c) => c.x));
    const minY = Math.min(...st.cards.map((c) => c.y));
    const maxX = Math.max(...[...els.values()].map((e) => e.offsetLeft + e.offsetWidth));
    const maxY = Math.max(...[...els.values()].map((e) => e.offsetTop + e.offsetHeight));
    const z = Math.min(1.5, Math.max(0.25, Math.min(scroller.clientWidth / (maxX - minX + 80), scroller.clientHeight / (maxY - minY + 80))));
    zoom = z;
    layout();
    scroller.scrollLeft = (minX - 40) * zoom;
    scroller.scrollTop = (minY - 40) * zoom;
  }

  const zoomLabel = el("span", { className: "evidence-zoom", id: "evidence-zoom" });
  async function buildTools() {
    const src = await hooks.sources();
    tools.replaceChildren();
    const modeBtn = (m: typeof mode, label: string, title: string) => {
      const b = el("button", { type: "button", id: `evidence-tool-${m}`, title }, label);
      b.dataset.mode = m;
      b.setAttribute("aria-pressed", String(mode === m));
      b.addEventListener("click", () => setMode(m));
      return b;
    };
    tools.append(
      el("span", { className: "evidence-group" }, modeBtn("select", "Select", "Move cards and pan the board"), modeBtn("string", "String", "Drag from one card to another to tie a string")),
    );
    const note = el("button", { type: "button", id: "evidence-add-note" }, "Note");
    note.addEventListener("click", () => void add({ kind: "note", ref_id: null, title: "New note", body: "", url: "", asset: null }, "Note added"));
    const adds = el("span", { className: "evidence-group" }, el("span", { className: "form-note" }, "Add:"), note);
    for (const k of ["scene", "beat", "entity", "event"] as const) {
      const sel = el("select", { id: `evidence-add-${k}` });
      sel.setAttribute("aria-label", `Add a card for a ${k === "entity" ? "bible entry" : k}`);
      sel.append(new Option(`${KIND[k]}…`, ""), ...src[k].map((s) => new Option(s.title || "(untitled)", s.id)));
      sel.disabled = !src[k].length;
      sel.addEventListener("change", () => {
        const id = sel.value;
        sel.value = "";
        if (id) void add({ kind: k, ref_id: id, title: "", body: "", url: "", asset: null }, `${KIND[k]} card added`);
      });
      adds.append(sel);
    }
    const pic = el("button", { type: "button", id: "evidence-add-picture" }, "Picture…");
    pic.addEventListener("click", async () => {
      try {
        const p = await hooks.pickPicture();
        if (!p) return;
        await add({ kind: "image", ref_id: null, title: p.name, body: "", url: "", asset: p.id }, p.large ? "Picture added. It is over 20 MB, so the project file grows by as much." : "Picture added (kept in the project file)");
      } catch (e) {
        say(`Picture not added: ${e}`);
      }
    });
    const vid = el("button", { type: "button", id: "evidence-add-video" }, "Video link");
    vid.addEventListener("click", () => void add({ kind: "video", ref_id: null, title: "Video link", body: "", url: "https://", asset: null }, "Video link added: paste its address on the right"));
    adds.append(pic, vid);
    const out = el("button", { type: "button", id: "evidence-zoom-out", title: "Zoom out" }, "−");
    out.setAttribute("aria-label", "Zoom out");
    out.addEventListener("click", () => stepZoom(-1));
    const inn = el("button", { type: "button", id: "evidence-zoom-in", title: "Zoom in" }, "+");
    inn.setAttribute("aria-label", "Zoom in");
    inn.addEventListener("click", () => stepZoom(1));
    const fitBtn = el("button", { type: "button", id: "evidence-zoom-fit", title: "Show every card" }, "Fit");
    fitBtn.addEventListener("click", fit);
    tools.append(adds, el("span", { className: "evidence-group" }, out, zoomLabel, inn, fitBtn));
  }

  /** Size the board to its cards (with room to grow) at the current zoom. */
  function layout() {
    const w = Math.max(1600, scroller.clientWidth / zoom, ...st.cards.map((c) => c.x + W + 400));
    const h = Math.max(1000, scroller.clientHeight / zoom, ...st.cards.map((c) => c.y + 600));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.transform = `scale(${zoom})`;
    sizer.style.width = `${w * zoom}px`;
    sizer.style.height = `${h * zoom}px`;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  /** Where a card's pin is, in board units. */
  const pinOf = (e: HTMLElement) => ({ x: e.offsetLeft + e.offsetWidth / 2, y: e.offsetTop + 7 });
  /** A string hangs a little between its pins. */
  function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
    const sag = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + sag;
    return { d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`, mid: { x: mx, y: (a.y + b.y) / 2 + sag / 2 } };
  }

  function draw(focus?: string) {
    canvas.replaceChildren(svg);
    canvas.dataset.mode = mode;
    els = new Map();
    for (const c of st.cards) {
      const card = el("div", { className: `evidence-card ${c.kind}`, tabIndex: 0 });
      card.dataset.id = c.id;
      card.style.left = `${c.x}px`;
      card.style.top = `${c.y}px`;
      if (c.id === chosen) card.classList.add("chosen");
      const pin = el("span", { className: "evidence-pin", title: "Drag to another card to tie a string" });
      pin.setAttribute("aria-hidden", "true");
      const head = el("div", { className: "evidence-kind" }, KIND[c.kind]);
      card.append(pin, head, el("div", { className: "evidence-card-title" }, titleOf(c)));
      if (c.kind === "note" && c.body) card.append(el("div", { className: "evidence-body" }, c.body.length > 140 ? `${c.body.slice(0, 140)}…` : c.body));
      if (c.kind === "image" && c.asset && pictures.get(c.asset)) card.append(el("img", { src: pictures.get(c.asset), alt: c.title || "Picture", draggable: false }));
      if (c.kind === "video") card.append(el("div", { className: "evidence-url" }, c.url));
      card.setAttribute("aria-label", `${KIND[c.kind]}: ${titleOf(c)}${threadsOf(c.id).length ? `, ${threadsOf(c.id).length} strings` : ""}`);
      card.addEventListener("focus", () => choose(c.id));
      card.addEventListener("keydown", (e) => {
        if (e.target !== card) return;
        const step = e.shiftKey ? 100 : 20;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (e.altKey && d) {
          e.preventDefault();
          void change({ PutCard: { ...c, x: Math.max(0, c.x + d[0]), y: Math.max(0, c.y + d[1]) } }, "Card moved. The script is unchanged.", c.id);
        } else if (e.key === "Enter") {
          e.preventDefault();
          detail.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
        } else if (e.key === "Delete") {
          e.preventDefault();
          void change({ DeleteCard: c.id }, "Card removed with its strings (Undo brings them back)");
        }
      });
      card.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (e.target === pin || mode === "string") return tieFrom(c, card, e);
        moveCard(c, card, e);
      });
      canvas.append(card);
      els.set(c.id, card);
    }
    if (!st.cards.length) canvas.append(el("p", { className: "form-note evidence-empty" }, "Add notes, pictures, video links, or cards for scenes, beats, bible entries and events; then tie them together with strings."));
    layout();
    drawStrings();
    drawList();
    drawDetail();
    if (focus) els.get(focus)?.focus();
  }

  function choose(id: string) {
    if (chosen === id && !chosenThread) return;
    chosen = id;
    chosenThread = null;
    for (const x of canvas.querySelectorAll(".evidence-card.chosen")) x.classList.remove("chosen");
    els.get(id)?.classList.add("chosen");
    drawStrings();
    drawDetail();
  }
  function chooseThread(id: string) {
    chosenThread = id;
    chosen = null;
    for (const x of canvas.querySelectorAll(".evidence-card.chosen")) x.classList.remove("chosen");
    drawStrings();
    drawDetail();
    detail.querySelector<HTMLInputElement>("#evidence-thread-label")?.focus();
  }

  /** Drag to move (stored when the card is dropped); a click without moving just chooses it. */
  function moveCard(c: Card, card: HTMLElement, e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, textarea, select")) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    capture(card, e);
    const at = (m: PointerEvent) => ({ x: Math.max(0, Math.round(c.x + (m.clientX - start.x) / zoom)), y: Math.max(0, Math.round(c.y + (m.clientY - start.y) / zoom)) });
    const mv = (m: PointerEvent) => {
      if (!moved && Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) < 4) return;
      moved = true;
      card.classList.add("lifted");
      const p = at(m);
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
      drawStrings();
    };
    const up = (u: PointerEvent) => {
      card.removeEventListener("pointermove", mv);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
      card.classList.remove("lifted");
      if (!moved) return;
      const p = at(u);
      if (p.x !== c.x || p.y !== c.y) void change({ PutCard: { ...c, ...p } }, "Card moved. The script is unchanged.", c.id);
    };
    card.addEventListener("pointermove", mv);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }

  /** Drag a string from this card's pin and drop it on another card. */
  function tieFrom(c: Card, card: HTMLElement, e: PointerEvent) {
    e.preventDefault();
    card.focus();
    const from = pinOf(card);
    const live = svgEl("path", { class: "evidence-string-drawing" });
    svg.append(live);
    capture(card, e);
    let over: HTMLElement | null = null;
    const target = (m: PointerEvent) => {
      const hit = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>(".evidence-card");
      return hit && hit !== card && canvas.contains(hit) ? hit : null;
    };
    const mv = (m: PointerEvent) => {
      const t = target(m);
      if (t !== over) {
        over?.classList.remove("drop-target");
        t?.classList.add("drop-target");
        over = t;
      }
      live.setAttribute("d", curve(from, t ? pinOf(t) : toBoard(m)).d);
    };
    const end = (u: PointerEvent | null) => {
      card.removeEventListener("pointermove", mv);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc, true);
      live.remove();
      over?.classList.remove("drop-target");
      const t = u ? target(u) : null;
      if (!u) return say("String not tied");
      if (!t) return say("Drop the string on another card to tie it.");
      void tie(c.id, t.dataset.id!);
    };
    const up = (u: PointerEvent) => end(u);
    const cancel = () => end(null);
    const esc = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.preventDefault();
      k.stopPropagation();
      if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
      end(null);
    };
    card.addEventListener("pointermove", mv);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc, true);
  }

  /** Tie a string between two cards (once), then name it. */
  async function tie(from: string, to: string, label = "") {
    const had = st.threads.find((t) => (t.from === from && t.to === to) || (t.from === to && t.to === from));
    if (had) return chooseThread(had.id), say("Those cards are already tied: name the string on the right");
    const id = hooks.newId();
    if (await change({ PutThread: { id, from, to, label } }, "String tied: name it on the right (leads to, lies about…)")) chooseThread(id);
  }

  function drawStrings() {
    while (svg.firstChild) svg.firstChild.remove();
    for (const t of st.threads) {
      const a = els.get(t.from);
      const b = els.get(t.to);
      if (!a || !b) continue;
      const { d, mid } = curve(pinOf(a), pinOf(b));
      const on = t.id === chosenThread || t.from === chosen || t.to === chosen;
      const hit = svgEl("path", { d, class: "evidence-string-hit" });
      hit.dataset.id = t.id;
      hit.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        chooseThread(t.id);
      });
      svg.append(svgEl("path", { d, class: `evidence-string${on ? " on" : ""}` }), hit);
      if (t.label) {
        const tx = svgEl("text", { x: mid.x, y: mid.y - 4, class: "evidence-string-label", "text-anchor": "middle" });
        tx.textContent = t.label;
        svg.append(tx);
      }
    }
  }

  /** The same board as text: every card, then every string. */
  function drawList() {
    const name = (id: string) => {
      const c = cardById(id);
      return c ? `${KIND[c.kind]}: ${titleOf(c)}` : "(gone)";
    };
    listView.replaceChildren(
      el("h3", {}, `Cards (${st.cards.length})`),
      el("ul", { id: "evidence-list-cards" }, ...st.cards.map((c) => el("li", {}, name(c.id), c.kind === "note" && c.body ? ` · ${c.body}` : "", c.kind === "video" ? ` · ${c.url}` : ""))),
      el("h3", {}, `Strings (${st.threads.length})`),
      el("ul", { id: "evidence-list-strings" }, ...st.threads.map((t) => el("li", {}, `${name(t.from)} — ${t.label || "linked to"} — ${name(t.to)}`))),
    );
  }

  function drawDetail() {
    detail.replaceChildren();
    const t = st.threads.find((x) => x.id === chosenThread);
    if (t) return drawThreadDetail(t);
    const c = cardById(chosen ?? "");
    if (!c) return void detail.append(el("p", { className: "form-note" }, "Choose a card to edit it and tie it to others, or a string to name it."));
    const save = (patch: Partial<Card>, msg: string) => void change({ PutCard: { ...c, ...patch } }, msg, undefined);
    detail.append(el("h3", {}, `${KIND[c.kind]}: ${titleOf(c)}`));
    if (!c.ref_id) {
      const ti = el("input", { type: "text", id: "evidence-card-title", value: c.title });
      ti.setAttribute("aria-label", "Title");
      ti.addEventListener("change", () => save({ title: ti.value }, "Title saved"));
      detail.append(el("label", { htmlFor: "evidence-card-title" }, "Title"), ti);
    } else {
      const p = st.places[c.ref_id];
      if (p) {
        const go = el("button", { type: "button", className: "bible-go" }, `Go to the scene (${p.document_title})`);
        go.addEventListener("click", () => {
          dialog.close();
          hooks.go(p.document_id, c.ref_id!);
        });
        detail.append(go);
      } else detail.append(el("p", { className: "form-note" }, "This card shows an item that lives elsewhere; edit it there."));
    }
    if (c.kind === "note") {
      const b = el("textarea", { id: "evidence-card-body", value: c.body, rows: 5 });
      b.setAttribute("aria-label", "Note");
      b.addEventListener("change", () => save({ body: b.value }, "Note saved"));
      detail.append(el("label", { htmlFor: "evidence-card-body" }, "Note"), b);
    }
    if (c.kind === "video") {
      const u = el("input", { type: "url", id: "evidence-card-url", value: c.url });
      u.setAttribute("aria-label", "Video address");
      u.addEventListener("change", () => save({ url: u.value.trim() }, "Address saved (nothing is fetched)"));
      const open = el("button", { type: "button", id: "evidence-open-link" }, "Open in your browser");
      open.addEventListener("click", () => void hooks.openLink(c.url).then(() => say("Opening in your browser")).catch((e) => say(`${e}`)));
      detail.append(el("label", { htmlFor: "evidence-card-url" }, "Address (http or https; Kolbítar never fetches it)"), u, open);
    }
    // Strings: each can be chosen (to name it) or cut; a new one by choosing the other card.
    const strings = el("ul", { className: "evidence-threads", id: "evidence-threads" });
    for (const th of threadsOf(c.id)) {
      const other = cardById(th.from === c.id ? th.to : th.from);
      const edit = el("button", { type: "button", className: "evidence-thread-edit" }, `${th.from === c.id ? "→" : "←"} ${th.label || "linked"} · ${other ? titleOf(other) : "(gone)"}`);
      edit.addEventListener("click", () => chooseThread(th.id));
      const rm = el("button", { type: "button", className: "timeline-unlink" }, "Cut");
      rm.setAttribute("aria-label", `Cut the string to ${other ? titleOf(other) : "a card"}`);
      rm.addEventListener("click", () => void change({ DeleteThread: th.id }, "String cut"));
      strings.append(el("li", {}, edit, " ", rm));
    }
    const to = el("select", { id: "evidence-string-to" });
    to.setAttribute("aria-label", "Tie this card to");
    to.append(new Option("Tie to…", ""), ...st.cards.filter((x) => x.id !== c.id).map((x) => new Option(`${KIND[x.kind]}: ${titleOf(x)}`, x.id)));
    const label = el("input", { type: "text", id: "evidence-string-label", placeholder: "What the string means (leads to, lies about…)" });
    label.setAttribute("aria-label", "What the string means");
    const join = el("button", { type: "button", id: "evidence-string-add" }, "Add string");
    join.addEventListener("click", () => {
      if (!to.value) return say("Choose the card to tie to.");
      void change({ PutThread: { id: hooks.newId(), from: c.id, to: to.value, label: label.value.trim() } }, "String added");
    });
    const del = el("button", { type: "button", id: "evidence-delete" }, "Remove card");
    del.addEventListener("click", () => void change({ DeleteCard: c.id }, "Card removed with its strings (Undo brings them back)"));
    detail.append(el("h3", {}, "Strings"), strings, to, label, join, del);
  }

  function drawThreadDetail(t: Thread) {
    const a = cardById(t.from);
    const b = cardById(t.to);
    detail.append(el("h3", {}, "String"), el("p", { className: "form-note", id: "evidence-thread-ends" }, `${a ? titleOf(a) : "(gone)"} → ${b ? titleOf(b) : "(gone)"}`));
    const label = el("input", { type: "text", id: "evidence-thread-label", value: t.label, placeholder: "leads to, lies about, wants…" });
    label.addEventListener("change", () => void change({ PutThread: { ...t, label: label.value.trim() } }, "String named").then(() => chooseThread(t.id)));
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter") label.blur();
    });
    const flip = el("button", { type: "button", id: "evidence-thread-flip" }, "Turn around");
    flip.title = "Make the string run the other way";
    flip.addEventListener("click", () => void change({ PutThread: { ...t, from: t.to, to: t.from } }, "String turned around").then(() => chooseThread(t.id)));
    const cut = el("button", { type: "button", id: "evidence-thread-cut" }, "Cut string");
    cut.addEventListener("click", () => void change({ DeleteThread: t.id }, "String cut (Undo ties it again)", t.from));
    const back = el("button", { type: "button", className: "bible-go" }, `Back to ${a ? titleOf(a) : "the card"}`);
    back.addEventListener("click", () => (a ? els.get(a.id)?.focus() : undefined));
    detail.append(el("label", { htmlFor: "evidence-thread-label" }, "What the string means"), label, el("div", { className: "evidence-row" }, flip, cut), back);
  }

  // The empty board: drag to pan, double-click for a note there, Ctrl+wheel to zoom.
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target !== canvas && e.target !== svg)) return;
    const start = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop };
    capture(canvas, e);
    canvas.classList.add("panning");
    const mv = (m: PointerEvent) => {
      scroller.scrollLeft = start.l - (m.clientX - start.x);
      scroller.scrollTop = start.t - (m.clientY - start.y);
    };
    const up = (u: PointerEvent) => {
      canvas.removeEventListener("pointermove", mv);
      canvas.removeEventListener("pointerup", up);
      canvas.classList.remove("panning");
      if (Math.abs(u.clientX - start.x) + Math.abs(u.clientY - start.y) < 4 && (chosen || chosenThread)) {
        chosen = null;
        chosenThread = null;
        for (const x of canvas.querySelectorAll(".evidence-card.chosen")) x.classList.remove("chosen");
        drawStrings();
        drawDetail();
      }
    };
    canvas.addEventListener("pointermove", mv);
    canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener("dblclick", (e) => {
    if (e.target !== canvas && e.target !== svg) return;
    const p = toBoard(e);
    void add({ kind: "note", ref_id: null, title: "New note", body: "", url: "", asset: null }, "Note added here", { x: Math.max(0, Math.round(p.x - W / 2)), y: Math.max(0, Math.round(p.y - 20)) });
  });
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
    },
    { passive: false },
  );

  asList.addEventListener("click", () => {
    const on = listView.hidden;
    listView.hidden = !on;
    scroller.hidden = on;
    asList.setAttribute("aria-pressed", String(on));
    asList.textContent = on ? "Show as board" : "Show as list";
  });
  undoBtn.addEventListener("click", async () => {
    if (!steps || busy) return;
    if (await hooks.undo()) {
      steps--;
      undoBtn.disabled = steps === 0;
      say("Undone");
      await reload(chosen ?? undefined);
    }
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open() {
      steps = 0;
      undoBtn.disabled = true;
      status.textContent = "";
      await buildTools();
      if (!dialog.open) dialog.showModal();
      await reload();
      (canvas.querySelector<HTMLElement>(".evidence-card") ?? tools.querySelector<HTMLElement>("button"))?.focus();
    },
    close: () => dialog.close(),
    /** Add a card as the toolbar does (tests: a picture added without the file dialog). */
    addCard: (card: Omit<Card, "id" | "x" | "y">) => add(card, "Card added"),
    /** Tie two cards as dragging from a pin does (tests). */
    tie: (from: string, to: string, label = "") => tie(from, to, label),
    zoom: () => zoom,
    setZoom: (z: number) => setZoom(z),
  };
}
