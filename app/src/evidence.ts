// View > Tools > Evidence Board… (M3 step 9, ACCEPTANCE C4): a freeform
// canvas of cards joined by labelled strings. A card is a note, a picture,
// a video link, or a view of a scene, beat, bible entry or timeline event
// (by its stable id: the card shows its current title and holds no copy).
// Moving a card never moves anything in the script.
//
// Pictures are packaged in the project file; video links are stored as text
// and open in the browser only when the writer asks. Nothing is fetched.
//
// Keyboard: Tab reaches each card; Alt+arrows move the focused card
// (Shift for bigger steps); Enter edits it on the right; Delete removes it.
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

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
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
  const canvas = el("div", { className: "evidence-canvas", id: "evidence-canvas" });
  canvas.setAttribute("role", "group");
  canvas.setAttribute("aria-label", "Evidence board: Tab reaches each card, Alt+arrows move it, Enter edits it, Delete removes it");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "evidence-strings");
  svg.setAttribute("aria-hidden", "true");
  const scroller = el("div", { className: "evidence-scroll" }, canvas);
  const listView = el("div", { className: "evidence-listview", id: "evidence-listview", hidden: true });
  const detail = el("div", { className: "evidence-detail", id: "evidence-detail" });
  const undoBtn = el("button", { type: "button", id: "evidence-undo", disabled: true }, "Undo");
  const asList = el("button", { type: "button", id: "evidence-list-toggle" }, "Show as list");
  asList.setAttribute("aria-pressed", "false");
  const close = el("button", { type: "button", id: "evidence-close" }, "Close");
  dialog.append(
    el("h2", { id: "evidence-title" }, "Evidence board"),
    el("div", { className: "evidence-bar" }, tools, status),
    el("div", { className: "evidence-cols" }, el("div", { className: "evidence-main" }, scroller, listView), detail),
    el("div", { className: "dialog-actions" }, asList, undoBtn, close),
  );
  document.body.append(dialog);

  let st: BoardState = { cards: [], threads: [], titles: {}, places: {} };
  let chosen: string | null = null;
  let steps = 0;
  let busy = false;
  const pictures = new Map<string, string>();

  const say = (t: string) => {
    status.textContent = t;
    announce(t);
  };
  const titleOf = (c: Card) => (c.ref_id ? (st.titles[c.ref_id] ?? "(no longer exists)") : c.title || KIND[c.kind]);

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
    } finally {
      busy = false;
    }
  }

  async function reload(focus?: string) {
    st = await hooks.state();
    if (!st.cards.some((c) => c.id === chosen)) chosen = null;
    for (const c of st.cards) if (c.asset && !pictures.has(c.asset)) pictures.set(c.asset, await hooks.pictureData(c.asset));
    draw(focus);
  }

  /** A free spot for a new card: the next cell of a loose grid, with room for strings and their labels between cards. */
  function spot() {
    const n = st.cards.length;
    return { x: 30 + (n % 3) * (W + 120), y: 30 + Math.floor(n / 3) * 230 };
  }
  async function add(card: Omit<Card, "id" | "x" | "y">, done: string) {
    const c: Card = { ...card, id: hooks.newId(), ...spot() };
    chosen = c.id;
    await change({ PutCard: c }, done, c.id);
  }

  async function buildTools() {
    const src = await hooks.sources();
    tools.replaceChildren();
    const note = el("button", { type: "button", id: "evidence-add-note" }, "Note");
    note.addEventListener("click", () => void add({ kind: "note", ref_id: null, title: "New note", body: "", url: "", asset: null }, "Note added"));
    tools.append(el("span", { className: "form-note" }, "Add:"), note);
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
      tools.append(sel);
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
    tools.append(pic, vid);
  }

  function draw(focus?: string) {
    // Canvas size: room around the cards.
    const maxX = Math.max(900, ...st.cards.map((c) => c.x + W + 200));
    const maxY = Math.max(600, ...st.cards.map((c) => c.y + 260));
    canvas.style.width = `${maxX}px`;
    canvas.style.height = `${maxY}px`;
    svg.setAttribute("width", String(maxX));
    svg.setAttribute("height", String(maxY));
    canvas.replaceChildren(svg);
    const els = new Map<string, HTMLElement>();
    for (const c of st.cards) {
      const card = el("div", { className: `evidence-card ${c.kind}`, tabIndex: 0 });
      card.dataset.id = c.id;
      card.style.left = `${c.x}px`;
      card.style.top = `${c.y}px`;
      if (c.id === chosen) card.classList.add("chosen");
      const head = el("div", { className: "evidence-kind" }, KIND[c.kind]);
      card.append(head, el("div", { className: "evidence-card-title" }, titleOf(c)));
      if (c.kind === "note" && c.body) card.append(el("div", { className: "evidence-body" }, c.body.length > 140 ? `${c.body.slice(0, 140)}…` : c.body));
      if (c.kind === "image" && c.asset && pictures.get(c.asset)) card.append(el("img", { src: pictures.get(c.asset), alt: c.title || "Picture" }));
      if (c.kind === "video") card.append(el("div", { className: "evidence-url" }, c.url));
      card.setAttribute("aria-label", `${KIND[c.kind]}: ${titleOf(c)}${threadsOf(c.id).length ? `, ${threadsOf(c.id).length} strings` : ""}`);
      card.addEventListener("focus", () => {
        if (chosen !== c.id) {
          chosen = c.id;
          for (const x of canvas.querySelectorAll(".evidence-card.chosen")) x.classList.remove("chosen");
          card.classList.add("chosen");
          drawDetail();
        }
      });
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
      // Drag to move (the move is stored when the card is dropped).
      head.addEventListener("pointerdown", (e) => {
        const start = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
        head.setPointerCapture(e.pointerId);
        const mv = (m: PointerEvent) => {
          card.style.left = `${Math.max(0, start.cx + m.clientX - start.x)}px`;
          card.style.top = `${Math.max(0, start.cy + m.clientY - start.y)}px`;
          drawStrings(els);
        };
        const up = (u: PointerEvent) => {
          head.removeEventListener("pointermove", mv);
          head.removeEventListener("pointerup", up);
          const x = Math.max(0, start.cx + u.clientX - start.x);
          const y = Math.max(0, start.cy + u.clientY - start.y);
          if (Math.abs(x - c.x) + Math.abs(y - c.y) > 2) void change({ PutCard: { ...c, x, y } }, "Card moved. The script is unchanged.", c.id);
        };
        head.addEventListener("pointermove", mv);
        head.addEventListener("pointerup", up);
      });
      canvas.append(card);
      els.set(c.id, card);
    }
    if (!st.cards.length) canvas.append(el("p", { className: "form-note evidence-empty" }, "Add notes, pictures, video links, or cards for scenes, beats, bible entries and events; then join them with strings."));
    drawStrings(els);
    drawList();
    drawDetail();
    if (focus) els.get(focus)?.focus();
  }

  const threadsOf = (id: string) => st.threads.filter((t) => t.from === id || t.to === id);

  function drawStrings(els: Map<string, HTMLElement>) {
    while (svg.firstChild) svg.firstChild.remove();
    const ns = "http://www.w3.org/2000/svg";
    for (const t of st.threads) {
      const a = els.get(t.from);
      const b = els.get(t.to);
      if (!a || !b) continue;
      const cx = (e: HTMLElement) => e.offsetLeft + e.offsetWidth / 2;
      const cy = (e: HTMLElement) => e.offsetTop + e.offsetHeight / 2;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(cx(a)));
      line.setAttribute("y1", String(cy(a)));
      line.setAttribute("x2", String(cx(b)));
      line.setAttribute("y2", String(cy(b)));
      line.setAttribute("class", "evidence-string");
      svg.append(line);
      if (t.label) {
        const tx = document.createElementNS(ns, "text");
        tx.setAttribute("x", String((cx(a) + cx(b)) / 2));
        tx.setAttribute("y", String((cy(a) + cy(b)) / 2 - 4));
        tx.setAttribute("class", "evidence-string-label");
        tx.setAttribute("text-anchor", "middle");
        tx.textContent = t.label;
        svg.append(tx);
      }
    }
  }

  /** The same board as text: every card, then every string. */
  function drawList() {
    const name = (id: string) => {
      const c = st.cards.find((x) => x.id === id);
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
    const c = st.cards.find((x) => x.id === chosen);
    if (!c) return void detail.append(el("p", { className: "form-note" }, "Choose a card to edit it and join it to others."));
    const save = (patch: Partial<Card>, msg: string) => void change({ PutCard: { ...c, ...patch } }, msg, undefined);
    detail.append(el("h3", {}, `${KIND[c.kind]}: ${titleOf(c)}`));
    if (!c.ref_id) {
      const t = el("input", { type: "text", id: "evidence-card-title", value: c.title });
      t.setAttribute("aria-label", "Title");
      t.addEventListener("change", () => save({ title: t.value }, "Title saved"));
      detail.append(el("label", { htmlFor: "evidence-card-title" }, "Title"), t);
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
    // Strings.
    const strings = el("ul", { className: "evidence-threads", id: "evidence-threads" });
    for (const t of threadsOf(c.id)) {
      const other = st.cards.find((x) => x.id === (t.from === c.id ? t.to : t.from));
      const rm = el("button", { type: "button", className: "timeline-unlink" }, "Cut");
      rm.setAttribute("aria-label", `Cut the string to ${other ? titleOf(other) : "a card"}`);
      rm.addEventListener("click", () => void change({ DeleteThread: t.id }, "String cut"));
      strings.append(el("li", {}, `${t.from === c.id ? "→" : "←"} ${t.label || "linked"} · ${other ? titleOf(other) : "(gone)"} `, rm));
    }
    const to = el("select", { id: "evidence-string-to" });
    to.setAttribute("aria-label", "Join this card to");
    to.append(new Option("Join to…", ""), ...st.cards.filter((x) => x.id !== c.id).map((x) => new Option(`${KIND[x.kind]}: ${titleOf(x)}`, x.id)));
    const label = el("input", { type: "text", id: "evidence-string-label", placeholder: "What the string means (leads to, lies about…)" });
    label.setAttribute("aria-label", "What the string means");
    const join = el("button", { type: "button", id: "evidence-string-add" }, "Add string");
    join.addEventListener("click", () => {
      if (!to.value) return say("Choose the card to join to.");
      void change({ PutThread: { id: hooks.newId(), from: c.id, to: to.value, label: label.value.trim() } }, "String added");
    });
    const del = el("button", { type: "button", id: "evidence-delete" }, "Remove card");
    del.addEventListener("click", () => void change({ DeleteCard: c.id }, "Card removed with its strings (Undo brings them back)"));
    detail.append(el("h3", {}, "Strings"), strings, to, label, join, del);
  }

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
      await reload();
      if (!dialog.open) dialog.showModal();
      (canvas.querySelector<HTMLElement>(".evidence-card") ?? tools.querySelector<HTMLElement>("button"))?.focus();
    },
    close: () => dialog.close(),
    /** Add a card as the toolbar does (tests: a picture added without the file dialog). */
    addCard: (card: Omit<Card, "id" | "x" | "y">) => add(card, "Card added"),
  };
}
