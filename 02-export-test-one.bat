@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Exporting 1 note as a test...
echo.
set "XHS_MAX_NOTES=1"
npm.cmd run export

echo.
echo Test export finished.
pause
