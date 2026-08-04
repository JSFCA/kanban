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

## Part 5: designing before building

The whole part produced one document, [DATABASE.md](DATABASE.md), and then stopped for approval.

That feels like a detour and is the opposite. Schema decisions are the expensive kind to reverse: once real
rows exist, changing your mind means writing a migration rather than editing a file. Deciding on paper
costs an hour; deciding in code costs a migration and whatever data got mangled on the way.

Three questions were settled there, and each could reasonably have gone the other way — which is exactly
why they were worth asking rather than assuming. Whether `users` should carry a password column. Whether
the database should enforce one board per user. Where the file should live.

The part is also where a claim got checked instead of trusted. The schema was executed against real SQLite,
which surfaced something that would otherwise have been discovered as a mysterious bug much later:

```
connection 1 (ran the schema)  foreign_keys = 1
connection 2 (fresh)           foreign_keys = 0
  INSERT INTO boards (user_id, data) VALUES (999, '{}')  ->  accepted
```

A board belonging to a user who does not exist, stored without complaint. More on why below.

## Part 6: storing the board

### Why a database and not a file

The board is a single JSON document, so "just write it to a file" is a fair question. A database earns its
place here for three reasons: it scopes data to a user without inventing a filename convention, it applies
constraints the application would otherwise have to remember, and it handles two requests arriving at once
without corrupting the file.

**SQLite** is the smallest thing that does that. There is no server process and no configuration — the
whole database is one file, and the library reads and writes it directly. For an app with one user and a
few dozen cards, anything more is overhead. The shape of the code barely changes if you outgrow it.

### The pragma that only half works

This is the most transferable thing in this part.

SQLite lets you declare a foreign key — `boards.user_id REFERENCES users(id)` — meaning a board must belong
to a real user. But **foreign key enforcement is off by default**, and turning it on is per *connection*,
not per database:

```sql
PRAGMA foreign_keys = ON;
```

Run that when you create the schema and it protects exactly one connection: the one that ran it. Every
request afterwards opens a fresh connection, which starts with enforcement off again. The constraint is
still written in the schema, looks correct, and does nothing.

The fix is to make it impossible to get a connection without it:

```python
@contextmanager
def connect(db_path):
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys = ON")
    ...
```

Everything goes through that helper, and a test asserts an orphan insert still raises. The general pattern:
when correctness depends on remembering a setup step, remove the option to forget it.

### Startup, not import

The schema is created when the app *starts*, not when the module is imported:

```python
@asynccontextmanager
async def lifespan(_: FastAPI):
    initialise(db_path, USERNAME)
    yield
```

This is the same lesson Part 3 taught the hard way. Importing a module should compute nothing and touch
nothing — it should only define things. Put `initialise()` at module level and merely importing the file to
run one unrelated test would create directories and databases.

A **lifespan** is FastAPI's hook for "do this once when the server starts, and clean up when it stops". In
tests it runs when `TestClient` is used as a context manager, which is why the board tests say
`with TestClient(app) as client`.

### Idempotent startup

Every startup step is written so that running it a hundred times is the same as running it once:

```sql
CREATE TABLE IF NOT EXISTS users (...)
INSERT OR IGNORE INTO users (username) VALUES (?)
```

That word — **idempotent** — is worth knowing. It means there is no separate "first run" path to get wrong,
no flag file, no "have I set up yet?" check. The server does the same thing on every boot and the outcome
is correct either way.

### Designing around a constraint you deliberately left out

The schema has no rule saying a user gets only one board, because adding more later should not require a
migration. The consequence is that the code cannot assume there is exactly one row:

```sql
SELECT data FROM boards WHERE user_id = ? ORDER BY id LIMIT 1
```

`ORDER BY id LIMIT 1` rather than a bare select. Without the ordering, "the" board is whichever row the
database felt like returning, which can change. If you loosen a guarantee, the code has to become stricter
to compensate — a trade that is easy to make and then forget the second half of.

### Validation the database cannot do

Storing the board as one JSON blob means the database cannot check *inside* it. Nothing stops a column
listing a card id that no longer exists — the UI would silently skip it, and you would be left wondering
where a card went. So the Pydantic model checks it:

```python
@model_validator(mode="after")
def every_card_id_resolves(self):
    dangling = [...]
    if dangling:
        raise ValueError(...)
```

A **validator** runs after the basic type checks and can enforce rules involving several fields at once. A
request that fails it gets a 422 and never reaches the database. Part 9 leans on this heavily, since by
then it is an AI generating the board.

