# Backend

FastAPI app serving the API under `/api` and the static frontend at `/`. Dependencies are managed by `uv`;
the app only ever runs inside the container.

## Layout

```
app/main.py       create_app factory: routes, static mount, lifespan
app/db.py         connection helper, schema, load_board / save_board
app/models.py     Card, Column, BoardData with their invariant
app/seed.py       the demo board a new user starts with
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
- `/api/health` stays public on purpose: `start.sh` polls it before anyone can sign in, and Playwright's
  global setup waits on it.
- The frontend is a static export, so the HTML shell is served to everyone. The login screen is a
  presentation gate; the real boundary is `require_user` on the API.

## Database

SQLite at `/app/data/kanban.db`, bind-mounted from `./data` on the host. Design and reasoning are in
[../docs/DATABASE.md](../docs/DATABASE.md).

- **Always open connections through `db.connect()`.** `PRAGMA foreign_keys` is per-connection, so a
  connection opened any other way silently loses referential integrity. Proven, not theoretical — see
  `test_foreign_keys_are_enforced_on_every_connection`.
- The schema is created in the FastAPI **lifespan**, not at import. Importing `app.main` must never touch
  disk, which is also why tests use `with TestClient(app)` — the schema is created when startup runs.
- `boards` has no `UNIQUE(user_id)` on purpose, so queries use
  `WHERE user_id = ? ORDER BY id LIMIT 1`. Never assume a user has exactly one row.
- `BoardData` validates that every `cardIds` entry resolves to a real card. The board is one JSON blob, so
  the database cannot express that with a foreign key; the model is the only thing enforcing it. Part 9
  relies on this to reject bad AI output.
- `app/seed.py` is the only source of the demo board. The frontend's `initialData` was deleted in Part 7.

## Running

```
scripts/test.sh      # pytest inside the uv image, no local Python needed
scripts/start.sh     # build and run the container
```

Regenerate the lockfile after changing dependencies:

```
docker run --rm -v "$PWD/backend":/app -w /app ghcr.io/astral-sh/uv:python3.13-bookworm-slim uv lock
```
