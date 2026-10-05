@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0operator\Tablekeeper.Operator.ps1" Start
if errorlevel 1 pause
