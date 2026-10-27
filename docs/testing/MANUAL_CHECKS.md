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
| M12 | Fixture "Long script", scroll to the top. Click a scene about halfway down in the scene list, then press Enter. | The script scrolls so that heading is visible; the caret is at the end of the heading; Enter adds an empty line after the heading, not a heading above it. (Fixed after the 2026-10-26 pass; recheck.) |
| M13 | Copy a cue and its dialogue in the script; make an empty Action line; paste. Then on the board (linked mode) press Option+Right on a card and Cmd+Z with the card still focused. | The cue stays a Character block. Cmd+Z restores the scene order without clicking into the script. The scene list and board show headings without numbers. (Fixed after the 2026-10-26 recheck.) |

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
| N1 | Open the File menu | New Project…, Open…, Save, Save As…, Export ▸ (PDF (proof), Plain Text…), Free Writing, Close Project, and Quit (Windows and Linux). Each does what its button does. |
| N2 | File > Quit right after typing | The last words are in the file on reopen (same path as closing the window). |
| N3 | macOS: Edit menu, then Cmd+C / Cmd+V / Cmd+X / Cmd+A in the script | Copy, paste, cut and select-all work; Cmd+Z / Cmd+Shift+Z undo and redo editor changes (not a WebView-level undo). |
| N4 | macOS: CirthScribe app menu | About, Services, Hide, Hide Others, Show All are present. |
| N5 | Click and arrow-key through a dual-dialogue pair (left column, then right) | The caret moves through the left speech, then the right; typing stays in the column you are in. |
| N7 | Help > About CirthScribe and Licences (Windows/Linux); CirthScribe > About CirthScribe (macOS) | The About screen opens with the attribution, GPL tab and third-party licences tab. |
| N8 | Export Plain Text, open the file in Notepad / TextEdit / gedit | Indents line up in a fixed-pitch font; pages are separated by a form feed (some editors show it as a symbol or nothing). |
| N10 | View menu: untick Scene List, Board, Toolbar, Status Bar one at a time; then View > Focus Mode; Escape | Each panel disappears and the script widens; the menu's check marks match what is shown after using the toolbar's View dropdown too. Focus mode is full screen with only the page (no menu bar on Windows and Linux; macOS hides its menu bar itself); Escape restores everything. |
| N11 | Open each menu: File, Edit, View, Format, Help (and the CirthScribe menu on macOS). Use Edit > Cut, Copy, Paste and Select All in the script; Format > Bold on a selection; Format > Page Size > A4, then the toolbar's Page size back to US Letter | Every item does what its label says. The OS's Cut, Copy and Paste act on the script, which needs checking on each OS, especially Windows, where they are sent to the web view as keys. The Page Size check mark moves to follow the toolbar. |
| N12 | Select a word, click B, I and U in the toolbar with the mouse; move the caret in and out of the styled word; pick a type in the toolbar's block-type list | The word is styled, the selection stays, and typing continues in the script. Each button looks pressed only while the caret is in text with that style. The block type changes and the list follows the caret. |
| N9 | macOS: type a word, then press Cmd+Q at once; reopen | The app quits (CirthScribe > Quit CirthScribe), and the word is in the file. File has no Quit on macOS. (Added after the 2026-10-26 pass.) |
| N6 | Free Writing, Flow mode on: type with a real IME (Japanese, Pinyin), then try the trackpad/mouse to select and drag text | Composed text lands at the end; nothing already written is selected, moved or deleted. Esc turns editing back on. |

## 1e. Typing latency (M1 exit test), macOS and Linux desktop

The automated measurement uses DevTools, which only Windows has. On the other systems, the app reports its own measurement.

| # | Steps | Expected |
| - | - | - |
| L1 | Release build, on mains power. Open the sample "The Tide Ledger". Click in the middle of the script and type normally for at least 30 seconds. Then open Help > Typing Latency… and press Copy. | The report shows at least 200 key presses with p95 under 50 ms and "Last open" under 3000 ms. Paste the whole report into the Notes column. Repeat 3 times (Start over between runs), because single-run p99 varies. |

## 1d. Offline (A1), all platforms

The e2e suite checks that the page reaches nothing outside the app and that the content policy refuses outside addresses. It does not switch the network off, because that changes system settings. Do this on a test machine only.

| # | Steps | Expected |
| - | - | - |
| O1 | Disable the network adapter (or unplug it). Start the app, create a project, type, save, close, reopen, export PDF and text, use Free Writing and About. | Everything works; no error, delay or sign-in prompt mentions the network. |
| O2 | With a firewall log or a monitor such as Little Snitch, Wireshark or `ss`, watch the app's process during O1 with the network on. | No connections from CirthScribe's own process. Write down any from the WebView runtime (browser update services, for example) separately. |

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

The automated tests check names, ids, focus movement and what is put in the announcement region; only a real screen reader shows what is actually spoken. **Not part of M1** (owner, 2026-10-26): screen-reader testing (Narrator, VoiceOver, Orca) is dropped for M1. The checklist is kept for whenever it is scheduled. If run, use a test machine: screen readers speak aloud and change input handling.

