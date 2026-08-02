# Build walkthrough

What each part of the build does and why, assuming no Docker or backend background. One section per part
of [PLAN.md](PLAN.md).

## Part 2: scaffolding

### What we built

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

### Docker in ninety seconds

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

### Our Dockerfile, line by line

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

### Why uv, and what a lockfile is for

`uv` is a fast Python package manager — same job as `pip`, considerably quicker. It gives us two files:

- **[pyproject.toml](../backend/pyproject.toml)** — what we asked for: `fastapi>=0.121.2`. Loose ranges.
- **[uv.lock](../backend/uv.lock)** — what we actually got: `fastapi 0.141.1`, plus everything those
  packages themselves depend on (29 in total), at exact versions, with checksums.

`uv sync --locked` installs exactly the lockfile and fails if it disagrees with `pyproject.toml`. So the
image built today and the one built in six months are identical, even though new FastAPI versions will have
shipped. The lockfile is committed to git for this reason.

Everything lands in a **virtual environment** at `/app/.venv` — a private folder of packages, so this
project's dependencies can't collide with another's.

### The backend

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

### The tests

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

#### Why the tests were written first

We wrote each test, **ran it, and watched it fail** before writing the code to make it pass. The first run
gave `ModuleNotFoundError`, the second gave two clean `assert 404 == 200` failures, and only then did
`main.py` get written.

This feels like a detour and isn't. A test written after the code passes on the first run, and a test that
has never failed has never proved it can detect anything. Watching it fail for the *expected* reason is what
establishes that it is actually testing the thing you think it is.

### The scripts

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

### Secrets

`OPENROUTER_API_KEY` lives in `.env` at the project root, which is in both `.gitignore` and `.dockerignore`.
`start` passes it with `--env-file`, which injects it into the container's environment **at run time**.

The distinction matters. Anything `COPY`d in at build time is permanently baked into the image — recoverable
by anyone who gets a copy, even if a later step deletes it, because every layer is retained. Run-time
injection means the key exists only in the running container's memory. Same reason the key never reached
GitHub when we pushed.

### Command cheat sheet

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

## Part 3: the real frontend

### What changed

The placeholder page is gone. `/` now serves the actual Kanban board, and cards became editable.

What did **not** change is the interesting part: same container, same FastAPI server, same mount, same
scripts. Only the contents of `static/` are different. That was the point of the Part 2 structure.

```
Part 2:  static/  =  one hand-written index.html
Part 3:  static/  =  the compiled Next.js app
```

### Static export: what "static" means

A React app can be served two ways. Either a Node.js server runs continuously, building each page on
request — that's what `npm run dev` does — or you compile the whole thing once, up front, into plain files
and serve those.

We do the second, by setting one line in [next.config.ts](../frontend/next.config.ts):

```ts
const nextConfig: NextConfig = {
  output: "export",
};
```

Now `npm run build` writes a folder called `out/` containing `index.html`, a `_next/` folder of JavaScript
and CSS, and nothing else. No server. Any web server that can hand over files can serve it — including the
`StaticFiles` mount we already had.

The app is still fully interactive once it loads. Drag and drop, editing, adding cards all run as
JavaScript **in your browser**. "Static" describes how the files are delivered, not how the app behaves.

The tradeoff: nothing can be computed per-request on the server. For this app that costs nothing, because
anything dynamic goes through `/api` anyway.

### Where the multi-stage build finally pays off

In Part 2 the node stage was a placeholder that just carried a file. Now it does real work:

```dockerfile
FROM node:22-bookworm-slim AS static-build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
```

then, in the Python stage:

```dockerfile
COPY --from=static-build /build/out ./static
```

That last line copies **only** `out/`. Node.js, `npm`, and the 496 MB of `node_modules` needed to compile
the app stay behind in the discarded first stage. The shipped image contains Python, FastAPI, and some
HTML — around 400 MB, nearly all of it the Debian and Python base layers rather than anything we added.
Build tools are needed to *make* the thing, not to *run* it, and multi-stage builds are how you express
that difference.

