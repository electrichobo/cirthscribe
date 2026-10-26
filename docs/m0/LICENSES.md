# Dependency, font and tool license inventory (M0)

Generated 2026-10-26 (after adding spellbook 0.4.2, MPL-2.0, and the SCOWL dictionaries) by `node app/scripts/license-inventory.mjs` from `Cargo.lock` / `cargo metadata` and `app/package-lock.json`. License fields are as declared by each package; they have not been audited file by file. Re-run on every dependency change.

## Not from package managers

| Item | License | Shipped? | Notes |
| - | - | - | - |
| Courier Prime (4 styles), `assets/fonts/courier-prime/` | SIL OFL 1.1 (`OFL.txt` included) | Yes (embedded in the app and in PDFs) | From github.com/google/fonts `ofl/courierprime`. Font name may not be reused for modified versions. |
| SCOWL Hunspell dictionaries en_US-large and en_GB-large 2026.02.25, `assets/dictionaries/` | Copyright 2000-2026 Kevin Atkinson; permissive notice: copy, modify, distribute, sell, provided the copyright notice and permission notice appear in copies and supporting documentation. Affix file: BSD-style (Geoff Kuenning; modified versions must be marked). Full text in each `README_*.txt` | Yes (embedded in the app) | From github.com/en-wl/wordlist releases. Keep the README files with the dictionaries and this notice in release documentation. |
| SQLite (bundled by `libsqlite3-sys`) | Public domain | Yes | |
| Microsoft Edge WebView2 Runtime | Microsoft proprietary | No (system component on Windows 11) | Required at runtime on Windows |
| `WebView2Loader.dll` | Microsoft WebView2 SDK license (redistributable) | Only for GNU-toolchain builds | MSVC builds link the loader statically |
| Rust toolchain 1.99.1 (GNU host), WinLibs MinGW-w64 GCC 16.2.0 UCRT, Node.js 24.22.1 | Various open source | No (build only) | Installed for the spike in `.tools/` (gitignored) and per-user `~/.rustup`, `~/.cargo` |
| pypdf 5.4.0 | BSD-3-Clause | No | Used once to check PDF text extraction, in a throwaway venv |

