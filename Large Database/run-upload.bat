@echo off
REM Windows entry point — double-click to run once, or point Task
REM Scheduler at this file (see README.md for the exact setup for a
REM 12:00 PM daily run).

REM %~dp0 is this .bat file's own folder, with a trailing backslash —
REM makes this work no matter what folder Task Scheduler's "Start in"
REM setting is left as, or what folder you double-click it from.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo node was not found on PATH. Install Node.js from https://nodejs.org, then re-run this.
  exit /b 1
)

if not exist node_modules (
  echo node_modules is missing — run "npm install" once in this folder before first use.
  exit /b 1
)

node upload-documents.mjs
exit /b %errorlevel%
