# Build and run Kanban Studio. Windows.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Image = "kanban-studio"
$Container = "kanban-studio"
$Port = if ($env:PORT) { $env:PORT } else { "8000" }

Set-Location $Root
docker build -t $Image .
docker rm -f $Container 2>$null | Out-Null

# The database lives on the host so it survives rebuilding the image.
$DataDir = Join-Path $Root "data"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    docker run -d --name $Container -p "${Port}:8000" `
        -v "${DataDir}:/app/data" --env-file $EnvFile $Image
} else {
    Write-Warning "No .env found; OPENROUTER_API_KEY will not be set."
    docker run -d --name $Container -p "${Port}:8000" -v "${DataDir}:/app/data" $Image
}

# Generous budget on purpose; see the note in start.sh.
foreach ($attempt in 1..120) {
    try {
        Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 2 | Out-Null
        Write-Host "Kanban Studio running at http://localhost:$Port"
        exit 0
    } catch {
        if ($attempt % 15 -eq 0) {
            Write-Host "Still waiting for http://localhost:$Port/api/health (${attempt}s)..."
        }
        Start-Sleep -Seconds 1
    }
}

Write-Error "Container did not become healthy after 120s. Logs:"
docker logs $Container
exit 1
