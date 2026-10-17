@echo off
rem Commerce Insight: apply the new dashboard screen (commerce05.html)
rem Copies the newest commerce05*.html from this folder or Downloads into the repo folder,
rem backs up the old one in backups\ , then opens GitHub Desktop so you can Commit and Push.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply_screen.ps1"
pause
