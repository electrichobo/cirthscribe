# Handoff

Working state between agent sessions; see "Session Continuity & Constrained Takeover Protocol" in AGENTS.md. Last updated 2026-10-30.

## Current Milestone & Goal

**Milestones 0–7 complete (`docs/m7/EXIT_REVIEW.md`). Post-M7 Onboarding & Font Packaging complete.** Next: manual checks and owner release review.

## Completed & Verified

- **Software Tour Onboarding (`app/src/tour.ts`, `app/src/main.ts`, `app/src-tauri/src/main.rs`, e2e Test 84):** 6-card interactive tour modal, step-by-step progress, keyboard navigation, skip/complete with localStorage persistence, and re-launchable via `Help > Software Tour…`.
- **Non-Latin Script Screen Font Packaging (`assets/fonts/noto-sans/`, `assets/fonts/noto-serif/`, `app/src/styles.css`, `app/src/a11y.ts`, `docs/m0/LICENSES.md`, `THIRD-PARTY-NOTICES.txt`):** Bundled SIL OFL-1.1 Noto Sans and Noto Serif for full international / non-Western Unicode script coverage across screen fonts.
- **Verified:**
  - `cargo test -p cirth-core` (188/188 passed: 128 unit, 4 golden, 6 layout, 21 migration v1–v16, 29 store).
  - `npm --prefix app run build` (clean without errors; Noto Sans & Serif bundled).
  - `cargo build -p cirthscribe --release` (clean).
  - `npm --prefix app run test:contract` (4/4 passed).
  - `node app/scripts/third-party-notices.mjs --check` (357 components passed).
  - `npm --prefix app run e2e:cdp` (84/84 passed, 0 skipped).
  - `npm --prefix app run e2e:webdriver` (83/83 passed, 1 skipped: simulated IME).
- **Not verified (carried):**
  - Manual check N49 (Software tour and non-Latin script display);
  - M7 checks N47–N48, M6 checks N41–N46, M5 checks N37–N40, M4 checks N32–N36, Mac run (N31), N29, N30.

## In-Progress / Uncommitted State

- Software tour onboarding dialog, non-Latin Noto font packaging, and Test 84 complete and fully verified. Ready for commit and push.

## Next Immediate Step

1. Commit and push: Software tour onboarding dialog and non-Latin font packaging.
2. Align with owner on release review and manual checks execution (`docs/testing/MANUAL_CHECKS.md`).
