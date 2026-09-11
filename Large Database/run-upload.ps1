# Windows PowerShell entry point — an alternative to run-upload.bat for
# Task Scheduler actions that specify a .ps1 directly. Functionally
# identical to run-upload.bat; use whichever you're more comfortable
# wiring into Task Scheduler (see README.md).
#
# If Task Scheduler (or running this by hand) reports it's blocked by the
# execution policy, either tick "Unrestricted" isn't needed — just point
# Task Scheduler's action at:
#   powershell.exe -ExecutionPolicy Bypass -File "<full path to this file>"
# which bypasses the policy for this one invocation only, same as
# README.md's Task Scheduler instructions already set up.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node was not found on PATH. Install Node.js from https://nodejs.org, then re-run this."
    exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Error 'node_modules is missing — run "npm install" once in this folder before first use.'
    exit 1
}

node upload-documents.mjs
exit $LASTEXITCODE
