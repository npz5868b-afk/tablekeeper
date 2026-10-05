@echo off
set "PATH=C:\Program Files\PostgreSQL\17\bin;%PATH%"
setlocal
cd /d "%~dp0"
:menu
cls
echo ========================================
echo TABLEKEEPER OPERATOR
echo ========================================
echo.
echo [1] Start Tablekeeper
echo [2] Reset Demo
echo [3] Reset Demo ^& Start
echo [4] Stop Tablekeeper
echo [5] Check Status
echo [6] First-time Setup
echo [0] Exit
echo.
set /p choice=Choose an action: 
if "%choice%"=="1" call "%~dp0START-TABLEKEEPER.cmd"
if "%choice%"=="2" call "%~dp0RESET-DEMO.cmd"
if "%choice%"=="3" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0operator\Tablekeeper.Operator.ps1" ResetAndStart
if "%choice%"=="4" call "%~dp0STOP-TABLEKEEPER.cmd"
if "%choice%"=="5" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0operator\Tablekeeper.Operator.ps1" Status
if "%choice%"=="6" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0operator\Tablekeeper.Operator.ps1" Setup
if "%choice%"=="0" exit /b 0
echo.
pause
goto menu