Note `npm ci` runs before the source is copied, for the same caching reason as Part 2: edit a component and
Docker reuses the cached dependency install instead of redownloading everything.

### The bug this caused, and the pattern that fixed it

Moving the built site into the image broke every backend test. Worth understanding, because the failure
mode is common and the error message points somewhere unhelpful.

`backend/static/` used to exist in the repo. Now it exists *only inside the image*. So on your Mac, this
line had nothing to point at:

```python
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True))
```

Python executes code as it imports a file, top to bottom. `StaticFiles` checks the directory at
construction and raises immediately if it's missing. That happens while pytest is still **collecting**
tests — the phase where it imports every test file to discover what to run. So the crash landed before a
single test executed, and all five failed at once:

```
RuntimeError: Directory '/app/static' does not exist
```

Two changes fixed it. First, `check_dir=False`, telling `StaticFiles` not to verify up front; a request for
a missing file simply 404s. Second, and more useful, an **app factory**:

```python
def create_app(static_dir: Path = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="Kanban Studio")
    ...
    return app

app = create_app()
```

Instead of one app object created at import, there's a function that builds one on demand. Production calls
it once with the default. Tests call it with a directory they control. The general lesson: when something
is hard to test, the usual cause is that it's hard-wired at construction, and the usual fix is to pass it
in.

### How the backend tests use that

```python
@pytest.fixture
def client(tmp_path):
    (tmp_path / "index.html").write_text("<h1>Kanban Studio</h1>")
    ...
    return TestClient(create_app(tmp_path))


def test_root_serves_the_built_index(client):
    assert "Kanban Studio" in client.get("/").text
```

A **fixture** is pytest's setup mechanism. Name a fixture as a function parameter and pytest runs it first
and passes the result in. `tmp_path` is built in: a fresh empty directory per test, deleted afterwards.

So each test builds a miniature fake "build output" and asserts the server serves it. The tests never
depend on anyone having run `npm run build`, which is what makes them fast and reliable. There is also a
test that a *missing* directory still leaves `/api/health` working — a regression guard for the exact bug
above.

### Editing a card: the draft pattern

Click a title, it becomes a text box. This is the standard React shape for editable text:

```tsx
const [editing, setEditing] = useState<"title" | "details" | null>(null);
const [draft, setDraft] = useState("");
```

`editing` records which field is open, `draft` holds what you've typed **so far**. Crucially, typing does
not touch the real card. The card only changes when you commit — Enter or clicking away. Press Escape and
we throw the draft away and the original is untouched.

That separation is the whole reason a "cancel" is possible. If keystrokes wrote straight to the card, there
would be nothing left to restore.

Details is a `<textarea>` rather than an `<input>`, so Enter has to insert a newline instead of committing;
that field commits on blur only. A title emptied to whitespace is discarded rather than saved, since a card
with no title is unusable.

### The drag-and-drop conflict

The whole card is the drag handle — the drag library's event handlers are attached to the card element:

```tsx
{...attributes}
{...(editing ? {} : listeners)}
```

Drag libraries work by capturing pointer events and calling `preventDefault()` to stop the browser doing
its normal thing, like selecting text. That is exactly what you need for dragging and exactly what breaks a
text box: clicks never focus it, and you cannot select a word.

The fix is that second line. When `editing` is set, the drag listeners are simply not attached, so the
field behaves like a normal field. Release the field and dragging comes back.

**This class of bug is invisible to unit tests.** They run in jsdom, a fake browser with no real pointer
handling and no layout, so the conflict cannot occur there. Only a real browser shows it, which is why the
end-to-end test asserts the field actually received focus:

```ts
await card.getByText("Align roadmap themes").click();
await expect(input).toBeFocused();
```

Without that line the test would pass whether or not the feature works.

### The end-to-end tests now test the real thing

Previously Playwright started `next dev` — a development server that never runs in production — and tested
that. Now it tests the container:

```ts
use: { baseURL: "http://localhost:8000" },
webServer: {
  command: "../scripts/start.sh",
  url: "http://localhost:8000/api/health",
  reuseExistingServer: true,
},
```

