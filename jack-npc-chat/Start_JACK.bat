@echo off
title JACK Server
cd /d "%~dp0"

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

echo Starting JACK server...
echo Keep this window open while using JACK.
echo.

if not exist "%NODE_EXE%" goto NODE_NOT_FOUND

"%NODE_EXE%" server.mjs

echo.
echo JACK server stopped.
goto KEEP_OPEN

:NODE_NOT_FOUND
echo ERROR: Node.js was not found.
echo Expected location:
echo %NODE_EXE%

:KEEP_OPEN
echo.
echo Please send a screenshot of this window to Codex.
cmd /k
