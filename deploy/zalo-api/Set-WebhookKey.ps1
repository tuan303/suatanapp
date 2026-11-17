param(
    [string]$ApiDirectory = 'C:\DKAN-Zalo-API',
    [System.Security.SecureString]$ApiKey
)

$ErrorActionPreference = 'Stop'
$keyPointer = [IntPtr]::Zero
$temporaryPath = $null

try {
    $resolvedApiDirectory = (Resolve-Path -LiteralPath $ApiDirectory).ProviderPath
    $environmentPath = Join-Path $resolvedApiDirectory '.env'
    if (!(Test-Path -LiteralPath $environmentPath -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $resolvedApiDirectory 'server.cjs') -PathType Leaf)) {
        throw 'API_DIRECTORY_INVALID'
    }
    if (((Get-Item -LiteralPath $environmentPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'API_DIRECTORY_INVALID'
    }

    if ($null -eq $ApiKey) {
        Write-Host 'Nhap Open API Key lay tu muc Open APIs cua Zalo.'
        Write-Host 'Khoa se duoc an. Sau khi dan, nhan Enter.'
        $ApiKey = Read-Host 'Open API Key' -AsSecureString
    }
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiKey)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if ($plainKey.Length -lt 16 -or $plainKey.Length -gt 1024 -or
        $plainKey -match '[^\x21-\x7e]' -or $plainKey.Contains('"') -or $plainKey.Contains('\') -or
        $plainKey -match '^(your|dien_|dan_|change|replace|placeholder)|[<>]|\$\{') {
        throw 'API_KEY_INVALID'
    }

    $lines = [IO.File]::ReadAllLines($environmentPath)
    $retainedLines = @($lines | Where-Object {
        $_ -notmatch '^\s*(?:export\s+)?(?:ZALO_MINI_APP_API_KEY|DKAN_ZALO_ENABLED)\s*='
    })
    $updatedLines = @($retainedLines) + @('DKAN_ZALO_ENABLED=true', ('ZALO_MINI_APP_API_KEY="' + $plainKey + '"'))
    $suffix = [Guid]::NewGuid().ToString('N')
    $temporaryPath = Join-Path $resolvedApiDirectory ('.env.webhook-' + $suffix + '.tmp')
    $backupPath = Join-Path $resolvedApiDirectory ('.env.before-webhook-' + $suffix + '.bak')
    [IO.File]::WriteAllText($temporaryPath, '')
    Set-Acl -LiteralPath $temporaryPath -AclObject (Get-Acl -LiteralPath $environmentPath)
    [IO.File]::WriteAllLines($temporaryPath, $updatedLines, [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporaryPath, $environmentPath, $backupPath)
    $temporaryPath = $null
    Write-Host 'DA LUU CAU HINH WEBHOOK. Da sao luu tep .env cu trong cung thu muc.'
    # The API reads .env only when node starts. The background task from
    # Install-ApiStartup.ps1 is restarted by running that installer again: it
    # stops the old node.exe, re-grants Local Service read access and checks
    # /healthz. The new .env also keeps the old ACL (Set-Acl above).
    Write-Host 'Chay lai API de nap khoa (PowerShell Run as administrator):'
    Write-Host ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $resolvedApiDirectory 'Install-ApiStartup.ps1') + '"')
    Write-Host 'Neu API dang chay tay trong cua so Node: nhan Ctrl+C roi chay lai.'
} catch {
    if ($_.Exception.Message -eq 'API_DIRECTORY_INVALID') {
        Write-Host 'KHONG LUU: Can co .env va server.cjs trong thu muc API.'
    } elseif ($_.Exception.Message -eq 'API_KEY_INVALID') {
        Write-Host 'KHONG LUU: Khoa khong hop le. Dan dung Open API Key, bo khoang trang va dau nhay ben ngoai.'
    } else {
        Write-Host 'KHONG LUU: Khong cap nhat duoc .env. Kiem tra thu muc API va quyen ghi.'
    }
    exit 1
} finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    $plainKey = $null
    $updatedLines = $null
    if ($temporaryPath -and [IO.File]::Exists($temporaryPath)) {
        [IO.File]::Delete($temporaryPath)
    }
}
