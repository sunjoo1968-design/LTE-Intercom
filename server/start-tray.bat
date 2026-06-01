@echo off
set SCRIPT_DIR=%~dp0
powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%tray\LTE-Intercom-Tray.ps1"
