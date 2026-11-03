#!/bin/sh
# Register Kolbítar's document types and their icons (best effort: a missing tool
# only means the icons appear after the next desktop session).
set -e
if command -v update-mime-database >/dev/null 2>&1; then update-mime-database /usr/share/mime || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
exit 0
