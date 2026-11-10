@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 依次查找可用的 Python 3：环境变量 PYTHON > 标准安装目录 > PATH
set "PY="
if defined PYTHON if exist "%PYTHON%" set "PY=%PYTHON%"
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if not defined PY for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if not defined PY for /f "delims=" %%P in ('where python 2^>nul') do if not defined PY set "PY=%%P"
if not defined PY goto nopython

"%PY%" "服务端.py"
if errorlevel 1 pause
exit /b 0

:nopython
echo.
echo   未找到 Python 3。
echo   请安装 Python 3.9 或更高版本（安装时勾选 Add Python to PATH），
echo   或设置环境变量 PYTHON 指向 python.exe 的完整路径后重试。
echo.
pause