### Containers forget; volumes remember

`stop.sh` deletes the container, and everything written inside its filesystem goes with it. A database
inside the container would last exactly until the next rebuild.

```
host                                    container
./data/kanban.db        <-- mounted -->  /app/data/kanban.db
```

`start.sh` passes `-v "$ROOT/data":/app/data`, which makes that host folder *be* that container folder.
Writes land on your machine and survive anything Docker does. It is also the reason you can open
`data/kanban.db` in a SQLite browser and read exactly what the app stored.

Proving it took stopping the container, rebuilding, starting, and reading the value back — not just
checking that the code looked right.

### The bug that took three parts to catch

The end-to-end suite had been failing intermittently since Part 4. The error was always the same and always
useless:

```
Error: Process from config.webServer exited early.
```

Two earlier attempts to look at it failed because the command being run piped output through `grep` to keep
the logs short — which discarded the very lines that explained the failure. **Filtering output while
debugging hides the answer.**

Running the script under `bash -x` gave the truth immediately:

```
+ echo 'Kanban Studio running at http://localhost:8000'
+ exit 0
START_EXIT=0
Error: Process from config.webServer exited early.
```

The script succeeded. The container was running. Playwright failed anyway.

The cause was a mismatch of expectations. Playwright's `webServer` option is built for a command that
*stays running in the foreground* — `npm run dev`, say — and it treats the command exiting as the server
dying. Our script starts a container in the background and returns immediately. Whether a run passed came
down to whether Playwright's health poll happened to land before the script finished. It had been passing
by luck.

The fix was to use `globalSetup` instead, which is the hook meant for "make sure this external thing is
running before the tests". Then the previously flaky sequence ran four times cold, all green.

Three things generalise from this. An error message names where a problem was *detected*, not where it was
*caused*. An intermittent failure is a real failure with a timing component, not noise to re-run away. And
when you cannot see why something fails, add tracing rather than theories.

## Part 7: joining the two halves

### What changed

The board stopped living in the browser. Until now `KanbanBoard` started from a hardcoded `initialData` and
every edit lived in React state until you refreshed it away. Now it loads from `GET /api/board` and saves
every change with `PUT /api/board`.

`initialData` was **deleted** from the frontend rather than left lying around. Two copies of the same demo
board would drift, and then you would have two answers to "what does a new user see?". One definition,
[backend/app/seed.py](../backend/app/seed.py).

### Update locally, then save

Every mutation funnels through one function:

```tsx
const apply = (next: BoardData, delay = 0) => {
  setBoard(next);           // the UI updates immediately
  ...
  saveTimer.current = setTimeout(() => {
    saveBoard(next).catch((cause) => setError(cause.message));
  }, delay);
};
```

The screen updates first and the server is told afterwards. The alternative — disable the card, send the
request, wait, then re-render — would make every drag feel sluggish for no benefit.

Note what is *not* here: no logic about what a move or an edit means. `moveCard` and `updateCard` still
decide that, exactly as they did when there was no backend, and the server stores whatever they produce.
The rule is one definition of each behaviour. Reimplementing card ordering in Python would mean two
implementations to keep in agreement, and they would eventually disagree.

### Debouncing

Renaming a column fires on every keystroke. Typing "Needs review" is twelve state updates, and without care
twelve HTTP requests — each overwriting the last, eleven of them pointless.

**Debouncing** means waiting for the typing to stop:

```tsx
saveTimer.current = setTimeout(() => saveBoard(next), delay);
```

Each call clears the previous timer, so only the last one survives. Renames pass 400ms; everything else
passes 0, because a click is already a finished action. One shared timer also means a click during typing
saves the newest board, not a stale one.

### Loading and error states

Fetching takes time, so `board` starts as `null` and there are now three things to render: loading, error,
or the board. Every handler begins `if (!board) return`, which is TypeScript insisting the "not loaded yet"
case be handled rather than assumed away.

### The tests changed character

This is the subtle part, and it applies to any app the moment it gains a database.

Before, every end-to-end test started from an identical page, because the board was rebuilt from a constant
on each load. Now tests **mutate shared state that outlives them**. A test that deletes a card changes what
the next test sees, and a suite that passes in order can fail when shuffled.

Two changes make it honest:

