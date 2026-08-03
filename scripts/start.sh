#!/usr/bin/env bash
# Build and run Kanban Studio. Mac and Linux.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="kanban-studio"
CONTAINER="kanban-studio"
PORT="${PORT:-8000}"

cd "$ROOT"

# The app refuses to start without OPENROUTER_API_KEY. Say so now rather than
# building an image and then spending 120s watching the container crash-loop.
if [ ! -f "$ROOT/.env" ]; then
  echo "No .env found at $ROOT/.env. It must contain OPENROUTER_API_KEY." >&2
  exit 1
fi

docker build -t "$IMAGE" .
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

# The database lives on the host so it survives rebuilding the image.
mkdir -p "$ROOT/data"

docker run -d --name "$CONTAINER" -p "$PORT:8000" \
  -v "$ROOT/data":/app/data --env-file "$ROOT/.env" "$IMAGE"

# Generous budget on purpose. The only way this script can exit before the app
# is reachable is by exhausting this loop, and a machine that has just finished
# a docker build -- or is setting up the ./data bind mount for the first time --
# can take well over half a minute to answer. A short budget here surfaces as
# "webServer exited early" in Playwright, which points nowhere useful.
for attempt in $(seq 1 120); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Kanban Studio running at http://localhost:$PORT"
    exit 0
  fi
  if [ $((attempt % 15)) -eq 0 ]; then
    echo "Still waiting for http://localhost:$PORT/api/health (${attempt}s)..." >&2
  fi
  sleep 1
done

echo "Container did not become healthy after 120s. Logs:" >&2
docker logs "$CONTAINER" >&2
exit 1
