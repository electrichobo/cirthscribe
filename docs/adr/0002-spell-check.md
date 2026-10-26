# ADR 0002: Spell checking

Status: accepted (owner decision, 2026-10-26)
Date: 2026-10-26

## Problem

M1 needs offline spell checking with US and UK English, project names, a personal dictionary, ignored words and undoable corrections (PRODUCT_SPEC 2), consistent on Windows, macOS and Linux.

## Options considered

spellbook (pure Rust) with SCOWL dictionaries; the built-in WebView spell checker; the Hunspell C library through bindings; JavaScript checkers (nspell, typo.js); zspell. Comparison and measurements: `docs/m1/spellcheck-options.md`.

## Evidence

Windows only, i9-9900K, release builds. 127-page synthetic script: whole-script check 3.3 ms in Rust, about 32 ms including the round trip from the editor; dictionary load about 12 ms; suggestions 11 to 28 ms per word. US and UK separate correctly. The built-in WebView2 checker follows the OS language, offers no project dictionary we could find, and skips all-caps words. macOS and Linux: core tests run in CI; the editor behaviour is covered by the Linux e2e run (WebKitGTK) once pushed.

## Decision

`spellbook = "=0.4.2"` (MPL-2.0) in `cirth-core`, with SCOWL `en_US-large` and `en_GB-large` 2026.02.25 embedded in the binary. Checking runs in Rust (`cirth_core::spell`); the editor draws underlines as decorations and offers corrections. Language is a project setting (US, UK, off), separate from page size. Project dictionary in the project's settings; personal dictionary in the app data folder; character cue names accepted automatically; Ignore lasts until the project is closed.

## Consequences

- One more MPL-2.0 dependency (file-level copyleft; distributable; noted for the project licence decision).
- spellbook is labelled alpha: the version is pinned exactly; an upgrade needs the spell tests to pass.
- No phonetic suggestions. English only. Words with combining marks (decomposed accents) are not checked rather than wrongly marked. The UK "large" list accepts both -ise and -ize.
- About 1.7 MB of dictionary text in the binary.

## Revisit triggers

A required language without a Hunspell dictionary; spellbook unmaintained or a licence change; suggestion quality complaints that phonetic matching would fix.
