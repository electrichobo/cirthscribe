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

## 1b. Native Open and Save As dialogs (all platforms)

The e2e suite calls the same open/save-as commands with a path; it cannot drive the OS dialogs. Check by hand on each OS:

| # | Steps | Expected |
| - | - | - |
| D1 | Home, "Open a project file…" | System dialog filtered to `.cirth`; choosing a file opens it; Cancel does nothing. |
| D2 | In a project, "Save As…", pick a new folder and name | The toolbar title stays; the file appears there; Home lists it with "Outside library". |
| D3 | Save As over an existing `.cirth` | The dialog asks to confirm overwrite; after confirming, the old file is in the app's backups folder. |
| D4 | Open a project from a synced folder (OneDrive, Dropbox, iCloud), edit it on another machine, then save here | "changed outside" warning; Save writes "(conflict …)" beside it; the synced version is untouched. |

## 1c. Native menus (all platforms)

Tests run the menu actions through the same handler (`__cirth.menu(id)`); the OS menus themselves are checked by hand.

| # | Steps | Expected |
| - | - | - |
| N1 | Open the File menu | New Project…, Open…, Save, Save As…, Export PDF (proof), Close Project, Quit. Each does what its button does. |
| N2 | File > Quit right after typing | The last words are in the file on reopen (same path as closing the window). |
| N3 | macOS: Edit menu, then Cmd+C / Cmd+V / Cmd+X / Cmd+A in the script | Copy, paste, cut and select-all work; Cmd+Z / Cmd+Shift+Z undo and redo editor changes (not a WebView-level undo). |
| N4 | macOS: CirthScribe app menu | About, Services, Hide, Hide Others, Show All are present. |
| N5 | Click and arrow-key through a dual-dialogue pair (left column, then right) | The caret moves through the left speech, then the right; typing stays in the column you are in. |

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
