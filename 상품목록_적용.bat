@echo off
rem Commerce Insight: apply the product list downloaded from commerce05.html
rem (no token; backs up the old list in backups\ ; push with GitHub Desktop afterwards)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply_products.ps1"
pause
