@echo off
echo %*>>"%TK_MOCK_CALLS%"
echo stdout: %*
echo #0 building with "desktop-linux" instance using docker driver 1>&2
if not "%TK_MOCK_FAIL_MATCH%"=="" (
  echo %*|%SystemRoot%\System32\findstr.exe /C:"%TK_MOCK_FAIL_MATCH%" >nul
  if not errorlevel 1 (
    if /I "%TK_MOCK_FAIL_MATCH%"=="network rm" echo Error response from daemon: network not found 1>&2
    exit /b %TK_MOCK_FAIL_CODE%
  )
)
if not "%TK_MOCK_FAIL_MATCH2%"=="" (
  echo %*|%SystemRoot%\System32\findstr.exe /C:"%TK_MOCK_FAIL_MATCH2%" >nul
  if not errorlevel 1 exit /b %TK_MOCK_FAIL_CODE2%
)
exit /b 0
