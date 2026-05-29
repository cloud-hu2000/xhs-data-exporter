@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Opening the dedicated Xiaohongshu browser...
echo Please log in, then keep this browser window open.
echo.
npm.cmd run browser

echo.
echo After login, run 02-export-test-one.bat or 03-export-all.bat.
pause
