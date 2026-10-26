# Status

Updated 2026-10-25.

**Current milestone: M1 in progress (plan: `docs/M1_PLAN.md`). M0 complete on Windows only.**

M1 progress: item 1.1 done (End-key selection defect fixed, regression and stress tests added). Next: 1.2 cross-platform harness, 1.3 CI builds.

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
cd app; node tests/e2e.mjs ..\target\release\cirthscribe.exe ..\out\e2e-results.json ..\out\screens
```
