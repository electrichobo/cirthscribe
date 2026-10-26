# Status

Updated 2026-10-25.

**Current milestone: M1 in progress (plan: `docs/M1_PLAN.md`). M0 complete on Windows only.**

M1 progress:
- 1.1 done: End-key selection defect fixed; regression and stress tests.
- 1.2 built: driver-neutral e2e suite with DevTools and WebDriver drivers; passes on Windows through both. Linux runs in CI (not run yet); macOS is a manual checklist (not run yet).
- 1.3 started: CI workflow for Linux, Windows (MSVC) and macOS written, not run yet.

Next: first CI run, then the macOS manual pass and the real-IME checklist on test machines.

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

Fixed: native End key right after typing missed by the editor (M1, see `docs/m0/FINDINGS.md`).

## Untested

macOS, Linux, MSVC-built Windows binaries, real IMEs, screen readers, high DPI.

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
