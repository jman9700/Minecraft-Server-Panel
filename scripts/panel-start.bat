@echo off
REM Convenience shim so the panel can also be launched from scripts\.
REM
REM The real script lives next to the panel's package.json, because that
REM is where npm has to run. This forwards to it and passes through the
REM exit code.
REM
REM A .bat rather than a Windows .lnk on purpose: a shortcut stores an
REM absolute path, so it would break on any checkout that is not in the
REM exact folder it was created for. This resolves relatively and works
REM in every clone.

call "%~dp0..\minecraft-panel\panel-start.bat" %*
exit /b %ERRORLEVEL%
