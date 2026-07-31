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

Backend. Needs nothing installed; pytest runs inside the uv image.

```
scripts/test.sh      # Mac and Linux
scripts/test.ps1     # Windows
```

Frontend. One-time setup first, then the suites.

```
cd frontend
npm ci
npx playwright install chromium

npm run test        # unit, vitest
npm run test:e2e    # end to end, playwright
npm run test:all    # both
```

12 tests in total: 3 backend, 6 frontend unit, 3 end to end.

If `npm ci` fails with `EACCES` in `~/.npm/_cacache`, a past `sudo npm` left root-owned files in the
cache. Fix with `sudo chown -R $(whoami) ~/.npm`, or bypass it with `npm ci --cache /tmp/npm-cache`.

## Configuration

`OPENROUTER_API_KEY` in `.env` at the project root. `start` passes it to the container at run time.

## Docs

- [CLAUDE.md](CLAUDE.md) — requirements, technical decisions, standards
- [docs/PLAN.md](docs/PLAN.md) — the ten-part build plan
- [backend/CLAUDE.md](backend/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md), [scripts/CLAUDE.md](scripts/CLAUDE.md)
