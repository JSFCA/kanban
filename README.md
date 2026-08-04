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

Then open http://localhost:8000 and sign in with `user` / `password`. Stop with `scripts/stop.sh` or
`scripts/stop.ps1`.

## Test

Backend. Needs nothing installed; pytest runs inside the uv image. Needs `.env` and a network, though: the
AI tests call OpenRouter for real.

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

70 tests in total: 36 backend, 22 frontend unit, 12 end to end.

The end-to-end suite starts the container itself and runs serially, because the board is persisted and the
tests share it. Run `scripts/stop.sh` first if you want a guaranteed-fresh build.

If `npm ci` fails with `EACCES` in `~/.npm/_cacache`, a past `sudo npm` left root-owned files in the
cache. Fix with `sudo chown -R $(whoami) ~/.npm`, or bypass it with `npm ci --cache /tmp/npm-cache`.

## Configuration

`.env` at the project root, passed to the container at run time by `start`:

- `OPENROUTER_API_KEY` — required. The app refuses to start without it, and `start` and `test` both refuse
  to run without the file
- `SESSION_SECRET` — optional; signs the session cookie. Falls back to a local development default

The SQLite database is written to `data/kanban.db`, which `start` bind-mounts into the container. It is
created and seeded on first run, gitignored, and survives rebuilds. Delete the directory for a clean slate.

## Docs

- [CLAUDE.md](CLAUDE.md) — requirements, technical decisions, standards
- [docs/PLAN.md](docs/PLAN.md) — the ten-part build plan, decisions and progress
- [docs/DATABASE.md](docs/DATABASE.md) — schema design and its reasoning
- [docs/academia.md](docs/academia.md) — a walkthrough of each part for a reader new to Docker and backends
- [backend/CLAUDE.md](backend/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md), [scripts/CLAUDE.md](scripts/CLAUDE.md)
