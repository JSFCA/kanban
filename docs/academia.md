# Part 2 explained

A walkthrough of what the scaffolding does and why, assuming no Docker or backend background.

## What we built

One web server, running inside one container, doing two jobs:

```
browser  ->  http://localhost:8000
                    |
                    v
             [ Docker container ]
                    |
              FastAPI (Python)
                 /        \
        /api/health      everything else
        returns JSON     serves files from static/
```

Visiting `/` gets an HTML page. That page then asks `/api/health` for JSON and displays the answer. That
round trip is the whole point of Part 2: it proves the frontend and the API are wired together and reachable
from your browser.

## Docker in ninety seconds

The problem Docker solves: "it works on my machine". Your Mac has Python 3.9; the app wants 3.13. Someone
else has neither.

Three terms:

- **Image** — a frozen snapshot of a filesystem: an OS, Python, your code, your dependencies. Like a class
  in code, or an ISO file. It doesn't run.
- **Container** — a running instance of an image. Like an object created from a class. You can start, stop
  and delete containers freely; the image stays put.
- **Dockerfile** — the recipe for building an image. Each line is a step.

Key consequence: containers are disposable. Delete one and anything written inside it is gone. That is why
Part 5 will put the database file on a *volume* — a folder on your Mac mounted into the container — so data
survives.

Docker also **caches** each Dockerfile step as a layer. If nothing above a step changed, Docker reuses the
cached result. This is why the file is ordered the way it is: dependencies (slow, rarely change) are
installed *before* your source code (fast, changes constantly). Edit `main.py` and the rebuild skips
straight past the dependency install.

## Our Dockerfile, line by line

```dockerfile
FROM node:22-bookworm-slim AS static-build
WORKDIR /build
COPY backend/static ./static
```

`FROM` picks a starting image — here, one with Node.js preinstalled, on a slim Debian base. `AS static-build`
names this **stage**. `WORKDIR` is `cd`. `COPY` copies from your project into the image.

Right now this stage just carries the placeholder HTML. In Part 3 it will run `npm run build` to compile the
Next.js app. This is a **multi-stage build**: build tooling lives in one stage, and only the *output* is
copied into the final image. The finished image therefore contains no Node.js, no `node_modules` — just the
built HTML. Smaller image, less to go wrong.

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
```

Second stage, the one that actually runs. It starts from an image with Python 3.13 and `uv` already
installed. `ENV` sets environment variables: precompile Python for faster startup, copy files instead of
hardlinking (hardlinks fail across Docker's filesystem boundaries), and put the virtual environment's
programs first on the `PATH` so typing `uvicorn` finds ours.

```dockerfile
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-install-project
```

Copy *only* the dependency files, then install. Because this happens before the source copy, editing your
code doesn't invalidate this cached layer.

```dockerfile
COPY backend/app ./app
COPY backend/tests ./tests
COPY --from=static-build /build/static ./static
```

Now the code. The third line is the multi-stage payoff: reach into the earlier stage and take only its
`static` folder.

```dockerfile
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`EXPOSE` is documentation — it declares the port but doesn't open it. `CMD` is what runs when the container
starts.

`0.0.0.0` matters. The default, `127.0.0.1`, means "only accept connections from this machine" — and inside
a container, "this machine" is the container, so your browser would be refused. `0.0.0.0` means "accept on
all network interfaces".

`app.main:app` reads as: in the `app` package, in `main.py`, use the variable named `app`.

There is also a [.dockerignore](../.dockerignore), which is `.gitignore` for Docker builds. It keeps
`node_modules`, `.git` and `.env` out of the image — faster builds, and secrets never land in an image
someone could inspect.

## Why uv, and what a lockfile is for

`uv` is a fast Python package manager — same job as `pip`, considerably quicker. It gives us two files:

- **[pyproject.toml](../backend/pyproject.toml)** — what we asked for: `fastapi>=0.121.2`. Loose ranges.
- **[uv.lock](../backend/uv.lock)** — what we actually got: `fastapi 0.141.1`, plus everything those
  packages themselves depend on (29 in total), at exact versions, with checksums.

`uv sync --locked` installs exactly the lockfile and fails if it disagrees with `pyproject.toml`. So the
image built today and the one built in six months are identical, even though new FastAPI versions will have
shipped. The lockfile is committed to git for this reason.

Everything lands in a **virtual environment** at `/app/.venv` — a private folder of packages, so this
project's dependencies can't collide with another's.

## The backend

All of [backend/app/main.py](../backend/app/main.py):

