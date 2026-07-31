#!/usr/bin/env bash
# Build and run Kanban Studio. Mac and Linux.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="kanban-studio"
CONTAINER="kanban-studio"
PORT="${PORT:-8000}"

cd "$ROOT"
docker build -t "$IMAGE" .
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

if [ -f "$ROOT/.env" ]; then
  docker run -d --name "$CONTAINER" -p "$PORT:8000" --env-file "$ROOT/.env" "$IMAGE"
else
  echo "Warning: no .env found; OPENROUTER_API_KEY will not be set." >&2
  docker run -d --name "$CONTAINER" -p "$PORT:8000" "$IMAGE"
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Kanban Studio running at http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done

echo "Container did not become healthy. Logs:" >&2
docker logs "$CONTAINER" >&2
exit 1
