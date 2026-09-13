@echo off
setlocal
title Model Mayhem
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Model Mayhem 启动失败，错误码：%EXIT_CODE%
  pause
)

exit /b %EXIT_CODE%
