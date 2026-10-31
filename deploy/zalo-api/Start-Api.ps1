$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env') -PathType Leaf)) {
    throw 'Create the private .env file before starting the API.'
}
$taskLogDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
& $taskNode (Join-Path $PSScriptRoot 'server.cjs') *>> (Join-Path $taskLogDirectory 'api.log')
exit $LASTEXITCODE
