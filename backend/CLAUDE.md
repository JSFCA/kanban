# Backend

FastAPI app serving the API under `/api` and the static frontend at `/`. Dependencies are managed by `uv`;
the app only ever runs inside the container.

## Layout

```
app/main.py       create_app factory: routes, static mount
tests/            pytest suites
pyproject.toml    dependencies and pytest config
uv.lock           pinned versions, committed
```

There is no `static/` directory in the repository. Docker builds the Next.js export and copies it to
`/app/static` inside the image, so it exists at run time but never in a host checkout.

## Conventions

- API routes live under `/api` and must be registered **before** the `StaticFiles` mount at `/`, which is a
  catch-all. Anything registered after it is unreachable.
- Add routes inside `create_app`, above the `app.mount` call.
- `StaticFiles` uses `check_dir=False`. Without it, importing `app.main` on a host checkout raises
  `RuntimeError: Directory '/app/static' does not exist` and every test fails at collection.
- `STATIC_DIR` resolves relative to `app/main.py`, not the working directory, so tests and the container
  agree.
- Tests call `create_app(tmp_path)` with a fixture directory rather than importing the module-level `app`,
  which keeps static-serving assertions hermetic. `pythonpath = ["."]` in `pyproject.toml` makes the import
  work.
- `httpx2` is the dev dependency, not `httpx` — Starlette's `TestClient` deprecates the latter.

## Auth

`SessionMiddleware` signs an HttpOnly `session` cookie with `SESSION_SECRET` (env var, with a local
development default). The MVP account is hardcoded as `USERNAME` / `PASSWORD` in `app/main.py`.

- Any route that returns user data must take `user: User = Depends(require_user)`. That dependency raises
  401 when the session is empty. Forgetting it is the way this app leaks data.
- `/api/health` stays public on purpose: `start.sh` and Playwright's `webServer` poll it before anyone can
  sign in.
- The frontend is a static export, so the HTML shell is served to everyone. The login screen is a
  presentation gate; the real boundary is `require_user` on the API.

## Running

```
scripts/test.sh      # pytest inside the uv image, no local Python needed
scripts/start.sh     # build and run the container
```

Regenerate the lockfile after changing dependencies:

```
docker run --rm -v "$PWD/backend":/app -w /app ghcr.io/astral-sh/uv:python3.13-bookworm-slim uv lock
```
