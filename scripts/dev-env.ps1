# Session-only toolchain PATH for local development on Windows without a
# system-wide install. Expects portable Node and WinLibs MinGW-w64 unpacked in
# .tools/ (gitignored) and Rust from rustup in the user profile. Dot-source it:
#   . .\scripts\dev-env.ps1
$root = Split-Path -Parent $PSScriptRoot
$node = Get-ChildItem "$root\.tools" -Directory -Filter "node-v*-win-x64" -ErrorAction SilentlyContinue | Select-Object -First 1
$env:PATH = "$($node.FullName);$root\.tools\mingw64\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$root\target"
