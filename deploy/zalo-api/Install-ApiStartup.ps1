#requires -Version 5.1
#requires -RunAsAdministrator
<#
Dang ky (hoac dang ky lai) tac vu 'DKAN - Zalo API': chay server.cjs bang tai
khoan Local Service khi Windows khoi dong, nap .env bang --env-file cua Node,
tu chay lai sau 1 phut khi tien trinh loi (toi da 10 lan).

Chay lai tep nay sau moi lan thay server.cjs hoac sua .env. Tep dung API dang
chay (ca node.exe con lai sau khi dung tac vu), cap lai quyen doc cho Local
Service tren cac tep moi chep vao, dang ky lai tac vu roi chay lai API.

Node chay qua cmd.exe de ghi stdout/stderr vao logs\api.log (UTF-8). Task
Scheduler khong giu dau ra cua tien trinh, nen cac dong chan doan
DKAN_ZALO_API_READY, DKAN_ZALO_API_START_FAILED, DKAN_ZALO_VERIFY_FAILED,
DKAN_ZALO_MAIL_UNAVAILABLE, DKAN_ZALO_MAIL_FAILED chi co trong tep log nay.
Local Service chi duoc ghi trong thu muc logs. Moi ma chan doan ghi toi da
20 dong/phut (phan vuot gop thanh dong <ma>_SUPPRESSED {"count":n}); moi lan
chay tep nay, api.log lon hon 20 MB duoc doi ten thanh api-yyyyMMdd-HHmmss.log
va chi giu 5 tep cu gan nhat.

-Stop: chi dung API (tac vu va node.exe cua tac vu), giu nguyen dang ky; khi
Windows khoi dong lai, API tu chay lai.
#>
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$taskName = 'DKAN - Zalo API'
$taskPath = '\'
# Keep this text: a task installed by an earlier version of this file is
# recognised by it and replaced; any other task with this name is left alone.
$description = 'DKAN Zalo API managed by Install-ApiStartup.ps1'
$apiDirectory = $PSScriptRoot
$envFile = Join-Path $apiDirectory '.env'
$entryFile = Join-Path $apiDirectory 'server.cjs'
$packageFile = Join-Path $apiDirectory 'package.json'
$modulesDirectory = Join-Path $apiDirectory 'node_modules'
$logDirectory = Join-Path $apiDirectory 'logs'
$logFile = Join-Path $logDirectory 'api.log'
$logRotateBytes = 20MB
$logArchivesKept = 5
$apiPort = 3031
$healthUrl = "http://127.0.0.1:$apiPort/healthz"

function Grant-LocalServiceAccess {
    param([string]$Path, [string]$Rights)

    # Use the well-known SID so this also works on localized Windows servers.
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    & $icacls $Path /grant ('*S-1-5-19:' + $Rights) | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Khong cap duoc quyen cho Local Service tai $Path."
    }
}

function Get-ApiTaskArguments {
    param([string]$NodePath, [string]$EnvPath, [string]$EntryPath, [string]$LogPath)

    # cmd.exe expands % (and ! with delayed expansion) even inside quotes.
    foreach ($path in @($NodePath, $EnvPath, $EntryPath, $LogPath)) {
        if ($path.IndexOfAny([char[]]'"%!^&|<>') -ge 0) {
            throw "Duong dan $path co ky tu cmd.exe khong xu ly an toan. Dat API va Node.js trong thu muc co ten don gian."
        }
    }
    # /s removes only the outer pair of quotes, so each path keeps its own.
    # Redirecting in cmd.exe keeps node's UTF-8 bytes as they are, and cmd.exe
    # returns node's exit code to Task Scheduler.
    $command = '"{0}" --env-file="{1}" "{2}" >> "{3}" 2>&1' -f $NodePath, $EnvPath, $EntryPath, $LogPath
    return '/d /s /c "' + $command + '"'
}

function Limit-ApiLog {
    param([string]$Directory, [string]$Path, [long]$MaxBytes, [int]$Keep)

    # The task appends to one file for the life of the server: start a new file
    # once it is large and keep only the newest archives. Run only while the
    # API is stopped, so no process holds the file.
    $file = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($file -and $file.Length -gt $MaxBytes) {
        $archive = 'api-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
        try {
            Rename-Item -LiteralPath $Path -NewName $archive
            Write-Host "Log vuot $([math]::Round($MaxBytes / 1MB, 2)) MB: da doi ten thanh logs\$archive."
        } catch {
            Write-Warning "Chua doi ten duoc log $Path; log moi se ghi tiep vao tep nay."
        }
    }
    $archives = @(Get-ChildItem -LiteralPath $Directory -Filter 'api-*.log' -File |
        Where-Object { $_.Name -match '^api-\d{8}-\d{6}\.log$' } | Sort-Object Name -Descending)
    foreach ($old in ($archives | Select-Object -Skip $Keep)) {
        try {
            Remove-Item -LiteralPath $old.FullName -Force
        } catch {
            Write-Warning "Chua xoa duoc log cu $($old.FullName)."
        }
    }
}

