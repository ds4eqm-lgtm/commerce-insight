@echo off
echo Removing daily shutdown task
schtasks /delete /tn "CommerceInsightShutdown" /f
shutdown /a >nul 2>&1
pause
