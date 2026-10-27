# Art assets

What the app needs, with sizes. Status 2026-10-26: none of these exist yet. The app icon is a 64 px placeholder, and every UI control is text or a Unicode arrow. All art must be original (see CLAUDE.md). Keep the editable source files: SVG, or your design tool's file.

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
| `info.svg` | About CirthScribe and licences |

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
