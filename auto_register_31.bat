@echo off
cd /d "%~dp0"
rem Commerce Insight: move the hourly check to minute 31 (old: minute 01)
rem Run this file from the commerce-insight repo folder (same folder as auto_open.bat)
if not exist "%~dp0auto_open.bat" (
  echo auto_open.bat not found. Copy this file into the commerce-insight repo folder and run it there.
  pause
  exit /b 1
)
echo Registering hourly task at minute 31: CommerceInsightHourly
schtasks /create /tn "CommerceInsightHourly" /sc hourly /mo 1 /st 00:31 /tr "\"%~dp0auto_open.bat\"" /f
if %ERRORLEVEL% EQU 0 (
  echo.
  echo OK. Product pages will now open at minute 31 of every hour.
  echo To go back to minute 01, run auto_register.bat again.
) else (
  echo.
  echo Failed. Right-click this file and choose Run as administrator.
)
pause
