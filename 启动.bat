@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PY=C:\Users\sm\.workbuddy\binaries\python\versions\3.13.12\python.exe
if not exist "%PY%" set PY=python
"%PY%" "服务端.py"
if errorlevel 1 pause
