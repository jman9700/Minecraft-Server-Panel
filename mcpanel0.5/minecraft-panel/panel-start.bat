@echo off
REM Starts Caddy and the panel.
REM
REM Lives next to package.json, which is where npm needs to run. It still
REM resolves its own folder from %~dp0 rather than trusting the working
REM directory, so launching it from a shortcut, from Task Scheduler, or
REM from any prompt works -- the original only worked if you happened to
REM be standing in this folder already.
REM
REM scripts\panel-start.bat forwards here, so either path works.

setlocal

REM %~dp0 already ends in a backslash.
set "PANEL_DIR=%~dp0"

if not exist "%PANEL_DIR%package.json" (
  echo Could not find package.json next to this script:
  echo   "%PANEL_DIR%"
  exit /b 1
)

REM node_modules is gitignored, so a fresh clone has none. Say so plainly
REM rather than letting npm fail several steps later with a missing module.
if not exist "%PANEL_DIR%node_modules" (
  echo Dependencies are not installed yet. Run this first:
  echo   cd /d "%PANEL_DIR%"
  echo   npm install
  echo.
  echo If this is a new install you will also need:
  echo   npm run setup     ^(creates your first admin account^)
  exit /b 1
)

start "Caddy" /d "%PANEL_DIR%" cmd /k caddy_windows_amd64_custom run

cd /d "%PANEL_DIR%"
npm start