- **Serial execution** (`workers: 1`). Parallel tests were writing to the same board through the same API.
- **Reset before each test.** Each one signs in, `PUT`s a known board, and only then touches the UI.
  Starting from a defined state beats hoping the previous test tidied up.

There is also a small helper, `savedAfter(...)`, that waits for the `PUT` to actually reach the server
before reloading the page. Without it the test races the network and fails roughly whenever the machine is
busy — the same category as the Part 6 flake.

### One locator, two answers

A selector that passed in the unit tests failed in the browser tests:

```ts
page.getByRole("button", { name: "Delete Gather customer signals" })
```

Two separate causes, both about **accessible names** — the label assistive technology reads for an element.

First, dnd-kit marks each card `role="button"` so it can be dragged from a keyboard, and a button's
accessible name is built from the text inside it. The card's name therefore contains its title, its
details, *and* the delete button's label. Two elements matched. Playwright compares names by **substring**;
Testing Library compares them **exactly** — so identical-looking code disagreed across the two tools.

Second, the fix that seemed obvious — look for the visible word "Remove" — matched nothing, because the
button carries `aria-label="Delete ..."` and **`aria-label` overrides the visible text**. The name is the
label, not what your eyes see.

The working version scopes to the card and demands an exact match. The lesson is less about Playwright than
about knowing that "the name of a button" is a computed thing with rules, not simply its text.

### Test counts after Part 7

```
24  backend            pytest
22  frontend unit      vitest
12  end to end         playwright
```

Every end-to-end test now performs a change, reloads the page, and asserts it is still there.

### What Part 8 changes

The first AI call. The backend gains an OpenRouter client and a single endpoint that asks the model what
2+2 is — no board, no context, nothing clever. Proving the connection, the API key and the error handling
work in isolation is much easier before there is a prompt to blame.

---

## Part 8: the first AI call

### What an API call to a model actually is

Nothing exotic. OpenRouter exposes an HTTP endpoint; you POST some JSON naming a model and a list of
messages, and you get JSON back. The whole client is forty lines:

```python
response = await client.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key()}"},
    json={"model": MODEL, "messages": messages},
)
return response.json()["choices"][0]["message"]["content"]
```

The `Authorization: Bearer <key>` header is how the service knows who is paying. That is also why the key
never goes into the image: anyone who can pull the image could read it. It lives in `.env` on the host and
Docker injects it at run time with `--env-file`, which is what `start.sh` has been doing since Part 2 —
Part 8 is simply the first part that uses it.

### Failing loudly at startup

The app now refuses to start without `OPENROUTER_API_KEY`:

```python
if not ai.api_key():
    raise RuntimeError("OPENROUTER_API_KEY is not set. ...")
```

The alternative is a container that starts happily and only breaks when someone opens the chat. A
misconfiguration should surface at the moment of misconfiguration, not hours later in front of a user.

The check sits in the **lifespan**, the same place as schema creation, and for the same reason given in
Part 6: importing a module must not have opinions about the world. Tests import `create_app` constantly.

### 502, not 500

When OpenRouter fails, the route answers **502 Bad Gateway**, not 500.

The distinction is worth internalising. 500 means *this server is broken*. 502 means *this server is fine,
but the thing it depends on is not*. Anyone debugging a 502 knows immediately to look upstream. Choosing
the right status code is free documentation.

### Tests that really call the model

The plan originally said to mock the HTTP call. That was reversed: these tests call OpenRouter for real.

The argument is simple. The entire point of Part 8 is proving the backend can reach OpenRouter. A mocked
call proves only that we can write a mock — it would pass just as happily with a wrong URL, a wrong header
or an expired key. Even the failure path is real: one test sets a deliberately invalid key, OpenRouter
genuinely answers 401, and the test asserts our route turns that into a 502.

The trade-off is real too, and worth stating plainly. The test suite now needs the network, needs a valid
key, and spends free-tier quota on every run. Free models are rate-limited per minute and per day, so a
long debugging session can exhaust the daily allowance and leave the suite failing for reasons that have
nothing to do with the code. That is the price of testing the thing itself instead of a drawing of it.

### The lying environment

The tests passed. The container crash-looped:

```
File "/app/app/ai.py", line 5, in <module>
    import httpx
ModuleNotFoundError: No module named 'httpx'
```

The package this project uses is called `httpx2`, and it installs under the name `httpx2`. Writing
`import httpx` was simply wrong. The interesting question is why four tests passed against code that could
not import.