Playwright runs `start.sh` itself, waits for the health endpoint, then drives a real Chrome against the
compiled app served by FastAPI. So the tests now exercise the artifact you actually ship, not a
development-mode approximation of it.

The catch is `reuseExistingServer: true`: if a container is already running it is reused, even if it was
built from older code. Run `scripts/stop.sh` first when you need certainty.

### Test counts after Part 3

```
5   backend            pytest, in the uv container
16  frontend unit      vitest, in jsdom
4   end to end         playwright, against the container
```

Each was written before the code that satisfies it, and each was watched failing first. The three failures
looked like `updateCard is not a function`, then `Unable to find a label with the text of: Card title`,
then the `RuntimeError` above — each one naming the thing that did not exist yet.

### What Part 4 changes

Hitting `/` will require logging in. FastAPI gains `/api/login`, `/api/logout` and `/api/me`, and sets a
session cookie the browser sends back on every later request. The board renders only once that check
passes.

## Part 4: signing in

### The problem cookies solve

HTTP has no memory. Each request arrives with no idea that you sent one a second ago, so "I already
logged in" is not something the server knows — it has to be re-established on every single request.

A **cookie** is how. The server sends a `Set-Cookie` header once, the browser stores it, and the browser
then attaches it automatically to every later request to that site. You never write code to send it; that
is the browser's job.

```
POST /api/login  {username, password}
  <- 200, Set-Cookie: session=eyJ1c2Vy...

GET /api/me
  -> Cookie: session=eyJ1c2Vy...     (browser adds this by itself)
  <- 200 {"username": "user"}
```

A **session** is just what we chose to put in that cookie: the fact that this browser belongs to `user`.

### Why the cookie has to be signed

Here is the obvious approach and why it fails. Put `session=user` in a plain cookie, then trust it.

Cookies live in the browser, which the visitor controls entirely. Anyone can open developer tools and edit
`session=user` to `session=admin`. A plain cookie is a claim, not proof.

So we **sign** it. The server holds a secret string, and appends a signature computed from the cookie's
contents plus that secret. Change one character of the contents and the signature no longer matches, so the
server rejects it. Forging a valid signature means guessing the secret.

That is what `SessionMiddleware` and the `itsdangerous` library do:

```python
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax")
```

`request.session` then behaves like a dictionary. Write to it, and the middleware encodes and signs the
whole thing into the cookie on the way out; read from it, and the middleware has already verified the
signature on the way in.

`SESSION_SECRET` comes from the environment with a local development fallback. Change it and every existing
session becomes invalid, because none of the old signatures verify any more — which is exactly the
behaviour you want if a secret ever leaks.

Note the cookie is signed, not encrypted: its contents are readable by anyone holding it. Signing proves
nobody *altered* it. Don't put anything private in a session cookie.

### Two flags that matter

`SessionMiddleware` sets both for us, and both defend against a specific attack:

- **HttpOnly** — JavaScript cannot read the cookie. If someone manages to inject a script into your page,
  it still cannot read the session and send it elsewhere. A test asserts this flag is present, because
  losing it is silent and serious.
- **SameSite=Lax** — the browser will not attach the cookie to requests originating from another site.
  That blocks the trick where a malicious page quietly fires a request at your app and rides your session.

### Dependencies: FastAPI's way of saying "signed in required"

```python
def require_user(request: Request) -> User:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Not signed in")
    return User(username=username)


@app.get("/api/me")
def me(user: User = Depends(require_user)) -> User:
    return user
```

`Depends` tells FastAPI: before running this route, run `require_user` and pass me the result. If it raises
401, the route never executes.

This matters more than it looks. The requirement is declared in the function signature rather than as a
line of code you have to remember to write at the top of every handler. Parts 6 and 9 add routes returning
board contents, and each one needs exactly this parameter. **A route without it is open to the world**, so
it is worth grepping for when adding endpoints.

`Credentials` and `User` are Pydantic models — classes describing a shape. FastAPI reads them and validates
the incoming JSON for free: send a login request without a password and you get a 422 explaining what was
missing, without a single line of checking code.

