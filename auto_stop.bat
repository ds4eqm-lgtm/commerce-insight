@echo off
echo Removing hourly task: CommerceInsightHourly
schtasks /delete /tn "CommerceInsightHourly" /f
pause
