@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Exporting all visible Xiaohongshu note detail data...
echo.
set "XHS_MAX_NOTES="
npm.cmd run export

echo.
echo Export finished.
pause
