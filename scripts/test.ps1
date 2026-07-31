# Run the backend tests. Windows.
# Runs pytest inside the uv image, so no local Python or uv install is needed.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

docker run --rm `
    -v "${Root}\backend:/app" `
    -w /app `
    -e UV_LINK_MODE=copy `
    ghcr.io/astral-sh/uv:python3.13-bookworm-slim `
    uv run pytest @args
