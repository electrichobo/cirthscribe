// View > Tools > Bible… (M3 step 7, ACCEPTANCE C1–C3): the project's
// characters, locations and world entries, one bible for every episode.
//
// Left: the entries of one kind, then the candidates the scripts suggest
// (character cues and scene-heading places no entry covers yet), each with
// how often it appears. Accept makes an entry, Merge adds the name to an
// entry as an alias, Reject hides it. Nothing becomes an entry by itself,
// and nothing is ever deleted except by the writer.
// Right: the chosen entry (name, aliases, description, the writer's own
// fields, scope) and where it appears; an entry the scripts no longer
// mention is marked, not removed. "Rename in the scripts…" previews which
// cues or headings change and which other mentions stay as they are.
//
// Every change to an entry is a planning step: "Undo" in the dialog takes
// back the dialog's last change (ADR 0003).

import { announce } from "./a11y";

export interface Entity {
  id: string;
  kind: "character" | "location" | "world";
  name: string;
  aliases: string[];
  description: string;
  fields: [string, string][];
  scope: string | null;
}
interface Evidence {
  document_id: string;
  scene_id: string | null;
  block_id: string;
}
interface Entry extends Entity {
  occurrences: Evidence[];
}
interface Candidate {
  kind: string;
  name: string;
  count: number;
  evidence: Evidence[];
}
interface BibleState {
  entries: Entry[];
  candidates: Candidate[];
  places: Record<string, { document_id: string; document_title: string; heading: string }>;
}
interface RenamePlan {
  changes: { document_id: string; block_id: string; before: string; after: string }[];
  untouched: { document_id: string; block_id: string; text: string }[];
}
export type BibleOp = { PutEntity: Entity } | { DeleteEntity: string } | { Reject: { kind: string; name: string; on: boolean } };

