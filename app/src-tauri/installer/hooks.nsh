; NSIS installer hooks (bundle.windows.nsis.installerHooks).
; Kept ASCII-only: the file-type class names contain an accented letter, so they are
; read back from the registry instead of being spelled here.

!macro NSIS_HOOK_POSTINSTALL
  ; Give .cirth and .cirth-review files their own document icons (docs/ART_ASSETS.md).
  ; The file associations above point at the app icon; replace that per class.
  Push $0
  ReadRegStr $0 SHCTX "Software\Classes\.cirth" ""
  StrCmp $0 "" +2
    WriteRegStr SHCTX "Software\Classes\$0\DefaultIcon" "" '"$INSTDIR\file-icons\cirth.ico",0'
  ReadRegStr $0 SHCTX "Software\Classes\.cirth-review" ""
  StrCmp $0 "" +2
    WriteRegStr SHCTX "Software\Classes\$0\DefaultIcon" "" '"$INSTDIR\file-icons\cirth-review.ico",0'
  Pop $0
  ; Tell Explorer the icons changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
