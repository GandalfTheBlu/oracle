# setup_image.ps1
# Launches ComfyUI for Loke's image generation feature.
# ComfyUI path and port are read from config.json.
#
# Required models (place in ComfyUI\models\unet, vae, clip):
#   UNET:  https://huggingface.co/city96/FLUX.1-schnell-gguf
#   VAE:   https://huggingface.co/black-forest-labs/FLUX.1-schnell (ae.safetensors)
#   CLIP:  https://huggingface.co/comfyanonymous/flux_text_encoders
#
# Then run: .\setup_image.ps1

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at: $configPath"
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$comfyPath = $config.imageGen.comfyUIPath
$port      = $config.imageGen.port

if (-not (Test-Path $comfyPath)) {
    Write-Error "ComfyUI not found at: $comfyPath`nUpdate 'imageGen.comfyUIPath' in config.json."
    exit 1
}

$venvActivate = Join-Path $comfyPath "venv312\Scripts\Activate.ps1"
if (-not (Test-Path $venvActivate)) {
    Write-Error "venv312 not found at: $comfyPath\venv312`nRe-run the venv setup steps."
    exit 1
}

Write-Host ""
Write-Host "Starting ComfyUI on port $port..."
Write-Host "  Path: $comfyPath"
Write-Host ""

Set-Location $comfyPath
& $venvActivate
python main.py --listen --port $port --lowvram
