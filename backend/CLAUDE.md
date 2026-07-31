# Backend

FastAPI app serving the API under `/api` and the static frontend at `/`. Dependencies are managed by `uv`;
the app only ever runs inside the container.

## Layout

```
app/main.py       FastAPI app, routes, static mount
static/           the site served at / (placeholder now; the Next.js build lands here in Part 3)
tests/            pytest suites
pyproject.toml    dependencies and pytest config
uv.lock           pinned versions, committed
```

## Conventions

- API routes live under `/api` and must be registered **before** the `StaticFiles` mount at `/`, which is a
  catch-all. Anything registered after it is unreachable.
- `STATIC_DIR` resolves relative to `app/main.py`, not the working directory, so tests and the container
  agree.
- Tests import `from app.main import app`; `pythonpath = ["."]` in `pyproject.toml` makes that work.
- `httpx2` is the dev dependency, not `httpx` — Starlette's `TestClient` deprecates the latter.

## Running

```
scripts/test.sh      # pytest inside the uv image, no local Python needed
scripts/start.sh     # build and run the container
```

Regenerate the lockfile after changing dependencies:

```
docker run --rm -v "$PWD/backend":/app -w /app ghcr.io/astral-sh/uv:python3.13-bookworm-slim uv lock
```