const KIND_LABEL = { character: "Characters", location: "Locations", world: "World" } as const;
const ONE = { character: "character", location: "location", world: "world entry" } as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export function createBible(hooks: {
  state: () => Promise<BibleState>;
  apply: (op: BibleOp) => Promise<boolean>;
  undo: () => Promise<boolean>;
  scopes: () => Promise<{ id: string; title: string; kind: string }[]>;
  renamePreview: (id: string, from: string, to: string) => Promise<RenamePlan>;
  renameApply: (id: string, from: string, to: string, expect: number) => Promise<number>;
  go: (documentId: string, sceneId: string) => void;
  newId: () => string;
}) {
  const dialog = el("dialog", { id: "bible-dialog", className: "about bible" });
  dialog.setAttribute("aria-labelledby", "bible-title");
  const h = el("h2", { id: "bible-title" }, "Bible");
  const kind = el("select", { id: "bible-kind" });
  kind.setAttribute("aria-label", "Kind of entry");
  for (const k of ["character", "location", "world"] as const) kind.add(new Option(KIND_LABEL[k], k));
  const status = el("p", { id: "bible-status", className: "form-note" });
  status.setAttribute("role", "status");
  const left = el("div", { className: "bible-left" });
  const right = el("div", { className: "bible-right", id: "bible-detail" });
  const undoBtn = el("button", { type: "button", id: "bible-undo", disabled: true }, "Undo");
  const close = el("button", { type: "button", id: "bible-close" }, "Close");
  dialog.append(h, el("div", { className: "bible-tools" }, kind, status), el("div", { className: "bible-cols" }, left, right), el("div", { className: "dialog-actions" }, undoBtn, close));
  document.body.append(dialog);

  let st: BibleState = { entries: [], candidates: [], places: {} };
  let chosen: { entry?: string; candidate?: string } = {};
  let steps = 0;
  let scopes: { id: string; title: string; kind: string }[] = [];

  const say = (t: string) => {
    status.textContent = t;
    announce(t);
  };
  const where = (e: Evidence) => {
    const p = e.scene_id ? st.places[e.scene_id] : undefined;
    return p ? `${p.document_title} · ${p.heading || "(empty heading)"}` : "a script";
  };
  const evidenceList = (ev: Evidence[], label: string) => {
    const ul = el("ul", { className: "bible-evidence" });
    ul.setAttribute("aria-label", label);
    const seen = new Set<string>();
    for (const e of ev) {
      const key = `${e.document_id}:${e.scene_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = el("button", { type: "button", className: "bible-go" }, where(e));
      b.addEventListener("click", () => {
        if (!e.scene_id) return;
        dialog.close();
        hooks.go(e.document_id, e.scene_id);
      });
      ul.append(el("li", {}, b));
    }
    return ul;
  };

  async function change(op: BibleOp, done: string) {
    if (await hooks.apply(op)) {
      steps++;
      undoBtn.disabled = false;
      say(done);
      await reload();
    } else say("Not saved; see the message in the window.");
  }

  async function reload() {
    st = await hooks.state();
    draw();
  }

  function draw() {
    const k = kind.value as Entity["kind"];
    const entries = st.entries.filter((e) => e.kind === k);
    const cands = st.candidates.filter((c) => c.kind === k);
    left.replaceChildren();
    // Entries.
    const list = el("ul", { className: "bible-list", id: "bible-entries" });
    list.setAttribute("aria-label", `${KIND_LABEL[k]} in the bible`);
    for (const e of entries) {
      const b = el("button", { type: "button", className: "bible-entry" }, el("span", {}, e.name), el("span", { className: "bible-meta" }, e.occurrences.length ? `${e.occurrences.length}×` : k === "world" ? "" : "Unreferenced"));
      b.dataset.id = e.id;
      if (chosen.entry === e.id) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => {
        chosen = { entry: e.id };
        draw();
      });
      list.append(el("li", {}, b));
    }
    const add = el("button", { type: "button", id: "bible-new" }, `New ${ONE[k]}`);
    add.addEventListener("click", () => {
      const e: Entity = { id: hooks.newId(), kind: k, name: k === "world" ? "New fact" : "NEW NAME", aliases: [], description: "", fields: [], scope: null };
      chosen = { entry: e.id };
      void change({ PutEntity: e }, `New ${ONE[k]} added`);
    });
    left.append(el("h3", {}, `${KIND_LABEL[k]} (${entries.length})`), list, add);
    // Candidates.
    if (k !== "world") {
      const cl = el("ul", { className: "bible-list", id: "bible-candidates" });
      cl.setAttribute("aria-label", "Candidates from the scripts");
      for (const c of cands) {
        const row = el("li", { className: "bible-cand" });
        row.dataset.name = c.name;
        const name = el("button", { type: "button", className: "bible-cand-name" }, `${c.name} `, el("span", { className: "bible-meta" }, `${c.count}×`));
        if (chosen.candidate === c.name) name.setAttribute("aria-current", "true");
        name.addEventListener("click", () => {
          chosen = { candidate: c.name };
          draw();
        });
        const accept = el("button", { type: "button", className: "bible-accept" }, "Accept");
        accept.setAttribute("aria-label", `Accept ${c.name} as a ${ONE[k]}`);
        accept.addEventListener("click", () => {
          const id = hooks.newId();
          chosen = { entry: id };
          void change({ PutEntity: { id, kind: k, name: c.name, aliases: [], description: "", fields: [], scope: null } }, `${c.name} added to the bible`);
        });
        const reject = el("button", { type: "button", className: "bible-reject" }, "Reject");
        reject.setAttribute("aria-label", `Reject ${c.name}: not a ${ONE[k]}`);
        reject.addEventListener("click", () => void change({ Reject: { kind: k, name: c.name, on: true } }, `${c.name} will not be suggested again`));
        const merge = el("select", { className: "bible-merge" });
        merge.setAttribute("aria-label", `Add ${c.name} as another name of`);
        merge.append(new Option("Merge into…", ""), ...entries.map((e) => new Option(e.name, e.id)));
        merge.disabled = !entries.length;
        merge.addEventListener("change", () => {
          const e = st.entries.find((x) => x.id === merge.value);
          if (!e) return;
          chosen = { entry: e.id };
          void change({ PutEntity: { ...strip(e), aliases: [...e.aliases, c.name] } }, `${c.name} is now another name of ${e.name}`);
        });
        row.append(name, accept, merge, reject);
        cl.append(row);
      }
      left.append(el("h3", {}, `Candidates from the scripts (${cands.length})`), el("p", { className: "form-note" }, k === "character" ? "Names from character cues only, never from action text." : "Places from scene headings."), cl);
      if (!cands.length) cl.append(el("li", { className: "form-note" }, "None: every name is in the bible or rejected."));
    }
    drawDetail();
  }

  const strip = (e: Entry): Entity => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases, description: e.description, fields: e.fields, scope: e.scope });

  function drawDetail() {
    right.replaceChildren();
    const c = chosen.candidate ? st.candidates.find((x) => x.name === chosen.candidate && x.kind === kind.value) : undefined;
    if (c) {
      right.append(el("h3", {}, `${c.name} (candidate)`), el("p", { className: "form-note" }, `Found ${c.count} time${c.count === 1 ? "" : "s"}. Choose a place to go there.`), evidenceList(c.evidence, `Where ${c.name} appears`));
      return;
    }
    const e = st.entries.find((x) => x.id === chosen.entry);
    if (!e) {
      right.append(el("p", { className: "form-note" }, "Choose an entry or a candidate."));
      return;
    }
    const save = (patch: Partial<Entity>, msg: string) => void change({ PutEntity: { ...strip(e), ...patch } }, msg);
    const name = el("input", { type: "text", id: "bible-name", value: e.name });
    name.setAttribute("aria-label", "Name");
    name.addEventListener("change", () => name.value.trim() && save({ name: name.value.trim() }, "Name saved (the scripts are unchanged; use Rename to change them)"));
    const aliases = el("input", { type: "text", id: "bible-aliases", value: e.aliases.join(", "), placeholder: "Other names, separated by commas" });
    aliases.setAttribute("aria-label", "Other names (aliases)");
    aliases.addEventListener("change", () => save({ aliases: aliases.value.split(",").map((x) => x.trim()).filter(Boolean) }, "Other names saved"));
    const desc = el("textarea", { id: "bible-description", value: e.description, rows: 4, placeholder: "Description, history, notes (yours; never changed by the app)" });
    desc.setAttribute("aria-label", "Description");
    desc.addEventListener("change", () => save({ description: desc.value }, "Description saved"));
    // The writer's own fields.
    const fields = el("div", { className: "bible-fields" });
    e.fields.forEach(([key, value], i) => {
      const kIn = el("input", { type: "text", value: key, placeholder: "Field" });
      kIn.setAttribute("aria-label", `Field ${i + 1} name`);
      const vIn = el("input", { type: "text", value, placeholder: "Value" });
      vIn.setAttribute("aria-label", `Field ${i + 1} value`);
      const commit = () => save({ fields: e.fields.map((f, j) => (j === i ? [kIn.value, vIn.value] : f)) as [string, string][] }, "Field saved");
      kIn.addEventListener("change", commit);
      vIn.addEventListener("change", commit);
      const rm = el("button", { type: "button" }, "Remove");
      rm.setAttribute("aria-label", `Remove field ${key || i + 1}`);
      rm.addEventListener("click", () => save({ fields: e.fields.filter((_, j) => j !== i) }, "Field removed"));
      fields.append(kIn, vIn, rm);
    });
    const addField = el("button", { type: "button", id: "bible-add-field" }, "Add a field");
    addField.addEventListener("click", () => save({ fields: [...e.fields, ["", ""]] }, "Field added"));
    const scope = el("select", { id: "bible-scope" });
    scope.setAttribute("aria-label", "Belongs to");
    scope.append(new Option("The whole project", ""), ...scopes.map((s) => new Option(`${s.kind === "folder" ? "Folder" : "Script"}: ${s.title}`, s.id)));
    scope.value = e.scope ?? "";
    scope.addEventListener("change", () => save({ scope: scope.value || null }, "Scope saved"));
    const del = el("button", { type: "button", id: "bible-delete" }, "Delete entry");
    del.addEventListener("click", () => {
      chosen = {};
      void change({ DeleteEntity: e.id }, `${e.name} deleted from the bible (Undo brings it back; the scripts are unchanged)`);
    });
    right.append(
      el("label", { htmlFor: "bible-name" }, "Name"),
      name,
      el("label", { htmlFor: "bible-aliases" }, "Other names"),
      aliases,
      el("label", { htmlFor: "bible-description" }, "Description"),
      desc,
      el("h3", {}, "Fields"),
      fields,
      addField,
      el("label", { htmlFor: "bible-scope" }, "Belongs to"),
      scope,
    );
    // Where it appears; an unreferenced entry is kept and marked (C3).
    if (e.kind !== "world") {
      right.append(el("h3", {}, `Appears ${e.occurrences.length} time${e.occurrences.length === 1 ? "" : "s"}`));
      if (e.occurrences.length) right.append(evidenceList(e.occurrences, `Where ${e.name} appears`));
      else right.append(el("p", { className: "bible-unref", id: "bible-unreferenced" }, "Unreferenced: no script mentions this entry any more. It is kept; delete it yourself if it should go."));
      right.append(renamePanel(e));
    }
    right.append(del);
  }

  /** Rename in the scripts: preview first, then apply. */
  function renamePanel(e: Entry) {
    const box = el("details", { className: "bible-rename", id: "bible-rename" });
    box.append(el("summary", {}, "Rename in the scripts…"));
    const from = el("select", { id: "bible-rename-from" });
    from.setAttribute("aria-label", "Name to change");
    for (const n of [e.name, ...e.aliases]) from.add(new Option(n, n));
    const to = el("input", { type: "text", id: "bible-rename-to", placeholder: "New name" });
    to.setAttribute("aria-label", "New name");
    const preview = el("button", { type: "button", id: "bible-rename-preview" }, "Preview");
    const out = el("div", { className: "bible-rename-out", id: "bible-rename-out" });
    preview.addEventListener("click", async () => {
      const name = to.value.trim();
      if (!name) return say("Type the new name first.");
      const plan = await hooks.renamePreview(e.id, from.value, name);
      out.replaceChildren(
        el("p", {}, `${plan.changes.length} ${e.kind === "character" ? "cue" : "heading"}${plan.changes.length === 1 ? "" : "s"} will change:`),
        el("ul", { className: "bible-changes" }, ...plan.changes.slice(0, 30).map((c) => el("li", {}, `${c.before} → ${c.after}`))),
        el("p", {}, plan.untouched.length ? `${plan.untouched.length} other mention${plan.untouched.length === 1 ? "" : "s"} (action, dialogue) stay as they are:` : "No other mentions."),
        el("ul", { className: "bible-untouched" }, ...plan.untouched.slice(0, 30).map((m) => el("li", {}, m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text))),
      );
      const apply = el("button", { type: "button", id: "bible-rename-apply", className: "primary", disabled: !plan.changes.length }, "Rename");
      apply.addEventListener("click", async () => {
        try {
          const n = await hooks.renameApply(e.id, from.value, name, plan.changes.length);
          // The entry takes the new name and keeps the old one as another name.
          // The scripts write names in capitals; the entry keeps the old name as another name.
          const old = from.value;
          const fresh = name.toUpperCase();
          const newName = old === e.name ? fresh : e.name;
          const others = [...e.aliases, old, ...(old === e.name ? [] : [fresh])];
          const seen = new Set([newName.toUpperCase()]);
          const aliases = others.filter((x) => !seen.has(x.toUpperCase()) && seen.add(x.toUpperCase()));
          await hooks.apply({ PutEntity: { ...strip(e), name: newName, aliases } });
          steps++;
          undoBtn.disabled = false;
          say(`${n} renamed. The old name is kept as another name of the entry. To change the scripts back, rename again.`);
          await reload();
        } catch (err) {
          say(`Not renamed: ${err}`);
        }
      });
      out.append(apply);
    });
    box.append(el("div", { className: "bible-rename-row" }, from, to, preview), out);
    return box;
  }

  kind.addEventListener("change", () => {
    chosen = {};
    draw();
  });
  undoBtn.addEventListener("click", async () => {
    if (!steps) return;
    if (await hooks.undo()) {
      steps--;
      undoBtn.disabled = steps === 0;
      say("Undone");
      await reload();
    }
  });
  close.addEventListener("click", () => dialog.close());

  return {
    async open() {
      steps = 0;
      undoBtn.disabled = true;
      status.textContent = "";
      scopes = await hooks.scopes();
      await reload();
      if (!dialog.open) dialog.showModal();
      kind.focus();
    },
    close: () => dialog.close(),
    reload,
  };
}
