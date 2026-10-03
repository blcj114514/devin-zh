@echo off
title Devin Chinese Launcher
setlocal

set "PORT=9333"
set "ROOT=%~dp0"
set "ZH_DIR=%ROOT%dict"

echo ============================================
echo   Devin Chinese Launcher
echo ============================================
echo.

REM --- check node (22+ required: injector uses built-in WebSocket/fetch) ---
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -e "process.exit(+process.versions.node.split('.')[0]<22?1:0)" >nul 2>nul
if errorlevel 1 goto :old_node

REM --- locate Devin.exe ---
set "DEVIN_EXE="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\find-devin.ps1" 2^>nul`) do set "DEVIN_EXE=%%P"
if not defined DEVIN_EXE goto :no_devin

echo [i] Devin : %DEVIN_EXE%
echo [i] Pack  : %ROOT%
echo.

REM --- check if Devin already running ---
tasklist /FI "IMAGENAME eq Devin.exe" 2>nul | findstr /I "Devin.exe" >nul
if not errorlevel 1 goto :already_running

REM --- cleanup stale injector launched from THIS pack only ---
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*injector.mjs*' -and $_.CommandLine -like '*%ZH_DIR%*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

echo [1/3] Starting Chinese injector...
REM direct node: cmd double-quotes are safe for apostrophes, ampersand, spaces and CJK paths
start "Devin-ZH-Injector" /min node "%ZH_DIR%\injector.mjs" %PORT%

echo [2/3] Waiting for injector ready...
timeout /t 3 /nobreak >nul

echo [3/3] Starting Devin (--locale zh-cn, debug port %PORT%)...
start "" "%DEVIN_EXE%" --locale zh-cn --remote-debugging-port=%PORT%

echo.
echo Done. Devin is starting in Chinese.
echo The minimized injector window must stay open (it keeps NEW panels translated).
timeout /t 4 /nobreak >nul
exit /b 0

:already_running
echo [!] Devin is already running.
echo     Please fully close Devin first, then run this launcher again.
echo     Reason: the debug port only opens on a fresh start.
echo.
pause
exit /b 1

:old_node
echo [!] Node.js 22 or newer is required (the injector uses built-in WebSocket).
node -v
echo     Download: https://nodejs.org/
echo.
pause
exit /b 1

:no_node
echo [!] Node.js not found in PATH.
echo     Node 22 or newer is required for the injector.
echo     Download: https://nodejs.org/
echo.
pause
exit /b 1

:no_devin
echo [!] Devin.exe not found on this machine.
echo     Install Devin Desktop first, or add your install path to
echo     tools\find-devin.ps1 (the candidates list at the top).
echo.
pause
exit /b 1
