// Prints a Markdown dependency/license inventory for the Rust workspace and the
// shipped (non-dev) npm packages. Usage: node scripts/license-inventory.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-gnu"], { cwd: root, maxBuffer: 1 << 28 }).toString());
// Only packages reachable in the resolved graph for this target.
const reachable = new Set(meta.resolve.nodes.map((n) => n.id));
const crates = meta.packages.filter((p) => reachable.has(p.id) && p.source);
const tally = (items) => {
  const m = new Map();
  for (const i of items) m.set(i.license, [...(m.get(i.license) ?? []), i.name]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};
const flag = (lic) => (!lic || /GPL|MPL|EPL|CDDL|SSPL|BUSL|Commercial|UNKNOWN|NOASSERTION/i.test(lic) ? " **review**" : "");

console.log(`## Rust crates (resolved for x86_64-pc-windows-gnu): ${crates.length}\n`);
console.log("| License expression | Count | Crates (first 8) |\n| - | - | - |");
for (const [lic, names] of tally(crates.map((p) => ({ name: `${p.name} ${p.version}`, license: p.license ?? "UNKNOWN" })))) {
  console.log(`| ${lic}${flag(lic)} | ${names.length} | ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", ..." : ""} |`);
}

const appDir = join(root, "app");
const lock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8"));
const npmProd = [];
const npmDev = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path) continue;
  const pj = join(appDir, path, "package.json");
  const license = existsSync(pj) ? JSON.parse(readFileSync(pj, "utf8")).license ?? "UNKNOWN" : info.license ?? "UNKNOWN";
  const name = `${path.replace(/^.*node_modules\//, "")} ${info.version}`;
  (info.dev ? npmDev : npmProd).push({ name, license });
}
console.log(`\n## npm packages shipped in the app bundle: ${npmProd.length}\n`);
console.log("| License | Count | Packages |\n| - | - | - |");
for (const [lic, names] of tally(npmProd)) console.log(`| ${lic}${flag(lic)} | ${names.length} | ${names.join(", ")} |`);
console.log(`\n## npm build-only tools (not shipped): ${npmDev.length}\n`);
console.log("| License | Count | Packages |\n| - | - | - |");
for (const [lic, names] of tally(npmDev)) console.log(`| ${lic}${flag(lic)} | ${names.length} | ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", ..." : ""} |`);
