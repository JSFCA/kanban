#!/usr/bin/env bash
# Stop and remove the Kanban Studio container. Mac and Linux.
set -euo pipefail

CONTAINER="kanban-studio"

# `docker rm -f` exits 0 whether or not the container exists, so check first.
if [ -n "$(docker ps -aq --filter "name=^${CONTAINER}$")" ]; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "Stopped $CONTAINER."
else
  echo "$CONTAINER was not running."
fi
