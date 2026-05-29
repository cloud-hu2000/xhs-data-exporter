@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Inspecting clickable text on the current Xiaohongshu page...
echo.
npm.cmd run inspect

echo.
pause
