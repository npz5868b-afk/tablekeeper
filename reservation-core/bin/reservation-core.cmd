@echo off
setlocal
node "%~dp0..\src\db\reservation-core.mjs" %*
exit /b %ERRORLEVEL%
