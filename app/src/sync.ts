// Turns editor document changes into versioned domain batches.
//
// The editor holds an optimistic projection. Changes are diffed against the
// last acknowledged document by block id (not by DOM or position), batched,
// and committed by Rust with a base-version check. There is one undo stack
// (ProseMirror history); undo is just another change that gets synced.

import type { Node as PMNode } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";
import { nodeToBlock, newId, type Block } from "./schema";

export type Op =
  | { op: "put"; block: Block; after: string | null }
  | { op: "update"; block: Block }
  | { op: "delete"; id: string };

interface Entry {
  id: string;
  node: PMNode;
}

function entries(doc: PMNode): Entry[] {
  const out: Entry[] = [];
  doc.forEach((n) => out.push({ id: n.attrs.id, node: n }));
  return out;
}

/** Indices (into `seq`) of a longest strictly increasing subsequence. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k];
  }
  return keep;
}

export function diff(oldDoc: PMNode, newDoc: PMNode): Op[] {
  const a = entries(oldDoc);
  const b = entries(newDoc);
  const ops: Op[] = [];
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].id === b[pre].id) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].id === b[b.length - 1 - suf].id) suf++;
  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);
  const bIds = new Set(bMid.map((e) => e.id));
  const aIndex = new Map(aMid.map((e, i) => [e.id, i]));
  for (const e of aMid) if (!bIds.has(e.id)) ops.push({ op: "delete", id: e.id });
  // Blocks present on both sides that keep their relative order stay put.
  const survivors = bMid.map((e, i) => ({ i, old: aIndex.get(e.id) })).filter((x) => x.old !== undefined) as { i: number; old: number }[];
  const stay = lis(survivors.map((s) => s.old));
  const stayIdx = new Set([...stay].map((k) => survivors[k].i));
  const put = new Set<string>();
  for (let i = 0; i < bMid.length; i++) {
    if (stayIdx.has(i)) continue;
    const after = i > 0 ? bMid[i - 1].id : pre > 0 ? b[pre - 1].id : null;
    ops.push({ op: "put", block: nodeToBlock(bMid[i].node), after });
    put.add(bMid[i].id);
  }
  // Content changes for blocks that did not move.
  const oldById = new Map(a.map((e) => [e.id, e.node]));
  for (const e of b) {
    if (put.has(e.id)) continue;
    const o = oldById.get(e.id);
    if (o && o !== e.node && !o.eq(e.node)) ops.push({ op: "update", block: nodeToBlock(e.node) });
  }
  return ops;
}

export type SyncStatus = { state: "saved" | "pending" | "saving" | "error"; version: number; message?: string; at?: Date };

export class Syncer {
  private synced: PMNode;
  private version: number;
  private timer: number | undefined;
  private firstPending = 0;
  private inflight: Promise<void> | null = null;
  private latest: PMNode;
  onStatus: (s: SyncStatus) => void = () => {};
  onAck: (version: number) => void = () => {};
  stats = { batches: 0, ops: 0, lastDiffMs: 0, lastRoundTripMs: 0, roundTrips: [] as number[] };

  constructor(doc: PMNode, version: number, private debounceMs = 300, private maxWaitMs = 1500) {
    this.synced = doc;
    this.latest = doc;
    this.version = version;
  }

  get currentVersion() {
    return this.version;
  }
  get hasUnsynced() {
    return this.latest !== this.synced || this.inflight !== null;
  }

  changed(doc: PMNode) {
    this.latest = doc;
    const now = performance.now();
    if (!this.timer) this.firstPending = now;
    window.clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - (now - this.firstPending)));
    this.timer = window.setTimeout(() => void this.flush(), wait);
    this.onStatus({ state: "pending", version: this.version });
  }

  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inflight) {
      await this.inflight;
      if (this.latest !== this.synced) return this.flush();
      return;
    }
    const target = this.latest;
    if (target === this.synced) return;
    const t0 = performance.now();
    const ops = diff(this.synced, target);
    this.stats.lastDiffMs = performance.now() - t0;
    if (!ops.length) {
      this.synced = target;
      return;
    }
    this.onStatus({ state: "saving", version: this.version });
    const batch = { tx_id: newId(), base_version: this.version, ops };
    let failed = false;
    this.inflight = (async () => {
      const t1 = performance.now();
      try {
        const ack = await invoke<{ version: number; duplicate: boolean }>("apply_batch", { batch });
        this.stats.lastRoundTripMs = performance.now() - t1;
        this.stats.roundTrips.push(this.stats.lastRoundTripMs);
        this.stats.batches++;
        this.stats.ops += ops.length;
        this.version = ack.version;
        this.synced = target;
        this.onAck(ack.version);
        this.onStatus({ state: this.latest === this.synced ? "saved" : "pending", version: this.version, at: new Date() });
      } catch (e) {
        // Keep the editor's text; nothing is dropped. The user sees the error.
        failed = true;
        this.onStatus({ state: "error", version: this.version, message: String(e) });
      } finally {
        this.inflight = null;
      }
    })();
    await this.inflight;
    // Edits made while the batch was in flight go out in the next one.
    if (!failed && this.latest !== this.synced) this.changed(this.latest);
  }

  /** Replace the baseline after a full reload from the store. */
  reset(doc: PMNode, version: number) {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.synced = doc;
    this.latest = doc;
    this.version = version;
  }
}
