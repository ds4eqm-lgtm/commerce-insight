@echo off
rem Hourly auto check (only lines starting with http are opened)
rem Each product tab saves its result inside Tampermonkey and closes right away.
rem At the end one dashboard tab (#flush) uploads all results to GitHub at once.
rem ===== Collection hours (24h). Runs only when START <= hour < END =====
rem 7 and 18 = runs at 07:31 ... 17:31 (PC shuts down at 18:20)
set START_HOUR=7
set END_HOUR=18
rem ======================================================================
cd /d "%~dp0"
set "HH="
for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set "HH=%%h"
if not defined HH exit
if %HH% LSS %START_HOUR% exit
if %HH% GEQ %END_HOUR% exit
rem Use the latest list saved from the dashboard (commerce05.html) on GitHub.
rem If the download fails or is empty, the local products.txt is used as before.
set "LIST=products.txt"
del /q products_live.txt >nul 2>&1
curl.exe -fsSL --max-time 20 -o products_live.txt "https://raw.githubusercontent.com/ds4eqm-lgtm/commerce-insight/main/products.txt" >nul 2>&1
if exist products_live.txt findstr /b /i "http" products_live.txt >nul && set "LIST=products_live.txt"
for /f "usebackq tokens=1" %%u in (`findstr /b /i "http" "%LIST%"`) do (
  start "" "chrome.exe" "%%u#autotrack"
  timeout /t 4 /nobreak >nul
)
timeout /t 30 /nobreak >nul
start "" "chrome.exe" "https://ds4eqm-lgtm.github.io/commerce-insight/commerce05.html#flush"
exit
