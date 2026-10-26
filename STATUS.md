# Status

Updated 2026-10-25.

**Current milestone: M1 in progress (plan: `docs/M1_PLAN.md`). M0 complete on Windows only.**

M1 progress:
- 1.1 done: End-key selection defect fixed; regression and stress tests.
- 1.2 built: driver-neutral e2e suite with DevTools and WebDriver drivers; passes on Windows through both. Linux runs in CI (not run yet); macOS is a manual checklist (not run yet).
- 1.3 CI: Linux green (WebKitGTK e2e 14/14, IME skipped); macOS green (core tests, build); Windows builds and core tests green with MSVC, but e2e cannot start WebView2 on the GitHub runner. Windows e2e steps are non-blocking in CI (10-minute cap); Windows e2e is run locally on a desktop session until this is solved.

- 2 started: Home screen (project library) at startup: lists projects in the app's library folder with scene/block counts, modified time and a recovery badge; creates projects (titles never overwrite an existing file); opens samples; the toolbar's Home button saves and closes the project. Opening files from elsewhere on disk (file dialogs) is not built yet.

Next: green CI on all three platforms, then the macOS manual pass and the real-IME checklist on test machines.

The repository contains a feasibility spike, not a usable application. Nothing here is a release.

| Item | Where |
| - | - |
| Findings, measurements, platform coverage, defects, risks | `docs/m0/FINDINGS.md` |
| Framework decision | `docs/adr/0001-desktop-stack.md` |
| Native schema and container proposal | `docs/m0/SCHEMA.md` |
| Dependency, font and tool licenses | `docs/m0/LICENSES.md` |
| Synthetic fixtures (original text) | `fixtures/` (regenerate: `cirth-cli gen-fixtures fixtures`) |

## Open defects

1. GNU-toolchain linker warning about manifests (Windows dev builds only).
2. Windows e2e on the GitHub-hosted runner: WebView2 does not start; the e2e runner's own deadline also failed to fire there. Non-blocking in CI; see `docs/M1_PLAN.md` 1.3.

Fixed: native End key right after typing missed by the editor (M1, see `docs/m0/FINDINGS.md`).

## Untested

macOS editing (manual checklist not yet run), real IMEs, screen readers, high DPI. Linux is covered by CI (WebKitGTK under Xvfb on Ubuntu 24.04), not by a desktop session.

## How to run (Windows, dev machine)

Toolchains are local to this checkout and the user profile; nothing is installed system-wide. In PowerShell:

```
. .\scripts\dev-env.ps1
cargo test -p cirth-core
cd app; npm ci; npm run build; cd ..
cargo build -p cirthscribe --release
target\release\cirthscribe.exe
cd app; npm run e2e:cdp
npm run e2e:webdriver   # needs tauri-driver (cargo install tauri-driver) and msedgedriver matching your WebView2 version on PATH
```
