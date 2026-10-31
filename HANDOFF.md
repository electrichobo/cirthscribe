# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-30.

## Current Milestone & Goal

**Milestones 0–7 complete (`docs/m7/EXIT_REVIEW.md`). Packaging, file associations, drag-and-drop & offline audit complete.** Next: manual checks and physical hardware runs.

## Completed & Verified

- **File Associations, Startup CLI & Drag-and-Drop (`tauri.conf.json`, `main.rs`, `main.ts`, e2e Test 85):**
  - Native file associations registered for `.cirth` (Editor) and `.cirth-review` (Viewer).
  - Bundler configured for Windows NSIS, macOS DMG, and Linux Deb/AppImage.
  - Startup CLI arg parsing and `tauri::WindowEvent::DragDrop` file opening for `.cirth`, `.cirth-review`, `.fountain`, `.fdx`.
- **Automated Offline & Zero-Telemetry Audit (`app/scripts/offline-audit.mjs`):**
  - Audits strict CSP, scans dependencies against tracking SDKs, verifies zero unsolicited network calls, and checks runtime OS socket table (0 external sockets).
- **Verified:**
  - `cargo test -p cirth-core` (188/188 passed).
  - `npm --prefix app run build` (clean without errors).
  - `cargo build -p cirthscribe --release` (clean).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/offline-audit.mjs` (100% passed).
  - `node app/scripts/third-party-notices.mjs --check` (357 components passed).
  - `npm --prefix app run e2e:cdp` (85/85 passed).
  - `npm --prefix app run e2e:webdriver` (84/84 passed, 1 skipped: simulated IME).
- **Not verified (carried):**
  - Physical macOS run (N31, M1–M13, D1–D4, N1–N20) and Linux desktop environment run.
  - Manual check N49 (Software tour and non-Latin font rendering); M7 checks N47–N48.

## In-Progress / Uncommitted State

- File associations, drag-and-drop, bundler configuration, offline audit script, and Test 85 complete and verified. Ready for commit and push.

## Next Immediate Step

1. Commit and push file associations, drag-and-drop, and offline audit script.
2. Coordinate with owner on hardware test environment setup (macOS and Ubuntu 24.04).
