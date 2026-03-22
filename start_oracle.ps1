# start_oracle.ps1
# Stops any existing Oracle API server on the configured port and starts a fresh one.

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at $configPath"
    exit 1
}

$config = Get-Content $configPath | ConvertFrom-Json
$port = if ($config.oracle.port) { $config.oracle.port } else { 3000 }

# Kill existing process on the port if any
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $owningPid = $existing.OwningProcess
    Stop-Process -Id $owningPid -Force
    Write-Host "Stopped existing Oracle server (PID $owningPid)."
    Start-Sleep -Milliseconds 500
}

$serverScript = Join-Path $PSScriptRoot "api\server.js"
if (-not (Test-Path $serverScript)) {
    Write-Error "api/server.js not found at $serverScript"
    exit 1
}

Write-Host "Starting Oracle API server on port $port..."
Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" -WorkingDirectory $PSScriptRoot
Write-Host "Oracle API server started."
