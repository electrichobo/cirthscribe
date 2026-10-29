@echo off
setlocal
set ROOT=%~dp0..
for /d %%D in ("%ROOT%\.tools\node-v*-win-x64") do set NODE_DIR=%%D
set "PATH=%NODE_DIR%;%ROOT%\.tools\mingw64\bin;%ROOT%\.tools\msedgedriver;%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_DIR=%ROOT%\target"
%*
