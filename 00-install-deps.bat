@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Installing dependencies...
npm.cmd install

echo.
echo Done.
pause