`scripts/test.sh` bind-mounts `backend/` into the test container, so the virtual environment inside it
lives on the host and **persists between runs**. That directory had picked up a stale `httpx 0.28.1` from
some earlier experiment — a package that appears nowhere in `uv.lock`. The tests were running against an
environment that no longer matched the lockfile, and it happened to contain exactly the module the broken
import needed.

Deleting `backend/.venv` and re-running rebuilt it from the lockfile alone. Twenty-eight tests still
passed, this time honestly.

The lesson is bigger than one typo. A lockfile describes the environment your code is *supposed* to run
in; a long-lived virtual environment describes what has accumulated in it. When those two disagree, tests
tell you about the second one, and the deployed container finds out about the first. If something passes
locally and fails in the container, suspect the environment before the code.

It also shows why CLAUDE.md insists that automated tests are never enough to close a part. The suite was
green. The application did not start.

### Why this one route is async

Every other route is a plain `def`. FastAPI runs those in a threadpool, which is right for SQLite: the
queries are sub-millisecond and blocking briefly costs nothing.

An AI call is different. It can take tens of seconds — the timeout here is 30 — and a sync route would
hold a worker for the entire wait. `async def` lets the server hand that time back and serve other requests
while it waits. The rule of thumb: blocking on a network you do not control belongs in `async`.

### Test counts after Part 8

```
28  backend            pytest      (2 of them call OpenRouter for real)
22  frontend unit      vitest
12  end to end         playwright
```

The new tests are: the route rejects a stranger, the payload names the right model, a live call answers 4,
and a bad key becomes a 502. The timeout path is deliberately untested — it cannot be triggered honestly
without the mocking this part rejected, so the gap is written down rather than papered over.

### What Part 9 changes

The AI gets to see the board. That needs the model to return something structured enough to save, which
this model cannot do through the usual `response_format` mechanism — so Part 9 uses a forced tool call
instead, and leans on the `BoardData` validation built back in Part 6 to reject anything malformed.

---

## Part 9: letting the model change the board

### The problem with asking a model for JSON

Part 8 asked for a sentence and got one. Part 9 needs something much less forgiving: a complete board
document that the database will accept. "Reply with JSON" is not enough. Models are happy to wrap JSON in
prose, use a slightly different field name, or trail off mid-object.

The usual fix is **structured outputs** — you hand the provider a JSON Schema and it constrains generation
so the reply must match. This model does not support that. Its `supported_parameters` list, checked against
OpenRouter's live model list back in Part 1, includes `tools` and `tool_choice` but not `response_format`.

### Tool calling as a schema in disguise

Tool calling was designed for a different job: letting a model invoke your functions. You describe a
function and its parameters, the model replies with arguments instead of prose, and your code runs it.

The trick is that **the parameter description is a JSON Schema**, and `tool_choice` can force the model to
use a specific tool. Define one tool whose parameters happen to be the shape you wanted, force it, and
never actually "call" anything — you just read the arguments:

```python
"parameters": {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "board": {...the BoardData schema...},
    },
    "required": ["reply"],
}
```

`reply` is required, `board` is not. That optionality is the whole design: it is how the model says "this
was a question, I changed nothing" versus "here is the new board."

### A schema that writes itself

The board schema is not hand-written. Pydantic generates it from the models built in Part 6:

```python
BoardData.model_json_schema()
```

A hand-written copy would be a second definition of the board, free to drift from the first the moment
anyone touches `models.py`. Generating it means there is only ever one.

That came with a subtlety worth knowing. Pydantic does not inline nested models; it emits them under a
`$defs` section and points at them with references like `#/$defs/Card`. The `#` means **the root of the
document** — so if the definitions stay nested under the `board` property, every reference points at
nothing. They have to be hoisted up to the top of `parameters`, where `#/$defs/Card` actually resolves.

### Telling the model the rules

The system prompt carries the current board and a short list of rules. The one that matters most:

```
Send the whole board, not a fragment. Anything you leave out is deleted.
```

The board is replaced wholesale, so a model that returns only the column it changed would silently destroy
the other four. Saying so plainly in the prompt is cheaper than building a merge algorithm — and the
validation behind it means a mistake is rejected rather than saved.

### Never trust the model's output

Everything the model returns goes through `BoardData` before it goes anywhere near the database:

```python
try:
    validated = BoardData.model_validate(board)
except ValidationError as error:
    raise ai.AIError(f"The model returned an invalid board: {error}")
```

