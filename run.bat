@echo off
chcp 65001 >nul
cd /d "%~dp0"

node src\cli.js %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%~1"=="" exit /b %EXIT_CODE%

echo.
pause
exit /b %EXIT_CODE%
