# start_oracle.ps1
# Stops any existing Oracle API server on the target port and starts a fresh one.
#
# Usage:
#   .\start_oracle.ps1                                     # production defaults from config.json
#   .\start_oracle.ps1 -Port 3002                          # custom port, default dataDir
#   .\start_oracle.ps1 -Port 3002 -DataDir data/eval-tmp   # fully isolated instance

param(
    [int]$Port = 0,
    [string]$DataDir = ""
)

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at $configPath"
    exit 1
}

$config = Get-Content $configPath | ConvertFrom-Json

if ($Port -eq 0)     { $Port    = $config.oracle.port }
if ($DataDir -eq "") { $DataDir = $config.oracle.dataDir }

# Resolve dataDir relative to script root if not absolute
if (-not [System.IO.Path]::IsPathRooted($DataDir)) {
    $DataDir = Join-Path $PSScriptRoot $DataDir
}

# Kill existing process on the port if any
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $owningPid = $existing.OwningProcess
    Stop-Process -Id $owningPid -Force
    Write-Host "Stopped existing Oracle server (PID $owningPid) on port $Port."
    Start-Sleep -Milliseconds 500
}

$serverScript = Join-Path $PSScriptRoot "api\server.js"
if (-not (Test-Path $serverScript)) {
    Write-Error "api/server.js not found at $serverScript"
    exit 1
}

Write-Host "Starting Oracle API server on port $Port with data dir: $DataDir"

# Set env vars — inherited by the child process on Windows
$env:PORT     = "$Port"
$env:DATA_DIR = "$DataDir"

Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" -WorkingDirectory $PSScriptRoot

Write-Host "Oracle API server started."
