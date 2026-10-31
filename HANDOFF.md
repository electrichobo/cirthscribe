# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-30.

## Current Milestone & Goal

**Milestones 0–7 complete (`docs/m7/EXIT_REVIEW.md`). Cross-platform audit & hardening complete.** Next: manual checks and physical hardware runs.

## Completed & Verified

- **macOS & Linux Cross-Platform Hardening (`crates/cirth-core/src/fsutil.rs`, `app/src-tauri/src/main.rs`, `app/src/bindings.ts`, `app/src/main.ts`, `app/src/tour.ts`):**
  - Best-effort Unix parent directory `sync_all` in `replace_file` preventing false I/O errors on APFS, FAT32/exFAT, and network shares.
  - Dual-pulse refocusing (150 ms + 350 ms safety net) on macOS exit from full screen to guarantee WKWebView first-responder status.
  - Native menu label and default shortcut for Full Screen (`Cmd+Ctrl+F` on macOS per Apple HIG; `F11` on Windows/Linux).
  - Robust dual `isMac` detection across `navigator.platform` and `navigator.userAgent`.
  - Software tour dialog flex container width and WebKitGTK / WKWebView Tab / `ISO_Left_Tab` focus trap.
- **Verified:**
  - `cargo test -p cirth-core` (188/188 passed).
  - `npm --prefix app run build` (clean without errors).
  - `cargo build -p cirthscribe --release` (clean).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (357 components passed).
  - `npm --prefix app run e2e:cdp` (84/84 passed).
  - `npm --prefix app run e2e:webdriver` (83/83 passed, 1 skipped: simulated IME).
- **Not verified (carried):**
  - Physical macOS run (N31, M1–M13, D1–D4, N1–N20) and Linux desktop environment run.
  - Manual check N49 (Software tour and non-Latin font rendering); M7 checks N47–N48.

## In-Progress / Uncommitted State

- Documentation updated for cross-platform hardening, compatibility matrix, and manual checks. Ready for commit and push.

## Next Immediate Step

1. Commit and push documentation updates.
2. Coordinate with owner on hardware test environment setup (macOS and Ubuntu 24.04).
