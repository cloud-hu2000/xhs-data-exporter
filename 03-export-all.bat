@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Exporting all visible Xiaohongshu note detail data...
echo.
set "XHS_MAX_NOTES="
if not exist logs mkdir logs
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "RUN_TS=%%I"
set "BAT_LOG=logs\export-all-%RUN_TS%.log"
echo Export log: %CD%\%BAT_LOG%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& npm.cmd run export 2>&1 | Tee-Object -FilePath '%BAT_LOG%'; exit $LASTEXITCODE"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Export finished with exit code %EXIT_CODE%.
echo Log file: %CD%\%BAT_LOG%
pause
exit /b %EXIT_CODE%
