# Manual checks

Automated end-to-end tests run through WebDriver (Linux, Windows) and the DevTools protocol (Windows) in `app/tests/e2e/`. Some things no driver can do honestly. They are checked by hand and recorded here, with date, OS and version, tester, and result. Never mark a row passed without a run.

## 1. macOS (WKWebView): full editing pass

Tauri has no WebDriver for WKWebView, so macOS editing is manual until that changes.

Build: `cargo test -p cirth-core`, `cd app && npm ci && npm run build`, `cargo build -p cirthscribe --release`, run `target/release/cirthscribe`.

| # | Steps | Expected |
| - | - | - |
| M1 | Fixture "Unicode and marks". Click at the end of the last block. Enter, Tab, type `Noor`, Enter, Tab, type `softly`, press End (Cmd+Right), Enter. | `(softly)` is intact; a new empty dialogue block follows. |
| M2 | Enter; Tab cycles action → character → transition → heading → action. Shift+Tab reverses. | Types change; no spaces inserted. |
| M3 | Type in an action block, wait 1 s, Shift+Tab, Cmd+Z, Cmd+Shift+Z. | Undo restores action with the same text; redo restores heading. |
| M4 | Select from the middle of one block into the middle of the next-but-one; type `X`; Cmd+Z. | Blocks join with `X`; undo restores all three exactly. |
| M5 | Copy two lines from TextEdit (`KAITO` newline `The clipboard came from the OS.`), paste at the end. | A character block and a dialogue block. |
| M6 | Select those two blocks, Cmd+C, paste into TextEdit. | `KAITO`, blank line, the dialogue. |
| M7 | Type `Zoë ñ é` and paste `👍🏽 👩‍👩‍👧 漢字 שלום مرحبا`. Backspace once after the family emoji. | Text stored intact (restart and reopen); one Backspace removes the whole emoji. |
| M8 | Board: toggle off, move a card. Toggle on, move a card before another. Cmd+Z. | Off: script order unchanged, "Planning only" visible. On: scene moves once; one undo restores. |
| M9 | Fixture "Long script". Type fast in the middle for 30 s. | No visible lag or dropped characters. |
| M10 | Type a marker, wait for "Stored", Force Quit the app, reopen. | Recovery notice; the marker is present. |
| M11 | Open a second copy of the app. | It reports the project is open elsewhere. |

## 2. Real input methods (all platforms)

Automated IME coverage is simulated composition (DevTools, Windows only). Real IMEs need a test machine where adding input languages is allowed (not the owner's production machine).

| IME | Platforms | Steps | Expected |
| - | - | - | - |
| Japanese (Microsoft IME / macOS Kotoeri / Mozc via IBus or Fcitx) | Win, Mac, Linux | In a dialogue block type `nihon` and convert to 日本; then type `kanji` mid-word and convert; commit; Enter | Committed text appears once; no stray kana; caret after the commit; Enter creates the next block only after commit |
| Chinese Pinyin | Win, Mac, Linux | Type `zhongwen`, pick 中文 from the candidate list with the mouse and with number keys | Same as above |
| Korean (2-set) | Win, Mac, Linux | Type `gks` (한) then a space and more syllables | Syllables compose in place; Backspace edits the last jamo |
| Any IME | all | Start composing, then click elsewhere in the script | Composition commits or cancels cleanly; no duplicated text |
| Any IME | all | Compose in a block while autosave runs (type, pause 1 s, compose) | Saved text equals the visible text after reopen |

## 3. Accessibility (M1 item 6)

Narrator (Windows), VoiceOver (macOS), Orca (Linux): navigator, editor, board and toolbar are reachable by keyboard, announce their names, and announce save status changes.

## Results log

| Date | Check | OS / version | WebView | Tester | Result | Notes |
| - | - | - | - | - | - | - |
| | | | | | | |
