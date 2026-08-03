# Run the backend tests. Windows.
# Runs pytest inside the uv image, so no local Python or uv install is needed.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

# The AI tests call OpenRouter for real, so the suite needs the key. The app
# also refuses to start without it, so a missing .env would otherwise surface
# as every test failing at startup.
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Error "No .env found at $EnvFile. It must contain OPENROUTER_API_KEY."
    exit 1
}

docker run --rm `
    -v "${Root}\backend:/app" `
    -w /app `
    -e UV_LINK_MODE=copy `
    --env-file $EnvFile `
    ghcr.io/astral-sh/uv:python3.13-bookworm-slim `
    uv run pytest @args
