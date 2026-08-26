@echo off
setlocal
title Qadiyat Al-Qasr - Local Server

rem ---- go to the project root (one level above this folder) ----------
pushd "%~dp0.."

rem ---- find python ---------------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY where python3 >nul 2>nul && set "PY=python3"
if not defined PY goto no_python

rem ---- sanity check --------------------------------------------------
if not exist "%~dp0server.py" goto no_server
if not exist "%~dp0index.html" goto no_page

rem ---- free the port if an old run is still listening -----------------
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"TCP .*:8000 .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul

echo.
echo  ============================================================
echo    Qadiyat Al-Qasr   ^(qasr build^)
echo    http://localhost:8000/qasr/index.html
echo    (friends on the same Wi-Fi use the second address printed below)
echo    (a phone address is printed below - same Wi-Fi)
echo  ============================================================
echo    Keep this window open while playing. Close it to stop.
echo.

"%PY%" "%~dp0server.py"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo  Server exited with code %RC%.
echo  Server stopped.
popd
pause
exit /b %RC%

:no_python
echo.
echo  [X] Python was not found on this PC.
echo      Install it from https://www.python.org/downloads/
echo      and tick "Add Python to PATH" during setup.
echo.
popd
pause
exit /b 1

:no_server
echo.
echo  [X] server.py is missing next to this file:
echo      %~dp0server.py
echo.
popd
pause
exit /b 1

:no_page
echo.
echo  [X] index.html is missing next to this file:
echo      %~dp0index.html
echo.
popd
pause
exit /b 1
