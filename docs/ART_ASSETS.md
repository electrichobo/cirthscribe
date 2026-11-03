# Art assets

What the app needs, with sizes. All art must be original (see AGENTS.md). Keep the editable source files: SVG, or your design tool's file.

## Delivered (owner, 2026-11-02)

The owner delivered 52 files. Each SVG is a wrapper around one embedded PNG (no vector paths), so the app uses them as images. The full-size originals stay with the owner; the repository keeps the 1024 px icon masters (`assets/art/`) and the sizes the app uses. Converted with Windows' built-in .NET imaging (no new tools or dependencies).

The wordmark lettering reads "Kółbítar". The owner confirmed this is a stylization (2026-11-02); the product's text name stays Kolbítar everywhere.

| Delivered | Used as | Where |
| - | - | - |
| `branding/master app logo` | App icon: Windows `.ico`, Linux PNGs (`tauri icon`) | `assets/art/app-icon.png` → `app/src-tauri/icons/` |
| `branding/macos icon` | macOS `.icns` | `assets/art/app-icon-macos.png` → `app/src-tauri/icons/icon.icns` |
| `branding/full wordmark light` / `dark` | Home header and About screen: light themes / dark themes | `app/public/art/brand/` |
| `branding/full wordmark monochrome dark` / `light` | The same under high contrast (white / black background) | `app/public/art/brand/` |
| `windows nsis header`, `windows nsis sidebar welcome` | NSIS installer, 150×57 and 164×314 BMP | `app/src-tauri/installer/` |
| `maxOS retina` | macOS disk image background: 1320×800 px tagged 144 DPI, which Finder draws at 660×400 pt (Retina-sharp). A 72/96 DPI tag makes Finder rescale it. Soft light bands are painted behind Finder's two icon labels (positions measured on macOS 26) so the dark label text reads over the nib and the rock. The window is 660×432 so the 32 pt title bar does not hide the bottom of the art | `app/src-tauri/installer/dmg-background.png` |
| `toolbar/*`, `production_review/*`, `review_newformats/*` | UI icons, 48×48 PNG | `app/public/art/icons/` |
| `branding/project file icon`, `review file icon` | Document icons for `.cirth` and `.cirth-review` files (`tauri icon` → `.ico`, `.icns`) | masters in `assets/art/`; `app/src-tauri/file-icons/` |
| `branding/full wordmark * vertical`, `toolbar/color source` | Not used (no slot yet; `color source` is the brand mark, kept as a colour reference) | owner's copy only |

**UI icons by theme** (owner decisions, 2026-11-02). The art is full-colour, drawn for a light background, so the Day theme and the OS light default show it as delivered. Night, Midnight, OLED and the OS dark default show a `-dark` copy of each icon with blacks and whites swapped and the oranges kept (generated: each pixel is inverted in proportion to how grey it is, so coloured pixels stay and edges stay smooth). High contrast and Windows contrast themes keep the one-colour line drawings in `app/src/icons.ts`, which follow the theme's text colour. The art registry is `ART` in `app/src/icons.ts`; the theme rules are at the end of `app/src/styles.css`.

Wired to a visible control today: home, undo, redo, scenes, board, find, focus, more, font, highlight, comment. Registered for when a control uses them: timeline, bible, storyscry, stripboard, tags, branch, snapshot, grammar, ai. Delivered with no control that shows an icon yet: bookmarks, characters, evidence, lock/unlock pages, lock/unlock scenes, outline, overview, revisions, sides, alternatives, comic, interactive, merge, review package, treatment, typewriter. The text colour menu has no delivered art and keeps its line icon.

