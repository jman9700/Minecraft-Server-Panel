@echo off
REM Starts Caddy and the panel.
REM
REM Lives in scripts\ but operates on mcpanel0.5\minecraft-panel, resolved
REM relative to this file rather than the working directory -- so it works
REM however it is launched, including from Task Scheduler or a shortcut,
REM which start you in C:\Windows\System32.
REM
REM Both processes need the panel directory as their working directory:
REM Caddy reads Caddyfile from there, and `npm start` needs that
REM package.json. `start /d` sets it for the Caddy window; `cd /d` sets it
REM for this one.

setlocal

REM %~dp0 is this script's folder, with a trailing backslash.
REM %%~fI collapses the "scripts\..\" so messages show a clean path.
for %%I in ("%~dp0..\mcpanel0.5\minecraft-panel") do set "PANEL_DIR=%%~fI"

if not exist "%PANEL_DIR%\package.json" (
  echo Could not find the panel at "%PANEL_DIR%".
  echo This script expects to sit in scripts\ alongside mcpanel0.5\.
  exit /b 1
)

start "Caddy" /d "%PANEL_DIR%" cmd /k caddy_windows_amd64_custom run

cd /d "%PANEL_DIR%"
npm start