function Get-ApiProcesses {
    param([string]$EntryPath)

    # node.exe started by this task: its command line holds the quoted absolute
    # path of server.cjs. A manual 'node .\server.cjs' does not match.
    $quotedEntry = '"' + $EntryPath + '"'
    @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($quotedEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

function Wait-Until {
    param([scriptblock]$Condition, [int]$Seconds)

    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    return [bool](& $Condition)
}

function Stop-ApiProcesses {
    param([string]$EntryPath)

    foreach ($process in (Get-ApiProcesses -EntryPath $EntryPath)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    return (Wait-Until { @(Get-ApiProcesses -EntryPath $EntryPath).Count -eq 0 } 10)
}

function Stop-ManagedApi {
    param($Task)

    if ($Task) {
        Stop-ScheduledTask -TaskName $taskName -TaskPath $taskPath
        $null = Wait-Until { (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath).State -ne 'Running' } 15
    }
    # Ending the task ends cmd.exe; the node.exe it started can keep running
    # with the old server.cjs and hold port 3031.
    if (-not (Stop-ApiProcesses -EntryPath $entryFile)) {
        throw "Chua dung duoc node.exe dang chay $entryFile. Dung tien trinh do trong Task Manager roi chay lai tep nay."
    }
}

function Test-ApiPortInUse {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return [bool]($listeners | Where-Object { $_.Port -eq $apiPort })
}

function Test-ApiHealth {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -UseBasicParsing -TimeoutSec 2 -MaximumRedirection 0
        return ($health.status -eq 'ok')
    } catch {
        return $false
    }
}

$existing = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) {
    throw "Da co tac vu '$taskName' duoc cai theo cach khac. Kiem tra tac vu do trong Task Scheduler."
}

if ($Stop) {
    Stop-ManagedApi -Task $existing
    Write-Host 'API DA DUNG. Tac vu van tu chay khi Windows khoi dong; chay lai tep nay khong kem -Stop de bat lai API.'
    return
}

foreach ($file in @($entryFile, $packageFile, $envFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Thieu $file. Dat tep cai dat trong thu muc API da trien khai."
    }
}
if (-not (Test-Path -LiteralPath $modulesDirectory -PathType Container)) {
    throw "Thieu $modulesDirectory. Cai cac goi cua API truoc khi dang ky tac vu."
}
$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
    throw 'Khong tim thay node.exe. Kiem tra Node.js trong PowerShell tren VPS.'
}
$cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
$arguments = Get-ApiTaskArguments -NodePath $node.Source -EnvPath $envFile -EntryPath $entryFile -LogPath $logFile

# Stop the running API first: the task is replaced and the new server.cjs or
# .env is only read when node starts.
Stop-ManagedApi -Task $existing

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
if (Test-Path -LiteralPath $logFile -PathType Leaf) {
    $head = New-Object byte[] 2
    $stream = [IO.File]::Open($logFile, 'Open', 'Read', 'ReadWrite')
    try { $count = $stream.Read($head, 0, 2) } finally { $stream.Dispose() }
    if ($count -eq 2 -and $head[0] -eq 0xFF -and $head[1] -eq 0xFE) {
        # Start-Api.ps1 before LIVE-20261117.1 wrote UTF-16; keep it apart.
        $oldLog = 'api.utf16-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
        try {
            Rename-Item -LiteralPath $logFile -NewName $oldLog
            Write-Host "Da doi ten log UTF-16 cu thanh logs\$oldLog."
        } catch {
            Write-Warning "Chua doi ten duoc log UTF-16 cu $logFile; log moi se ghi tiep vao tep nay."
        }
    }
}
Limit-ApiLog -Directory $logDirectory -Path $logFile -MaxBytes $logRotateBytes -Keep $logArchivesKept

# Give Local Service only what this API needs: read the files node loads (again
# after each update, because newly copied files do not carry these grants) and
# write only inside logs.
Grant-LocalServiceAccess -Path $apiDirectory -Rights '(RX)'
Grant-LocalServiceAccess -Path $entryFile -Rights '(R)'
Grant-LocalServiceAccess -Path $packageFile -Rights '(R)'
Grant-LocalServiceAccess -Path $envFile -Rights '(R)'
Grant-LocalServiceAccess -Path $modulesDirectory -Rights '(OI)(CI)(RX)'
Grant-LocalServiceAccess -Path $logDirectory -Rights '(OI)(CI)(M)'
if (Test-Path -LiteralPath $logFile -PathType Leaf) {
    Grant-LocalServiceAccess -Path $logFile -Rights '(M)'
}

$action = New-ScheduledTaskAction -Execute $cmd -Argument $arguments -WorkingDirectory $apiDirectory
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'LOCALSERVICE' -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Description $description `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Da dang ky '$taskName' tu chay khi Windows khoi dong. Log: $logFile"

if (-not (Wait-Until { -not (Test-ApiPortInUse) } 5)) {
    Write-Warning 'Cong 3031 dang duoc su dung. Neu do la API chay tay (node .\server.cjs hoac Start-Api.ps1), bam Ctrl+C trong cua so Node cu, roi chay lai tep cai dat nay.'
    return
}

Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
if (Wait-Until { (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath).State -eq 'Running' -and (Test-ApiHealth) } 20) {
    Write-Host 'API DANG CHAY NEN - healthz: ok' -ForegroundColor Green
    return
}

$state = (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath).State
$lastResult = (Get-ScheduledTaskInfo -TaskName $taskName -TaskPath $taskPath).LastTaskResult
throw "Tac vu da duoc dang ky, nhung chua xac nhan API tai $healthUrl. Trang thai $state. Last Run Result $lastResult. Xem $logFile."