**Document icons** (2026-11-02). Tauri 2's file associations have no per-type icon, so:
- Windows: the `.ico` files ship as resources in `file-icons\` (declared in `app/src-tauri/tauri.windows.conf.json`, so only the Windows build carries them), and `app/src-tauri/installer/hooks.nsh` (`NSIS_HOOK_POSTINSTALL`) points each file type's `DefaultIcon` at its own icon after the associations are written. Uninstall removes the whole file-type key.
- macOS: Finder sends a double-clicked file as an Opened event, which `main.rs` passes to the UI (held for the UI's startup call on a cold launch). `app/src-tauri/Info.plist`, which Tauri merges into the app's, declares both document types and exported UTIs (`org.cirthscribe.cirth`, `org.cirthscribe.cirth-review`) with their icons; `bundle.macOS.files` copies the `.icns` into `Contents/Resources`. Keep it in step with `bundle.fileAssociations`.

**Not done:**
- Document icons on Linux. The `.deb` and AppImage register the file types but not their icons (that needs shared-mime-info XML and icon theme files).
- One-colour vector versions of the UI icons, which would let high-contrast themes show the art too.

## Original request (2026-10-26)

## 1. App identity

| Asset | Deliver | Notes |
| - | - | - |
| App icon | One 1024×1024 PNG with a transparent background, or an SVG master | `tauri icon` generates every size from it: Windows `.ico` (16–256), macOS `.icns`, and the Linux PNGs. It must stay readable at 16 and 32 px (taskbar, title bar). If the detail does not survive, also deliver a simplified 32×32 version. |
| macOS icon shape | The same master, laid out on Apple's grid | Artwork inside a rounded square of about 824×824, centred on the 1024 canvas, with about 100 px of transparent margin. macOS 26 may put icons without this shape inside a grey rounded square (to be checked on a Mac). |
| Project file icon (`.cirth`) | 1024×1024 PNG or SVG | Shown in Explorer, Finder and file managers for project files. Usually a document shape carrying the app mark. Needed when installers are built (file association). |
| Logo, full | SVG, with lettering converted to outlines | Mark plus wordmark, for the Home screen and the About screen. Outlining means no font licence ships with it. |
| Logo, mark only | SVG | For small places (Home header, the About title). |
| Logo variants | SVG | One for light backgrounds, one for dark, and a single-colour version for high contrast. |

## 2. Installers (later: packaging stage, not M1)

| Asset | Size |
| - | - |
| Windows installer header (NSIS) | 150×57 BMP |
| Windows installer sidebar (NSIS) | 164×314 BMP |
| macOS disk image background | 660×400 PNG, plus a 1320×800 version for Retina screens |

## 3. UI icons

**Format:** SVG on a 24×24 grid, with 2 px strokes and about 2 px of empty margin (the drawing sits in the middle 20×20). One colour, drawn with `currentColor`, so icons follow light, dark and high-contrast themes and Windows contrast themes. They display at about 20 px and scale with the interface size (80–200%). Keep stroke weight, corner radius and detail consistent across the set. Every control keeps its text name for keyboard and screen-reader users, so icons only change how a button looks.

Names below are suggested file names. Shared icons are listed once, with every place that uses them.

### Main toolbar
| File | Action |
| - | - |
| `home.svg` | Home (save and close the project) |
| `free-writing.svg` | Free Writing |
| `save.svg` | Save |
| `save-as.svg` | Save As |
| `export-pdf.svg` | Export PDF (proof) |
| `export-text.svg` | Export plain text (also Free Writing's "Export .txt") |
| `find.svg` | Find and replace (also Free Writing's search box) |
| `view-continuous.svg`, `view-pages.svg` | View: continuous or page gaps |
| `zoom.svg` | Editor zoom slider |
| `link.svg`, `unlink.svg` | "Board may reorder script" on/off (`link.svg` is also the board's "go to linked scene") |
| `spelling.svg` | Spelling language (optional; it is a dropdown) |

### Find bar
| File | Action |
| - | - |
| `arrow-up.svg`, `arrow-down.svg` | Previous / next match (also the scene list's move up / move down) |
| `replace.svg` | Replace one |
| `replace-all.svg` | Replace all |
| `match-case.svg` | Match case ("Aa") |
| `whole-word.svg` | Whole word |
| `close.svg` | Close (also dialogs and "Remove from list") |

### Scene list and board
| File | Action |
| - | - |
| `arrow-left.svg`, `arrow-right.svg` | Move card earlier / later (also Free Writing's "Back") |
| `plus.svg` | New beat (also New project, New piece) |
| `link-broken.svg` | "Linked scene no longer exists" |
| `badge-planning.svg`, `badge-linked.svg` | Board mode badge: planning only / moves reorder the script (optional) |

### Home
| File | Action |
| - | - |
| `open-file.svg` | Open a project file |
| `sample.svg` | Sample projects |
| `recovered.svg` | Card badge: recovered unsaved work |
| `outside-library.svg` | Card badge: file kept outside the library |
| `older-format.svg` | Card badge: older file format, upgraded on open |
| `missing-file.svg` | Recent file not found |
| `backups.svg` | Backups list / restore as a copy |
| `info.svg` | About Kolbítar and licences |

### Free Writing
| File | Action |
| - | - |
| `folder-new.svg` | New folder (`folder.svg` for folders in the list) |
| `trash.svg` | Trash |
| `restore.svg` | Restore from Trash |
| `copy-into-project.svg` | Copy into project |
| `move-into-project.svg` | Move into project |
| `flow-mode.svg` | Flow mode |

### Status and messages
| File | Action |
| - | - |
| `saved.svg` | Saved (status line) |
| `saving.svg` | Saving / pending |
| `warning.svg` | Error or warning banner |
| `copy.svg` | Copy (Typing Latency report) |
| `dictionary-add.svg` | Spelling: add to dictionary |

That is about 45 icon files. A first pass can use only the main toolbar, find bar, scene list and board icons (about 22). Native menus (File, Edit, View, Help) do not use icons.

## How they will be used (not decided yet)

The main toolbar keeps a text label beside each icon, or shows the text in a tooltip; this is the owner's call. Small repeated controls (find bar, move arrows, close) can be icon-only, with their existing names for keyboard and screen-reader users. Before any icon ships, check every theme, including high contrast and Windows contrast themes.
