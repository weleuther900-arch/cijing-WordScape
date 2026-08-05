@echo off
setlocal EnableExtensions

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
if "%WORDSCAPE_PORT%"=="" set "WORDSCAPE_PORT=4173"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Download it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First launch: installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "data\offline-dictionary.json" (
  echo First launch: installing the MIT-licensed offline dictionary...
  call npm.cmd run dictionary:install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

set "WORDSCAPE_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%WORDSCAPE_PORT% .*LISTENING"') do set "WORDSCAPE_PID=%%P"

if defined WORDSCAPE_PID (
  start "" "http://127.0.0.1:%WORDSCAPE_PORT%/"
  echo WordScape is already running in the background. Your browser is opening now.
  exit /b 0
)

if not exist "data" mkdir "data"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = '%APP_DIR%'; Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'data\server.stdout.log') -RedirectStandardError (Join-Path $root 'data\server.stderr.log')"
if errorlevel 1 (
  echo The local server could not be started. Check data\server.stderr.log.
  pause
  exit /b 1
)

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%WORDSCAPE_PORT%/"
echo WordScape is running in the background. You may close this window.
exit /b 0
