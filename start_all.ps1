# start_all.ps1
# Starts all servers in separate windows: LLM, embedding, vision, image gen, and app server.

$root = $PSScriptRoot

Write-Host "Starting LLM server..."
Start-Process powershell -ArgumentList "-File `"$root\setup_llm.ps1`""

Write-Host "Starting embedding server..."
Start-Process powershell -ArgumentList "-File `"$root\setup_embedding.ps1`""

Write-Host "Starting vision server..."
Start-Process powershell -ArgumentList "-NoExit", "-File", "`"$root\setup_vision.ps1`""

Write-Host "Starting image generation server (ComfyUI)..."
Start-Process powershell -ArgumentList "-NoExit", "-File", "`"$root\setup_image.ps1`""

Write-Host "All servers launched."
