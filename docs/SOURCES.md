# Technical reference notes

Checked 2026-10-25. Recheck current documentation and licenses when implementing. Recommendations in this pack are design judgments, not vendor promises.

## Tauri

- Architecture: https://v2.tauri.app/concept/architecture/
- WebView versions: https://v2.tauri.app/reference/webview-versions/
- Process model: https://v2.tauri.app/concept/process-model/

Tauri uses a desktop shell and web UI. Platform WebView implementations differ; do not assume identical pagination from CSS/browser printing across OSes. The Rust domain/UI division is this pack's proposal.

## Structured editor

- ProseMirror guide: https://prosemirror.net/docs/guide/
- API/reference: https://prosemirror.net/docs/ref/

The documented schema/transaction model makes ProseMirror a candidate for structured editing. It does not provide screenplay-specific pagination, production locking, or a complete application by itself. Verify exact packages, versions, and licenses before adoption.

## Avalonia

- Framework: https://avaloniaui.net/
- RichTextEditor: https://avaloniaui.net/rich-text-editor
- Control documentation: https://docs.avaloniaui.net/controls/documents/richtexteditor/
- Editor announcement: https://avaloniaui.net/blog/rich-text-editor
- AvaloniaEdit: https://github.com/AvaloniaUI/AvaloniaEdit

The vendor rich-text control is currently part of Avalonia Pro. Do not conflate the freely available framework with premium controls. A plain/code text editor alone does not establish WYSIWYG screenplay support.

## Google exchange

- Uploads and format conversion: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- Workspace export formats: https://developers.google.com/workspace/drive/api/guides/ref-export-formats

Drive supports conversion routes, but format-conversion support is not a guarantee of page-for-page equivalence, comments round-trip, or live synchronization with an external screenplay editor.

## Feature references from the comparison

- Final Draft features: https://www.finaldraft.com/products/features/
- Final Draft outlining guide: https://kb.finaldraft.com/hc/en-us/articles/15573792158996-How-can-I-outline-a-script-in-Final-Draft
- Movie Magic overview: https://www.write-bros.com/movie-magic-screenwriter.html
- Movie Magic Mac 6.8 limitations: https://techsupport.screenplay.com/hc/en-us/articles/47927672438029-What-s-New-in-Movie-Magic-Screenwriter-6-8
- Story Architect overview: https://starc.app/
- Story Architect review mode: https://starc.app/help/review-mode/
- Story Architect export guide: https://starc.app/help/screenplay-exporting/

Use these as public behavioral references. This pack deliberately contains no competitor pricing. Do not assume public feature descriptions grant rights to copy proprietary implementation or visual assets.

