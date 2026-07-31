# Kanban Studio

A single-board project management app: Kanban board with an AI chat sidebar. Runs locally in one Docker
container — FastAPI serves the API under `/api` and the static Next.js frontend at `/`.

## Requirements

Docker. Nothing else; Python, `uv` and Node all run inside containers.

## Run

```
scripts/start.sh     # Mac and Linux
scripts/start.ps1    # Windows
```

Then open http://localhost:8000. Stop with `scripts/stop.sh` or `scripts/stop.ps1`.

## Test

```
scripts/test.sh      # backend, pytest
scripts/test.ps1     # backend, pytest on Windows

cd frontend && npm run test:all   # frontend, vitest and playwright
```

## Configuration

`OPENROUTER_API_KEY` in `.env` at the project root. `start` passes it to the container at run time.

## Docs

- [CLAUDE.md](CLAUDE.md) — requirements, technical decisions, standards
- [docs/PLAN.md](docs/PLAN.md) — the ten-part build plan
- [backend/CLAUDE.md](backend/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md), [scripts/CLAUDE.md](scripts/CLAUDE.md)