This is where the invariant written in Part 6 earns its keep. `BoardData` rejects a board whose `cardIds`
name a card that does not exist — exactly the mistake a model makes when it moves a card by adding an id in
one place and forgetting to remove it in another. The database cannot express that rule, so the model layer
does, and it now guards two doors: the `PUT /api/board` route and the AI.

A rejected board becomes a **502**, with nothing written. The alternative — returning the model's cheerful
"Done!" while silently discarding the update — would mean the one situation the user most needs to know
about is the one they are told nothing about.

### `board_updated` has to be true

The response is `{reply, board_updated, board}`, and Part 10 will re-render the board whenever
`board_updated` is true.

Asked a plain question, the model *usually* omits the board. Occasionally it echoes it back unchanged. Both
are reasonable behaviour; treating the second as an update would not be. So the route compares what came
back against what is stored and only counts it as an update if something actually differs. A flag that says
"changed" should never mean "possibly changed".

### Tests against something that changes its mind

Part 8 established that these tests call OpenRouter for real. Part 9 is where the cost of that shows up,
because the model is not a deterministic function.

The tests split into two groups. Anything that is **our** behaviour is tested as a pure function with no
network at all: does the prompt contain the board, does history truncate at twenty turns, do the schema's
references resolve, is a malformed board rejected without touching the database. That last one cannot be
live — there is no way to make a model produce broken output on demand — so the validation is handed a bad
board directly. That is still testing our code rather than a mock of theirs.

Only two tests are live: a question must leave the board alone, and a specific card must actually move. The
second is deliberately strict — it names the card and demands it land in Done — with a single retry, on the
grounds that a model which needs three attempts to follow a simple instruction is information, not noise.

Over about seven runs, one failed. Not the mutation test: the question test. The output had been piped
through `tail`, so all that survived was `assert...` and the cause was lost — the same mistake CLAUDE.md
already warns about. The fix was to give every live assertion a message naming the values involved, so the
next failure explains itself instead of merely announcing itself.

An intermittently red suite is the honest price of testing a real model. The alternative is a suite that is
always green and proves less.

### A false alarm worth recording

During browser testing the model replied that the board held three cards and named them — but the demo
board has eight. It looked like the model had truncated the board and the code had cheerfully persisted the
loss.

It had not. The end-to-end suite resets the board to a three-card fixture before each test, and it had run
minutes earlier. The model had read the real board correctly, added the requested card, and accurately
declined to move a card that genuinely was not there.

The lesson is about debugging, not about models: the board was checked directly in SQLite before drawing any
conclusion, and the "bug" evaporated. Shared mutable state — one database, used by the e2e suite and by hand
— makes surprising states normal. Look at the data before believing the story.

### Test counts after Part 9

```
36  backend            pytest      (2 of them call OpenRouter for real)
22  frontend unit      vitest
12  end to end         playwright
```

### What Part 10 changes

The last part, and the first one in a while with anything to look at. The chat moves into a sidebar in the
browser: a message thread, a pending indicator while the model thinks, and a board that re-renders itself
when `board_updated` comes back true — no reload.

---

## Part 10: the sidebar

### Two writers, one board

Every earlier part had exactly one thing changing the board: the user. Part 10 adds a second, and the two
do not coordinate.

The problem is not hypothetical. Saving replaces the **whole** board — that was the deal struck back in
Part 6, when the board became one JSON document. So while a chat request is in flight, which can take tens
of seconds, the model is working from a snapshot taken when you pressed Send. Drag a card during that
window and the reply arrives holding a board that never knew about your drag. Applying it silently undoes
your work.

Three ways to handle it:

- **Let the AI win and document it.** Honest, matches the app's existing last-write-wins behaviour, costs
  nothing to build, and occasionally eats an edit.
- **Merge the two boards.** Correct, and far more machinery than an MVP justifies — you need to know what
  changed, not just what the board looks like now.
- **Stop the two writers overlapping at all.** Lock the board while a request is in flight.

The third was chosen. While `aiBusy` is set, `apply()` refuses edits and the grid renders with `aria-busy`,
dimmed and non-interactive. The window is small, the rule is easy to state, and nothing is silently lost.

This is worth noticing as a pattern: concurrency bugs are usually cheaper to *prevent structurally* than to
resolve after the fact. Making the overlap impossible took one boolean; merging two divergent boards would
have been a project.

### The debounce that outlives the lock

The lock has a hole, and it is the kind that only shows up when you go looking.

