# Build and run Kanban Studio. Windows.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Image = "kanban-studio"
$Container = "kanban-studio"
$Port = if ($env:PORT) { $env:PORT } else { "8000" }

Set-Location $Root
docker build -t $Image .
docker rm -f $Container 2>$null | Out-Null

$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    docker run -d --name $Container -p "${Port}:8000" --env-file $EnvFile $Image
} else {
    Write-Warning "No .env found; OPENROUTER_API_KEY will not be set."
    docker run -d --name $Container -p "${Port}:8000" $Image
}

foreach ($attempt in 1..30) {
    try {
        Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 2 | Out-Null
        Write-Host "Kanban Studio running at http://localhost:$Port"
        exit 0
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Error "Container did not become healthy. Logs:"
docker logs $Container
exit 1
