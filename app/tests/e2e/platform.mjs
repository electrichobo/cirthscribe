// Platform helpers shared by both drivers: hard kill, OS clipboard, and the
// primary shortcut modifier.

import { execFileSync } from "node:child_process";

export const platform = process.platform; // win32 | linux | darwin
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ProseMirror's "Mod": Cmd on macOS, Ctrl elsewhere. */
export const MOD_KEY = platform === "darwin" ? "meta" : "ctrl";

export class Skip extends Error {}

/** Hard kill (no clean shutdown): the app and its WebView child processes. */
export function hardKill(pid) {
  try {
    if (platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    else execFileSync("kill", ["-9", String(pid)], { stdio: "ignore" });
  } catch {}
}

function has(cmd) {
  try {
    execFileSync(platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Returns null when this machine has no usable clipboard tool. */
export function clipboardTool() {
  if (platform === "win32") {
    return {
      set: (s) => execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value $env:CIRTH_CLIP"], { env: { ...process.env, CIRTH_CLIP: s } }),
      get: () => execFileSync("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"]).toString("utf8").replace(/\r?\n$/, ""),
    };
  }
  if (platform === "darwin") return { set: (s) => execFileSync("pbcopy", { input: s }), get: () => execFileSync("pbpaste").toString("utf8") };
  if (has("xclip")) {
    return {
      set: (s) => execFileSync("xclip", ["-selection", "clipboard"], { input: s }),
      get: () => execFileSync("xclip", ["-selection", "clipboard", "-o"]).toString("utf8"),
    };
  }
  return null;
}
