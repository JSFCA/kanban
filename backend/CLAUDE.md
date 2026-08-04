# Backend

FastAPI app serving the API under `/api` and the static frontend at `/`. Dependencies are managed by `uv`;
the app only ever runs inside the container.

## Layout

```
app/main.py       create_app factory: routes, static mount, lifespan
app/ai.py         OpenRouter client, prompt and tool schema: no FastAPI, no DB, no retries
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
- **The HTTP package is `httpx2` and it imports as `httpx2`.** There is no top-level `httpx` in the image;
  Starlette's `TestClient` deprecates the older package. It is a production dependency as of Part 8, not a
  dev one, because `app/ai.py` uses it at run time.
- **`backend/.venv` lives on the host and survives between test runs**, because `scripts/test.sh`
  bind-mounts `backend/`. It can drift from `uv.lock` — a stale `httpx` in there let `import httpx` pass 28
  tests while the container crash-looped on the same line. When the tests and the container disagree,
  `rm -rf backend/.venv` and run again before suspecting the code.

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

## AI

`app/ai.py` wraps one OpenRouter endpoint. Model `nvidia/nemotron-3-ultra-550b-a55b:free`, 30s timeout, no
retries. `POST /api/ai/ping` is the Part 8 smoke route; `POST /api/ai/chat` is the board conversation.

- **The app refuses to start without `OPENROUTER_API_KEY`.** The check is in the lifespan, next to
  `initialise`, so importing the module still touches nothing. `start.sh` and `test.sh` both pass the
  project-root `.env`, and both fail with a clear message if it is absent.
- **`ai.api_key()` reads the environment per call, not at import.** That is what lets a test monkeypatch a
  bad key and exercise the real failure path through the real route.
- **`AIError` is the only error type; the route maps it to 502**, not 500 — the upstream failed, not us.
- **A 200 from OpenRouter does not mean a completion.** Rate limits and some upstream failures come back as
  an `error` object with a 200 status. `extract_message` rejects a body with no `choices` and puts the body
  in the message; before it existed this was a `KeyError` and a 500. Hit during Part 10, after a day of
  live-test runs — the free tier's daily cap is reachable.
- **AI routes are `async def`**, unlike everything else here. A 30s outbound call would otherwise hold a
  threadpool worker for its whole duration.
- **The tests call OpenRouter for real. Nothing in `tests/test_ai.py` is mocked**, including the failure
  path, which uses a deliberately invalid key. The suite therefore needs the network, a valid key, and
  free-tier quota; `:free` is rate-limited per minute and per day, so a long debugging session can exhaust
  the day's allowance and fail the suite for reasons unrelated to the code.
- The timeout path is untested on purpose — forcing it needs a mock. Say so, do not hide it.

### The board conversation (Part 9)

This model has no `response_format`, so the reply gets its schema from a **forced tool call**: one tool,
`respond`, with `tool_choice` naming it.

- **`RESPOND_TOOL` is generated from `BoardData.model_json_schema()`**, so it cannot drift from the models.
  Pydantic's `$defs` are **hoisted to the `parameters` root** — `#/$defs/Card` resolves against the document
  root, and definitions left nested under the `board` property point at nothing.
- **`apply_tool_call` in `app/main.py` is the only thing that writes an AI board.** It validates against
  `BoardData`, and a failure raises `AIError`, which the route maps to **502** with nothing written. A
  rejected update must never be mistakable for a successful one.
- **`board_updated` means the board actually changed.** The model sometimes echoes the board back unchanged
  when answering a question; that is not an update, and Part 10 re-renders whenever the flag is true.
- **History is capped at `ai.HISTORY_LIMIT` (20) turns**, oldest dropped first.
- **The live tests are intermittently red** — one failure in roughly seven runs of the question test. Give
  live assertions messages that name the offending values, or a failure teaches you nothing but "rerun it".
- The rejection path is tested by calling `apply_tool_call` directly with a malformed board. The model
  cannot be made to produce one on demand, and that is our code under test, not a mock of theirs.

## Running

```
scripts/test.sh      # pytest inside the uv image, no local Python needed
scripts/start.sh     # build and run the container
```

Regenerate the lockfile after changing dependencies:

```
docker run --rm -v "$PWD/backend":/app -w /app ghcr.io/astral-sh/uv:python3.13-bookworm-slim uv lock
```