### The bit that surprises people: the login page is not a lock

Our frontend is a static export. There is one `index.html` and it is served to **everyone**, signed in or
not. The gate is a decision the JavaScript makes after it loads:

```tsx
fetchMe().then(setUser)...

if (!user) return <LoginForm onSignedIn={setUser} />;
return <KanbanBoard ... />;
```

So an unauthenticated visitor genuinely downloads the board's code. They just never receive any **data**,
because `/api` refuses them.

That distinction is the whole point:

| | What it does |
|---|---|
| The login screen | Decides what to render. A convenience. |
| `require_user` on `/api` | Decides what data leaves the server. The actual security. |

This is not a weakness of static export — client-side checks are never the real defence in *any*
architecture, because the client is under the visitor's control. A server-rendered app can hide the HTML,
which is tidier, but if its API were unprotected it would be just as exposed. The rule generalises: security
lives where the data lives.

The end-to-end suite asserts this directly rather than through the UI:

```ts
test("the API refuses to identify a signed-out visitor", async ({ request }) => {
  const response = await request.get("/api/me");
  expect(response.status()).toBe(401);
});
```

No browser, no login form — just the raw request an attacker would make.

### The frontend gate

`AuthGate` is a small state machine with three states: still checking, signed out, signed in.

```tsx
const [user, setUser] = useState<User | null>(null);
const [checking, setChecking] = useState(true);
```

The `checking` flag exists because asking the server takes time. Without it there would be a flash of the
login form before the answer arrives, even for someone already signed in.

One small design choice worth copying: `fetchMe()` returns `null` for a 401 instead of throwing. Being
signed out is a normal, expected answer, not an error, so callers get a plain `if` rather than a
`try/catch`. Reserve exceptions for things that genuinely went wrong.

### Testing without a server: mocking

The unit tests never start FastAPI. They replace the browser's `fetch` with a fake that returns whatever
the test wants:

```ts
const mockApi = (routes: Record<string, Reply>) => { ... }

mockApi({
  "GET /api/me": { status: 401 },
  "POST /api/login": { status: 200, body: { username: "user" } },
});
```

Instant, and it can produce responses that are awkward to trigger for real. The cost is that a mock is your
*assumption* about the server: if the real API changed its shape, these tests would keep passing while the
app broke. That is why the same flows are also covered end to end against the real container. Mocks check
your logic; end-to-end checks your assumptions.

### Two false alarms from the test suite

Both were bugs in the tests, not the app, and both are the kind of thing that wastes an afternoon.

**Both screens render the same heading.** The login form and the board each show `<h1>Kanban Studio</h1>`,
so "the board is not showing" could not be asserted by looking for that heading. Fixed by asserting on
something only the board has — its column elements. Lesson: assert on what makes the thing *distinct*.

**Next.js adds an invisible alert.** The test looked for the error message via `getByRole("alert")` and
failed even though the message was plainly there. The page contained *two* elements with that role: ours,
and a hidden one Next injects to announce route changes to screen readers. Playwright refuses to guess
between two matches. Fixed by scoping the search to the form.

The second one was only diagnosable because Playwright saves a snapshot of the page on failure, which
listed both alerts. When a test fails for a reason that makes no sense, read the artifacts before changing
any code.

### Honest limitations

Fine for a local MVP, not fine for anything real:

- The password is compared as plain text against a constant. Real systems store a hash, from a slow
  algorithm built for the purpose, so a stolen database does not hand over everyone's password.
- One hardcoded account. Part 5 designs a users table.
- No rate limiting, so passwords could be guessed indefinitely.
- The dev `SESSION_SECRET` is in the repository. Anything public needs a real one from the environment.

### Test counts after Part 4

```
13  backend            pytest
21  frontend unit      vitest
10  end to end         playwright
```

### What Part 5 changes

No code at all. Part 5 designs the SQLite schema — users, boards, and the board stored as JSON — writes it
up in `docs/DATABASE.md`, and stops for sign-off. Part 6 then builds against the agreed design rather than
discovering it while writing queries.
