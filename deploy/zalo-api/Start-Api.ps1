# Manual/legacy launcher: runs the API in this window, logging to logs\api.log.
# On the VPS the API runs as the 'DKAN - Zalo API' task that
# Install-ApiStartup.ps1 registers. Stop that task first
# (Install-ApiStartup.ps1 -Stop): both use port 3031.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env') -PathType Leaf)) {
    throw 'Create the private .env file before starting the API.'
}
$taskLogDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
# Redirect inside cmd.exe, not PowerShell: Windows PowerShell 5.1 turns each
# redirected stderr line of a native program into an error record, and with
# 'Stop' above the first console.warn diagnostic (DKAN_ZALO_VERIFY_FAILED,
# DKAN_ZALO_MAIL_*) ended this script and the API. cmd.exe also keeps the log
# in UTF-8 and passes node's exit code through.
& cmd.exe /d /c "`"$taskNode`" server.cjs >> logs\api.log 2>&1"
exit $LASTEXITCODE
