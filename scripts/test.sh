#!/usr/bin/env bash
# Run the backend tests. Mac and Linux.
# Runs pytest inside the uv image, so no local Python or uv install is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker run --rm \
  -v "$ROOT/backend":/app \
  -w /app \
  -e UV_LINK_MODE=copy \
  ghcr.io/astral-sh/uv:python3.13-bookworm-slim \
  uv run pytest "$@"
