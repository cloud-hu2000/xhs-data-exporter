@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Importing downloaded Xiaohongshu files into unified tables...
echo.
npm.cmd run import

echo.
echo Import finished.
pause
