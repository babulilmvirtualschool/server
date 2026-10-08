@echo off
rem Double-click to run API + website locally against the database in server\.env (no migrations/seed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Live.ps1"
echo.
pause