| # | Steps | Expected |
| - | - | - |
| A1 | Start the app; Tab through Home | Every control is read with a sensible name; project cards read title, file, counts and badges. |
| A2 | Open a sample; type a few words | Typing is not interrupted by save-status announcements. Ctrl+S says "Saved". |
| A3 | In the editor press Tab and Shift+Tab on an empty line | The new block type is spoken ("Character", "Dialogue"...). |
| A4 | Press F6 repeatedly | Toolbar, Scene navigator, Screenplay and Board are reached in turn and their names spoken; Shift+F6 goes back. |
| A5 | Escape from the editor; Up/Down in the scene list; Enter | Scene headings are read (no scene numbers until scene numbers are locked); Enter puts the caret in that scene. |
| A6 | In the scene list press Alt+Down; then Ctrl+Z in the editor | "Scene moved to position N of M" is spoken; undo restores the order. |
| A7 | F6 to the board; arrows; Alt+Right; Enter; Escape | Cards are read with their number, linked scene and summary; the move is spoken with whether the script changed; Enter edits the summary, Escape returns. |
| A8 | View > High Contrast; Ctrl+= twice; Ctrl+0; restart | Strong colours and focus rings; the whole window grows and shrinks; the size and contrast choices survive a restart. |
| A9 | Windows: turn on a Contrast theme in Settings (test machine only) | The app follows the system colours; focus rings, find highlights and spelling underlines stay visible. |
| A10 | Help > About CirthScribe and Licences; Tab and arrow through the tabs | The attribution and licence texts can be reached and read. |

## Results log

| Date | Check | OS / version | WebView | Tester | Result | Notes |
| - | - | - | - | - | - | - |
| | Rows below transcribed on Windows from the macOS session's report; its own log and screenshots stayed on that Mac (no git there, by owner choice). Core tests 46/46, contract 4/4, binary minimum OS 11.0. Big Sur not covered. | | | | | |
| 2026-10-26 | M1–M4, M6–M11 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | Release build of `14a38b5` as an app bundle. |
| 2026-10-26 | M5 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | **Fail** | TextEdit rich text pasted as two Action blocks (WebKit offers RTF as HTML). Fixed in `8e5d006`; recheck. |
| 2026-10-26 | D1–D3 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | Jared operated the Save panel; computer use cannot. |
| 2026-10-26 | D4 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Not run | No synced folder to hand. |
| 2026-10-26 | N1–N5, N8 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass |  |
| 2026-10-26 | N6 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Not run | Needs a real IME (waived). |
| 2026-10-26 | N7 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | **Fail** | About opened but all three tabs were empty (page area collapsed to 0 px). Fixed in `8e5d006`; recheck. |
| 2026-10-26 | L1 ×3 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | p95 24 / 25 / 26 ms; p99 33 / 35 / 42 ms; max 41 / 45 / 48 ms; 0 long tasks; last open 115 ms; on mains power; typed by computer use in bursts. |
| 2026-10-26 | O1, O2 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Not run | Turning Wi-Fi off cuts the computer-use session; needs a person. |
| 2026-10-26 | A1–A10 | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Not run | VoiceOver froze the session; the owner declined section 3. |
| 2026-10-26 | Observations | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | n/a | Cmd+Q did nothing and the app menu had no Quit (fixed in `8e5d006`, recheck N9). Scene-list click did not scroll, and Enter then added an empty heading (fixed, recheck M12). Cmd+Z on the board with board focus does nothing (open). |
| 2026-10-26 | Recheck M5 (`440e982`) | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | Rich-text TextEdit copy: KAITO became Character, the next line Dialogue; italic kept. |
| 2026-10-26 | Recheck N7 (`440e982`) | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | CirthScribe > About CirthScribe: all three tabs show their text. Help > Typing Latency… also shows its report. |
| 2026-10-26 | Recheck M12 (`440e982`) | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | Clicked scene 52 in The Tide Ledger: heading scrolled to the top edge, caret at its end; Enter added an empty Action after it. |
| 2026-10-26 | Recheck N9 (`440e982`) | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | Pass | Typed a word then Cmd+Q at once: quit, word saved in the project file. The app menu has Quit CirthScribe ⌘Q; File has no Quit. |
| 2026-10-26 | Observation (`440e982`) | macOS 26.2 (25C56), M4 Pro | Safari 26.2 / WebKit 21623.1.14.11.9 | Claude (computer use) + Jared | n/a | Pasting CirthScribe's own copy into an empty Action block makes its first block (a cue) an Action: ProseMirror merges the first pasted block into the block it lands in. Probably not new (in-app copies were unchanged by the fix). About dialog height changes between tabs (cosmetic). |
| 2026-10-26 | Section 3, all screen readers | all | | none | **Dropped for M1** | Owner decision: VoiceOver not wanted at all; Narrator and Orca not part of M1. |
| 2026-10-26 | Section 1d, offline (O1, O2) | all | | none | **Deferred (not run)** | Owner decision: skipped for now. Covered meanwhile only by the in-app e2e check (no outside requests; CSP refuses outside addresses). |
| 2026-10-26 | Section 2, real IMEs | all | all | none | **Waived (not run)** | Owner decision: no way to arrange IME test machines. Not a pass; simulated composition only. Run when a tester is available. |
