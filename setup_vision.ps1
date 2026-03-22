# setup_vision.ps1
# Launches a llama-cpp vision server for Loke's image recognition feature.
# Model paths, host, and port are read from config.json.
#
# Download the required GGUF files from HuggingFace:
#   Model:   https://huggingface.co/bartowski/Qwen_Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen_Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf
#   Mmproj:  https://huggingface.co/bartowski/Qwen_Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/mmproj-Qwen_Qwen2.5-VL-7B-Instruct-bf16.gguf
#
# Place them at the paths set in config.json under "vision.model" and "vision.mmproj",
# then run: .\setup_vision.ps1

param(
    [int]$ContextSize = 4096,
    [string]$BindHost = "0.0.0.0",
    [int]$GpuLayers = -1
)

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at: $configPath"
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$binary    = $config.llm.binary
$ModelPath = $config.vision.model
$MmprojPath = $config.vision.mmproj
$Port      = $config.vision.port

if (-not (Test-Path $binary)) {
    Write-Error "llama-server binary not found at: $binary`nUpdate 'llm.binary' in config.json."
    exit 1
}

if (-not (Test-Path $ModelPath)) {
    Write-Error "Vision model not found at: $ModelPath`n`nDownload it from:`n  https://huggingface.co/bartowski/Qwen_Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen_Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`n`nThen update 'vision.model' in config.json."
    exit 1
}

if (-not (Test-Path $MmprojPath)) {
    Write-Error "Mmproj not found at: $MmprojPath`n`nDownload it from:`n  https://huggingface.co/bartowski/Qwen_Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/mmproj-Qwen_Qwen2.5-VL-7B-Instruct-bf16.gguf`n`nThen update 'vision.mmproj' in config.json."
    exit 1
}

Write-Host ""
Write-Host "Starting Qwen2.5-VL vision server on port $Port..."
Write-Host "  Model:   $ModelPath"
Write-Host "  Mmproj:  $MmprojPath"
Write-Host "  Context: $ContextSize"
Write-Host ""

& $binary `
    --model $ModelPath `
    --mmproj $MmprojPath `
    --host $BindHost `
    --port $Port `
    --ctx-size $ContextSize `
    --n-gpu-layers $GpuLayers `
    --jinja
