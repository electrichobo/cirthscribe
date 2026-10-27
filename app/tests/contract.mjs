// TypeScript side of the model contract with cirth-core
// (fixtures/model-contract.json; the Rust side is
// crates/cirth-core/tests/contract.rs). Runs the editor's real conversion
// code in Node (type stripping, no build step): every block must come back
// from the editor exactly as Rust writes it.
//   node tests/contract.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// The app's sources import each other without extensions (Vite style); let Node find the .ts file.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !s.endsWith('.ts')) return next(s + '.ts', c); throw e; } }",
    ),
);
const { KINDS, blockToNode, nodeToBlock, docFromBlocks } = await import("../src/schema.ts");
const { diff } = await import("../src/sync.ts");

const c = JSON.parse(readFileSync(new URL("../../fixtures/model-contract.json", import.meta.url), "utf8"));
let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

check("block kinds match", () => assert.deepEqual([...KINDS], c.kinds));

check("every block survives the editor unchanged", () => {
  for (const b of c.blocks) assert.deepEqual(nodeToBlock(blockToNode(b)), b, b.id);
});

check("op blocks survive the editor unchanged", () => {
  for (const o of c.batch.ops) if (o.block) assert.deepEqual(nodeToBlock(blockToNode(o.block)), o.block, o.block.id);
});

check("the editor's diff emits only contract op shapes", () => {
  // Insert, move, edit and delete, then compare each op's keys with the contract's.
  const before = docFromBlocks(c.blocks);
  const after = c.blocks.filter((b) => b.id !== "b-empty").map((b) => (b.id === "b-cue" ? { ...b, runs: [{ text: "NOOR (V.O.)" }] } : b));
  after.splice(1, 0, { id: "b-new", kind: "action", runs: [{ text: "New line." }] });
  after.push(after.splice(2, 1)[0]);
  const ops = diff(before, docFromBlocks(after));
  const shape = (o) => [o.op, ...Object.keys(o).sort()].join(",");
  const allowed = new Set(c.batch.ops.map(shape));
  for (const o of ops) {
    assert.ok(allowed.has(shape(o)), `unexpected op shape ${shape(o)}`);
    if (o.block) assert.deepEqual(nodeToBlock(blockToNode(o.block)), o.block);
  }
  assert.deepEqual([...new Set(ops.map((o) => o.op))].sort(), ["delete", "put", "update"]);
});

console.log(`${passed} passed`);
