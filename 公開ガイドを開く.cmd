@echo off
chcp 65001 > nul
cd /d "%~dp0"
set "NODE_EXE=node"
where node > nul 2>&1
if errorlevel 1 set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" if "%NODE_EXE%" NEQ "node" (
  echo Node.jsが見つかりません。
  echo Codexに「公開ガイドを起動できません」とお伝えください。
  pause
  exit /b 1
)
echo JACK会話サーバーを起動しています...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000/setup'"
"%NODE_EXE%" "%~dp0server.mjs"
echo.
echo サーバーを起動できませんでした。
echo この画面の内容をCodexへお知らせください。
pause
