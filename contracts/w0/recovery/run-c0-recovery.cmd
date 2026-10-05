@echo off
setlocal
set "DOCKER_EXE=%LocalAppData%\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER_EXE%" (
  echo ERROR: Docker executable not found at "%DOCKER_EXE%"
  exit /b 2
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-c0-recovery.ps1" -DockerExe "%DOCKER_EXE%"
exit /b %ERRORLEVEL%
