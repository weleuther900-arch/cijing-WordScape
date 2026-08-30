@echo off
setlocal EnableExtensions

rem The desktop route always opens the deployed cloud application.
wscript.exe "%~dp0launch.vbs"
exit /b %ERRORLEVEL%