```python
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Kanban Studio")

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
```

**FastAPI** is a Python web framework. `@app.get("/api/health")` is a decorator that registers the function
below it as the handler for `GET /api/health`. Return a dict and FastAPI converts it to JSON and sets the
right headers. That's the entire API surface so far.

`app.mount(...)` attaches a whole sub-application — here, a file server. Anything under `/` that isn't an
API route gets looked up as a file in `static/`. `html=True` makes a request for `/` serve `index.html`.

**Two subtleties worth knowing, because both are easy to get wrong:**

1. **Order matters.** The mount at `/` is a catch-all. FastAPI checks routes in registration order, so
   `/api/health` must be registered *before* the mount or it becomes unreachable. Any route added later
   must go above that line. This is why it's the last statement in the file, with a comment.

2. **Paths are resolved relative to the file, not the shell.** `Path(__file__).resolve().parent.parent`
   means "start from `main.py`, go up two levels". Had we written `"static"`, it would resolve relative to
   whatever directory the server happened to be launched from — working in the container, breaking in tests.

## The tests

[backend/tests/test_health.py](../backend/tests/test_health.py) uses FastAPI's `TestClient`:

```python
client = TestClient(app)

def test_health_returns_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

`TestClient` calls the app directly in memory — no server started, no network, no port. That's why the whole
suite runs in 0.25 seconds. **pytest** finds these automatically: any file named `test_*.py`, any function
named `test_*`. `assert` is plain Python; pytest rewrites it to print useful failure messages.

Three tests: health returns the right JSON, `/` serves the HTML page, and an unknown `/api/...` path returns
404. The third guards subtlety 1 above — proof that the catch-all mount isn't quietly swallowing bad API
paths and returning the HTML page instead.

### Why the tests were written first

We wrote each test, **ran it, and watched it fail** before writing the code to make it pass. The first run
gave `ModuleNotFoundError`, the second gave two clean `assert 404 == 200` failures, and only then did
`main.py` get written.

This feels like a detour and isn't. A test written after the code passes on the first run, and a test that
has never failed has never proved it can detect anything. Watching it fail for the *expected* reason is what
establishes that it is actually testing the thing you think it is.

## The scripts

Three jobs, in `.sh` (Mac/Linux) and `.ps1` (Windows) — same behaviour either way.

**[start](../scripts/start.sh)** builds the image, removes any old container, runs a new one, then polls
`/api/health` for up to 30 seconds before reporting the URL. That poll matters: `docker run -d` returns
immediately and "successfully" even if the app crashes a second later, so without it you'd get a cheerful
success message and a broken page.

```
-p 8000:8000    map port 8000 on your Mac to 8000 in the container
-d              detached: run in the background
--name          a fixed name, so stop knows what to remove
```

**[stop](../scripts/stop.sh)** removes the container. It checks the container exists first rather than
trusting `docker rm -f`'s exit code — that command returns "success" whether or not anything was there, so
the first version cheerfully reported "Stopped" when nothing was running.

**[test](../scripts/test.sh)** runs pytest inside the `uv` image with your `backend/` folder
**bind-mounted** — `-v "$ROOT/backend":/app` makes a folder on your Mac appear inside the container. Because
the container reads your real files rather than a copy baked into an image, edits take effect immediately
with no rebuild. This is why you don't need Python or `uv` installed to run the tests.

## Secrets

`OPENROUTER_API_KEY` lives in `.env` at the project root, which is in both `.gitignore` and `.dockerignore`.
`start` passes it with `--env-file`, which injects it into the container's environment **at run time**.

The distinction matters. Anything `COPY`d in at build time is permanently baked into the image — recoverable
by anyone who gets a copy, even if a later step deletes it, because every layer is retained. Run-time
injection means the key exists only in the running container's memory. Same reason the key never reached
GitHub when we pushed.

## Command cheat sheet

```
scripts/start.sh              build and run
scripts/stop.sh               stop and remove
scripts/test.sh               run the backend tests
scripts/test.sh -q            ...quietly (extra args pass through to pytest)

docker ps                     what's running
docker ps -a                  ...including stopped
docker logs kanban-studio     the server's output, for when something breaks
docker exec -it kanban-studio bash    open a shell inside the container
docker images                 images on disk
```

## What Part 3 changes

The `static-build` stage stops copying the placeholder and starts running `npm run build`, producing the real
Kanban board. Everything else — the runtime stage, the mount, the scripts — stays as it is. That was the
point of building it this way.
