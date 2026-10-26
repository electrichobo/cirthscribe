# ADR 0001: Desktop stack and editor

Status: accepted for M1 on Windows evidence; macOS and Linux verification is an M1 exit gate (revisit triggers below).
Date: 2026-10-25

## Problem

Choose the desktop framework, editor and layout approach once, with evidence from the risky parts: structured editing, selection, IME, clipboard, undo, long documents, persistence, pagination and PDF.

## Options considered

1. **Rust + Tauri 2 + TypeScript + ProseMirror** (preferred hypothesis). Spiked.
2. **C# + Avalonia**. Not spiked. The free framework has no rich-text editor: Avalonia's RichTextEditor is a Pro (paid) component, which the project rules exclude. AvaloniaEdit is a code/text editor, not a typed, paginated screenplay editor, so we would have to write the editor ourselves. The preferred stack showed no blocking risk, so ARCHITECTURE.md's rule ("build only the smallest competing experiment for a blocking risk") did not trigger a competing build.

## Evidence and tested platforms

See `docs/m0/FINDINGS.md`. Windows 11 / WebView2 155 only:
- Typed blocks, Tab/Enter cycles, selection, paste (plain, HTML, OS clipboard), Unicode, simulated IME, single undo stack: passing end-to-end tests in the real WebView.
- 127-page fixture: p95 input-to-paint 29.7 ms (budget 50), warm open 65 ms, no long tasks during autosave.
- Process kill after acknowledged commit: recovered. Second writer: refused.
- Pagination in Rust is deterministic and independent of the WebView, zoom and OS fonts (fixed-pitch profile, bundled font); PDF draws the same page map.

Untested: macOS WKWebView, Linux WebKitGTK, real IMEs, screen readers, MSVC-built Windows binaries.

## Decision

- Desktop shell: **Tauri 2** (Rust).
- Editor: **ProseMirror** (MIT), one textblock node type with a `kind` attribute; one undo stack in the editor; every change reaches Rust as a versioned batch.
- Domain, persistence, layout and PDF: **Rust**, in `cirth-core`, independent of Tauri and of the editor.
- Pagination authority: **the Rust layout engine**. The WebView never measures pages. Browser print is not used for output.
- Working store: **SQLite** (bundled via rusqlite); see `docs/m0/SCHEMA.md`.
- Windows release builds use the **MSVC** toolchain in CI. The GNU toolchain is a local development option for machines that must not get Visual Studio Build Tools (it works, but needs `WebView2Loader.dll` shipped beside the exe and gives a manifest-merge linker warning).

## Dependency and license implications

Shipped JavaScript is MIT or Apache-2.0/MIT. Rust dependencies are permissive except five MPL-2.0 crates pulled in by Tauri and `dirs` (file-level copyleft; compatible with distribution; owner should note them when choosing the project license). Bundled font: Courier Prime, SIL OFL 1.1. WebView2 runtime is a Microsoft system component, not redistributed by us. Details: `docs/m0/LICENSES.md`. No paid component is required to build.

## Consequences and remaining limitations

- Editor behavior depends on three WebView engines; each needs its own test pass.
- One intermittent selection defect is open (native End right after typing; FINDINGS, open defect 1).
- Fixed-pitch layout makes cross-platform pagination deterministic but means non-Latin scripts need a fallback-font plan with known metrics before they can be paginated honestly.
- TypeScript and Rust both hold block structure; the boundary types are mirrored by hand (`app/src/schema.ts`, `crates/cirth-core/src/model.rs`) and need a contract test.

## Revisit triggers

- WKWebView or WebKitGTK cannot pass the A3 editing checks (selection, IME, clipboard) after reasonable fixes.
- The End-key defect turns out to be a WebView-level selection bug we cannot work around.
- p95 input latency exceeds 50 ms on the minimum supported hardware.
- A requirement appears that needs proportional fonts in authoritative layout.

A switch needs a written reason and owner agreement (CLAUDE.md).

## Linked acceptance scenarios

A2, A3, A5, A6, A7, B1, B2, B3, D1, D2, H6.