Column renames are debounced by 400ms — a burst of keystrokes collapses into one save. Suppose a rename
starts at t=0 and a chat request at t=100ms. The lock stops *new* edits, but the rename's timer is already
running. At t=400ms it fires and saves a pre-AI board.

So `handleAiBoard` clears any pending timer before adopting the AI's board. One line, and it closes a
window that would otherwise produce a board that looks right on screen and is wrong in the database.

### Adopting a board rather than saving it

When the AI's board arrives, the frontend calls `setBoard` and stops. It does **not** save.

That looks like an omission and is not. The backend already wrote the board before replying — that is what
`board_updated: true` means. A `PUT` here would send the same document back for no reason, and give the
race one more chance to matter. There is a test asserting no `PUT` happens, because "we deliberately do not
save here" is exactly the kind of intention a future edit erases by accident.

### Errors belong in the thread, not in the history

Failed turns render in the conversation, as the plan asked. What the plan did not say is what happens to
them afterwards.

The history sent to `/api/ai/chat` is filtered to `user` and `assistant` turns. An error is neither. If
"The AI could not answer. Try rephrasing that." were sent back as an assistant turn, the model would read
it as an example of how it talks — and models are excellent imitators of their own apparent past. The
user's failed message *does* stay in the history, because they did say it.

Small distinction, and the sort of thing that produces baffling behaviour three turns later if you get it
wrong.

### jsdom has no layout

The chat scrolls to the newest message with `scrollIntoView`. Every unit test promptly failed:

```
TypeError: threadEnd.current?.scrollIntoView is not a function
```

jsdom implements the DOM but not layout. It has no viewport, nothing has a position or a size, and so
methods about *where things are* mostly do not exist. This is the same reason drag and drop cannot be unit
tested here and lives in Playwright instead.

The fix went in `src/test/setup.ts`, not the component. A component should not carry a workaround for the
environment its tests run in — that is the test environment's problem to declare.

### One more lesson in accessible names

A test asserted the grid was `aria-busy` and found nothing:

```ts
screen.getAllByTestId(/column-/)[0].closest("section")
```

`closest()` starts at the element itself, and `KanbanColumn` renders its own `<section>`. The locator found
the column and asked it whether it was busy. Anchoring on `closest("[aria-busy]")` — the attribute actually
being looked for — fixed it.

This is the fourth locator bug in this project, after the three in Parts 3, 4 and 7. They share a shape:
a selector that *describes* the target loosely enough to match something else nearby. Prefer selectors that
name the thing you actually care about.

### The suite finally caught a real bug

Running everything together, the backend suite failed:

```
return response.json()["choices"][0]["message"]
KeyError: 'choices'
```

A **200 response with no completion in it**. OpenRouter returns rate limits and some upstream failures as an
`error` object with a 200 status, rather than a 429. The code checked the status code and assumed the rest.

Part 8 promised that upstream failures surface as a clean 502. This one surfaced as a `KeyError` and a 500
with a stack trace — the exact outcome that part set out to prevent, sitting undiscovered because a happy
path had never been unhappy in quite that way.

The lesson is not "add more error handling". It is that **a status code is not a contract**. Two hundred
means the HTTP request succeeded, not that the thing you asked for happened.

It also arrived at a telling moment: after a day of live tests, having spent a lot of free-tier quota. The
test suite ran into the limit that the tests themselves created.

### Final test counts

```
37  backend            pytest      (2 call OpenRouter for real)
33  frontend unit      vitest
15  end to end         playwright  (3 call OpenRouter for real)
```

85 tests. The end-to-end suite grew from about 8 seconds to about 40, almost entirely waiting for a model.

### What was built

Ten parts, in order, each one merged only after its tests passed and someone used it in a browser:

1. A plan
2. A container serving a hello-world page
3. The real board, statically exported and served by FastAPI
4. Sign in, with the API as the security boundary
5. A database schema, agreed before any code was written
6. The board persisted in SQLite
7. The frontend reading and writing through the API
8. The backend reaching OpenRouter
9. The AI reading and changing the board through a forced tool call
10. A sidebar to talk to it

The through-line, if there is one: each part could be tested before the next was started, and each new
capability was added behind something that already worked. Part 9 could trust `BoardData` because Part 6
built it. Part 10 could trust `board_updated` because Part 9 made it mean something. None of that is
specific to Kanban boards or AI — it is just what it looks like to build something one honest step at a
time.
