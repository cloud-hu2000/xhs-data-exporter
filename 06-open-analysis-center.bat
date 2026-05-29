@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Starting Xiaohongshu analysis center...
echo Open this URL if the browser does not open automatically:
echo http://localhost:5178
echo.
start "" "http://localhost:5178"
npm.cmd run dashboard

pause
