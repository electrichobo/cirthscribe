// End-to-end runner.
//
//   node tests/e2e/run.mjs --driver cdp|webdriver --exe <app> --out <results.json>
//                          [--screens <dir>] [--native-driver-dir <dir>]
//
// cdp:       WebView2 DevTools protocol (Windows only). Can simulate IME.
// webdriver: tauri-driver + msedgedriver (Windows) or WebKitWebDriver (Linux).
// Exit code: 1 if any test failed. Skipped tests are listed with reasons.

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, release, arch } from "node:os";
import { join, dirname, resolve } from "node:path";
import { runSuite } from "./suite.mjs";
import { platform } from "./platform.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const req of ["driver", "exe", "out"]) if (!args[req]) throw new Error(`missing --${req}`);

const exe = resolve(platform === "win32" && !args.exe.endsWith(".exe") ? `${args.exe}.exe` : args.exe);
const dataDir = mkdtempSync(join(tmpdir(), "cirth-e2e-"));
const { createDriver } = await import(`./drivers/${args.driver}.mjs`);
const driver = createDriver({ exe, dataDir, nativeDriverDir: args["native-driver-dir"] && resolve(args["native-driver-dir"]) });
const results = {
  started: new Date().toISOString(),
  driver: driver.name,
  platform: { os: platform, release: release(), arch: arch() },
  tests: [],
  measurements: {},
};

function writeResults() {
  results.finished = new Date().toISOString();
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  // Keep results free of machine-specific temp paths.
  writeFileSync(args.out, JSON.stringify(results, null, 2).split(tmpdir().replaceAll("\\", "\\\\")).join("<tmp>"));
}

// Whole-suite deadline: a hang becomes a readable failure naming the test.
const deadlineMin = Number(args["deadline-min"] ?? 25);
setTimeout(async () => {
  results.tests.push({ name: "harness", ok: false, error: `deadline of ${deadlineMin} min reached during: ${results.current}` });
  console.log(`FAIL harness: deadline of ${deadlineMin} min reached during "${results.current}"`);
  writeResults();
  await driver.shutdown().catch(() => {});
  process.exit(1);
}, deadlineMin * 60_000).unref();

try {
  await runSuite({ driver, results, dataDir, screensDir: args.screens && resolve(args.screens) });
} catch (e) {
  results.tests.push({ name: "harness", ok: false, error: String(e?.stack ?? e) });
  console.log(`FAIL harness: ${e}`);
} finally {
  await driver.shutdown();
}

writeResults();
const ran = results.tests.filter((t) => !t.skipped);
const failed = ran.filter((t) => !t.ok).length;
const skipped = results.tests.length - ran.length;
console.log(`${driver.name} on ${platform}: ${ran.length - failed}/${ran.length} passed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
