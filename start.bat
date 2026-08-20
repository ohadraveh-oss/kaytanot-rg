@echo off
cd /d "%~dp0"
title Kaytanot - Beit Sefer HaGefen

where node >nul 2>nul
if errorlevel 1 goto NONODE

echo.
echo   ============================================
echo      Starting the camps website...
echo      Open in browser:  http://localhost:3000
echo      Keep this window open!
echo   ============================================
echo.
start "" http://localhost:3000
node server.js
echo.
echo   Server stopped.
pause
exit /b

:NONODE
echo.
echo   ============================================
echo     Node.js is NOT installed on this computer.
echo   ============================================
echo.
echo   1. Go to:   https://nodejs.org
echo   2. Click the big green LTS button and install it.
echo      (Click Next / Next / Install - nothing to change)
echo   3. Restart the computer.
echo   4. Double-click start.bat again.
echo.
echo   Opening nodejs.org for you now...
start "" https://nodejs.org
echo.
pause
exit /b