Coverage note: the Rust table resolves dependencies for Windows (x86_64-pc-windows-gnu). Linux and macOS builds pull different platform crates (for example `rfd`'s XDG portal or GTK backend for file dialogs); run the script with their target triples before a release.

## Items to review

- **MPL-2.0** (file-level copyleft): `spellbook` (spell checking, chosen in ADR 0002), `cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` (via Tauri), `option-ext` (via `dirs`). Distributable in binaries; modified MPL files must stay MPL. Note when choosing the project license.
- Build-only MPL-2.0: `lightningcss` (Vite), not shipped.
- No GPL/LGPL, unknown or proprietary packages in the Rust graph or the shipped JS.
## Rust crates (resolved for x86_64-pc-windows-gnu): 269

| License expression | Count | Crates (first 8) |
| - | - | - |
| MIT OR Apache-2.0 | 131 | anyhow 1.0.104, base64 0.23.1, bitflags 2.13.2, block-buffer 0.10.4, bstr 1.13.1, camino 1.2.6, cargo-platform 0.1.9, cc 1.10.0, ... |
| MIT | 46 | bytes 1.12.1, cargo_metadata 0.19.2, cfb 0.14.0, darling 0.24.1, darling_core 0.24.1, darling_macro 0.24.1, derive_more 2.1.1, derive_more-impl 2.1.1, ... |
| Apache-2.0 OR MIT | 28 | autocfg 1.5.1, bit-set 0.8.0, bit-vec 0.8.0, cargo_toml 1.0.1, ctor 1.0.13, equivalent 1.0.3, fastrand 2.5.0, idna_adapter 1.2.2, ... |
| Unicode-3.0 | 18 | icu_collections 2.4.0, icu_locale_core 2.4.0, icu_normalizer 2.4.0, icu_normalizer_data 2.4.0, icu_properties 2.4.0, icu_properties_data 2.4.0, icu_provider 2.4.0, litemap 0.8.3, ... |
| MIT/Apache-2.0 | 10 | bitflags 1.3.2, bs58 0.5.1, core_detect 1.0.0, fallible-iterator 0.3.0, fallible-streaming-iterator 0.1.9, ident_case 1.0.1, json-patch 4.2.0, linked-hash-map 0.5.6, ... |
| Unlicense OR MIT | 8 | aho-corasick 1.1.5, byteorder 1.5.0, jiff 0.2.38, jiff-core 0.1.1, jiff-tzdb 0.1.9, jiff-tzdb-platform 0.1.3, memchr 2.8.3, winapi-util 0.1.11 |
| MPL-2.0 **review** | 6 | cssparser 0.37.0, cssparser-macros 0.7.1, dtoa-short 0.3.5, option-ext 0.2.0, selectors 0.38.0, spellbook 0.4.2 |
| BSD-3-Clause | 2 | alloc-no-stdlib 3.0.0, alloc-stdlib 0.3.0 |
| Zlib | 2 | foldhash 0.2.0, zlib-rs 0.6.8 |
| MIT OR Zlib OR Apache-2.0 | 2 | miniz_oxide 0.8.9, miniz_oxide 0.9.1 |
| Apache-2.0 | 2 | owned_ttf_parser 0.19.0, tao 0.37.2 |
| MIT OR Apache-2.0 OR Zlib | 2 | raw-window-handle 0.6.2, static_vcruntime 3.0.0 |
| Unlicense/MIT | 2 | same-file 1.0.6, walkdir 2.5.0 |
| 0BSD OR MIT OR Apache-2.0 | 1 | adler2 2.0.1 |
| BSD-3-Clause AND MIT | 1 | brotli 9.1.0 |
| BSD-3-Clause/MIT | 1 | brotli-decompressor 6.2.0 |
| Apache-2.0 AND MIT | 1 | dpi 0.1.2 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 1 | dunce 1.0.5 |
| (Apache-2.0 OR MIT) AND BSD-3-Clause | 1 | encoding_rs 0.8.42 |
| Apache-2.0 / MIT | 1 | fnv 1.0.7 |
| Apache-2.0/MIT | 1 | md5 0.7.0 |
| Zlib OR Apache-2.0 OR MIT | 1 | tinyvec 1.13.3 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 | unicode-ident 1.0.27 |

## npm packages shipped in the app bundle: 12

| License | Count | Packages |
| - | - | - |
| MIT | 10 | orderedmap 2.1.1, prosemirror-commands 1.7.2, prosemirror-history 1.5.1, prosemirror-keymap 1.2.3, prosemirror-model 1.25.12, prosemirror-state 1.4.4, prosemirror-transform 1.12.4, prosemirror-view 1.42.8, rope-sequence 1.3.4, w3c-keyname 2.2.8 |
| Apache-2.0 OR MIT | 1 | @tauri-apps/api 2.12.4 |
| MIT OR Apache-2.0 | 1 | @tauri-apps/plugin-dialog 2.8.3 |

## npm build-only tools (not shipped): 73

| License | Count | Packages |
| - | - | - |
| MIT | 25 | @oxc-project/types 0.155.0, @rolldown/binding-android-arm-eabi 1.2.15, @rolldown/binding-android-arm64 1.2.15, @rolldown/binding-darwin-arm64 1.2.15, @rolldown/binding-darwin-x64 1.2.15, @rolldown/binding-freebsd-x64 1.2.15, @rolldown/binding-linux-arm-gnueabihf 1.2.15, @rolldown/binding-linux-arm64-gnu 1.2.15, @rolldown/binding-linux-arm64-musl 1.2.15, @rolldown/binding-linux-ppc64-gnu 1.2.15, ... |
| Apache-2.0 | 22 | @typescript/typescript-aix-ppc64 7.0.2, @typescript/typescript-darwin-arm64 7.0.2, @typescript/typescript-darwin-x64 7.0.2, @typescript/typescript-freebsd-arm64 7.0.2, @typescript/typescript-freebsd-x64 7.0.2, @typescript/typescript-linux-arm 7.0.2, @typescript/typescript-linux-arm64 7.0.2, @typescript/typescript-linux-loong64 7.0.2, @typescript/typescript-linux-mips64el 7.0.2, @typescript/typescript-linux-ppc64 7.0.2, ... |
| Apache-2.0 OR MIT | 12 | @tauri-apps/cli 2.12.4, @tauri-apps/cli-darwin-arm64 2.12.4, @tauri-apps/cli-darwin-x64 2.12.4, @tauri-apps/cli-linux-arm-gnueabihf 2.12.4, @tauri-apps/cli-linux-arm64-gnu 2.12.4, @tauri-apps/cli-linux-arm64-musl 2.12.4, @tauri-apps/cli-linux-riscv64-gnu 2.12.4, @tauri-apps/cli-linux-x64-gnu 2.12.4, @tauri-apps/cli-linux-x64-musl 2.12.4, @tauri-apps/cli-win32-arm64-msvc 2.12.4, ... |
| MPL-2.0 **review** | 12 | lightningcss 1.33.0, lightningcss-android-arm64 1.33.0, lightningcss-darwin-arm64 1.33.0, lightningcss-darwin-x64 1.33.0, lightningcss-freebsd-x64 1.33.0, lightningcss-linux-arm-gnueabihf 1.33.0, lightningcss-linux-arm64-gnu 1.33.0, lightningcss-linux-arm64-musl 1.33.0, lightningcss-linux-x64-gnu 1.33.0, lightningcss-linux-x64-musl 1.33.0, ... |
| ISC | 1 | picocolors 1.1.1 |
| BSD-3-Clause | 1 | source-map-js 1.2.2 |
