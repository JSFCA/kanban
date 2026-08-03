#!/usr/bin/env bash
# Run the backend tests. Mac and Linux.
# Runs pytest inside the uv image, so no local Python or uv install is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The AI tests call OpenRouter for real, so the suite needs the key. The app
# also refuses to start without it, so a missing .env would otherwise surface
# as every test failing at startup.
if [ ! -f "$ROOT/.env" ]; then
  echo "No .env found at $ROOT/.env. It must contain OPENROUTER_API_KEY." >&2
  exit 1
fi

docker run --rm \
  -v "$ROOT/backend":/app \
  -w /app \
  -e UV_LINK_MODE=copy \
  --env-file "$ROOT/.env" \
  ghcr.io/astral-sh/uv:python3.13-bookworm-slim \
  uv run pytest "$@"
