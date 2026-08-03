# Implementation plan

Ten parts, executed in order. Each part is finished only when its checklist is complete, its tests pass,
and the running app has been exercised by hand. Do not start a part before the previous one is signed off.

See [../CLAUDE.md](../CLAUDE.md) for requirements and standards, and
[../frontend/CLAUDE.md](../frontend/CLAUDE.md) for the frontend.

## Status

| Part | State |
|---|---|
| 1 Plan | Done |
| 2 Scaffolding | Done |
| 3 Frontend served by FastAPI, card editing | Done |
| 4 Session-cookie sign in | Done |
| 5 Database design | Done, signed off |
| 6 Board persisted in SQLite | Done |
| 7 Frontend reads and writes through the API | Done |
| 8 AI connectivity | Not started |
| 9 AI over the board | Not started |
| 10 AI sidebar | Not started |

All merged to main. 58 tests: 24 backend, 22 frontend unit, 12 end to end.

Start the app with `scripts/start.sh` and sign in as `user` / `password`.

## Decisions

**Auth.** FastAPI validates the hardcoded credentials and sets an HttpOnly session cookie. API routes reject
unauthenticated calls. The frontend gates the board on `GET /api/me`. No JWT, no client-only gate — the
session user is what scopes board data in Parts 6-7.

**Card editing.** CLAUDE.md requires editable cards; the frontend has no such feature. It is added in
Part 3, so the feature set is complete before persistence and AI-driven edits build on it.

**Docker.** One container, production-style. Multi-stage build: a node stage runs `next build` producing a
static export, a `uv` stage runs FastAPI serving that output at `/` and the API under `/api`. No compose,
no separate dev mode.

**AI output shape.** OpenRouter reports that `nvidia/nemotron-3-ultra-550b-a55b:free` does **not** support
`structured_outputs` / `response_format`; its `supported_parameters` are `include_reasoning, max_tokens,
reasoning, reasoning_effort, seed, temperature, tool_choice, tools, top_p`. Only the paid variant supports
structured outputs. We stay on `:free` and get schema-enforced output through **tool calling**: one tool
whose parameters are the response schema, with `tool_choice` forcing the call.

**Verification.** Every part: `vitest` + `pytest` + `playwright` green, **and** the container started and
the feature used in a browser. Automated tests alone are not sufficient to close a part.

## Constraints later parts must respect

Learned while building Parts 2-7. Each one is cheap to honour and expensive to rediscover.

- **Register API routes before the `StaticFiles` mount** in `create_app`. The mount at `/` is a catch-all;
  anything after it is unreachable.
- **Any route returning user data needs `Depends(require_user)`.** Omitting it is silent — the route simply
  works for strangers. The login screen is presentation only; the API is the security boundary.
- **Open SQLite connections through `db.connect()`.** `PRAGMA foreign_keys` is per-connection, so any other
  route to a connection loses referential integrity.
- **Do not touch disk at import time.** Schema creation belongs in the FastAPI lifespan. Two bugs have come
  from import-time side effects already.
- **Validate what the JSON column cannot.** `BoardData` rejects `cardIds` naming a missing card. Part 9
  depends on this to reject bad AI output.
- **Query boards with `ORDER BY id LIMIT 1`.** The schema deliberately allows more than one per user.
- **Playwright uses `globalSetup`, not `webServer`.** `webServer` expects a long-lived foreground process
  and fails intermittently against `start.sh`, which returns once the container is up.
- **E2E runs serially and resets the board per test.** The board persists, so tests share mutable state.
- **Accessible names are computed.** dnd-kit makes each card `role="button"` whose name swallows its inner
  text, Playwright matches names by substring while Testing Library matches exactly, and `aria-label`
  overrides visible text. Scope locators and pass `exact: true`.

---

## Part 1: Plan

**Goal.** Turn this document into an executable plan and describe the existing frontend, then get sign-off.

- [x] Review [../CLAUDE.md](../CLAUDE.md) and the existing frontend source
- [x] Resolve open questions with the user (auth, card editing, Docker, verification depth)
- [x] Verify the OpenRouter model's capabilities against the live model list
- [x] Write [../frontend/CLAUDE.md](../frontend/CLAUDE.md)
- [x] Rewrite this document with checklists, tests and success criteria per part
- [x] User approves the plan

**Tests.** None (documentation).

**Success criteria.** Every claim in `frontend/CLAUDE.md` matches the source. All ten parts have a goal,
checklist, tests and success criteria. User has signed off.

---

## Part 2: Scaffolding

**Goal.** A Docker container running FastAPI that serves a static hello-world page at `/` and answers an
API call, started and stopped by scripts.

- [x] `backend/` Python project managed by `uv`: `pyproject.toml`, FastAPI, uvicorn, pytest, `httpx2`
- [x] `backend/app/main.py` with the FastAPI app; routes under `/api`, static mount at `/`
- [x] `GET /api/health` returning `{"status": "ok"}`
- [x] Placeholder `static/index.html` that calls `/api/health` and renders the result
- [x] `Dockerfile`, multi-stage: node stage (placeholder for the Next build in Part 3) → `uv` runtime stage
- [x] `.dockerignore` excluding `node_modules`, `.next`, `.git`, `test-results`
- [x] Container reads `OPENROUTER_API_KEY` from the project-root `.env` at run time (not baked into the image)
- [x] `scripts/start.sh` and `scripts/stop.sh` (Mac/Linux), `scripts/start.ps1` and `scripts/stop.ps1` (Windows)
- [x] `scripts/test.sh` and `scripts/test.ps1` — pytest inside the uv image, since the host has no `uv`
- [x] Replace the `backend/` and `scripts/` documentation stubs with real `CLAUDE.md` descriptions
- [x] Root `README.md`, minimal: how to start, stop, and run tests

**Tests.** `backend/tests/test_health.py` — `/api/health` returns 200 and the expected body; `/` returns the
static page.

**Success criteria.** `scripts/start.sh` builds and runs the container; `http://localhost:8000` shows the
page with a live health result; `scripts/stop.sh` stops and removes it; `pytest` passes.

---

## Part 3: Add in Frontend

**Goal.** The real Kanban board, statically built and served by FastAPI at `/`, with card editing added.

- [x] Set `output: "export"` in `frontend/next.config.ts`
- [x] Dockerfile node stage runs `npm ci && npm run build`; copy `frontend/out` into the runtime stage
- [x] FastAPI serves that directory at `/`, with `/api` routes taking precedence
- [x] Add card editing: click a card's title or details to edit in place, commit on blur or Enter, cancel on Escape
- [x] Add `updateCard(cards, cardId, fields)` to `frontend/src/lib/kanban.ts` and a `handleUpdateCard` in `KanbanBoard.tsx`
- [x] Refactor the backend to a `create_app(static_dir)` factory so tests do not depend on build output
- [x] Repoint `playwright.config.ts` `baseURL` and `webServer` at the container
- [x] Delete the stray `frontend/test-results/` directory and confirm it is gitignored

**Tests.**
- Unit (vitest): `updateCard` pure-function cases; editing a card title and details through `KanbanBoard`; existing rename/add/delete/`moveCard` tests still pass
- E2E (Playwright): board loads at `/` with five columns; add a card; drag a card between columns; edit a card title and see it persist in the DOM
- Backend (pytest): `/` serves the built `index.html`; a static asset resolves; an unknown `/api` path returns 404 rather than the SPA shell

**Success criteria.** `npm run test:all` and `pytest` pass. The container serves the real board at `/`, and
drag/drop, add, delete and edit all work in the browser.

---

## Part 4: Fake user sign in

**Goal.** Hitting `/` unauthenticated shows a login form; `user`/`password` grants access to the board; log
out returns to the form.

- [x] `POST /api/login` — validates credentials, sets an HttpOnly, SameSite=Lax session cookie
- [x] `POST /api/logout` — clears the cookie
- [x] `GET /api/me` — returns the session user, or 401
- [x] A FastAPI dependency that returns the session user or raises 401, applied to all protected routes
- [x] Login page component in the project palette; submit button uses `--secondary-purple`
- [x] Frontend checks `/api/me` on load and shows either the login form or the board
- [x] Log out control in the board header
- [x] `frontend/src/lib/api.ts` introduced early (Part 7 extends it with the board calls)

**Tests.**
- Backend (pytest): login with correct credentials sets the cookie; wrong credentials return 401 and set no cookie; `/api/me` without a cookie returns 401, with one returns the user; logout clears it and `/api/me` returns 401 again
- Unit (vitest): login form renders, submits, and shows an error on rejection; board renders when `/api/me` succeeds (fetch mocked)
- E2E (Playwright): visiting `/` shows the login form; bad credentials show an error; good credentials show the board; reload keeps the session; logout returns to the form and the board is no longer reachable

**Success criteria.** All suites pass. In the browser: cannot see the board before logging in, session
survives a reload, logout works.

---

## Part 5: Database modeling

**Goal.** An agreed SQLite schema, documented and signed off before any DB code is written.

- [x] `docs/DATABASE.md`: tables, columns, types, keys, constraints, and the reasoning
- [x] `users` table — supports multiple users even though the MVP hardcodes one
- [x] `boards` table — one row per user for the MVP, but keyed so more are possible later; board content stored as a JSON column matching `BoardData` (`columns` + `cards`)
- [x] Document why JSON rather than normalized card/column tables, and what that costs
- [x] Document creation-on-startup behaviour and where the file lives (a bind mount at `./data`, so data survives a container rebuild)
- [x] Sample JSON document matching the frontend's `BoardData`
- [x] Schema executed against real SQLite to confirm the constraints behave as documented
- [ ] **User signs off before Part 6**

**Tests.** None (documentation).

**Success criteria.** The schema covers everything Parts 6-9 need to read and write. User has approved
`docs/DATABASE.md`.

---

## Part 6: Backend

**Goal.** API routes to read and write the signed-in user's board, backed by SQLite created on first run.

- [x] Schema created at startup if the DB file is absent; seed the demo board for a new user
- [x] Pydantic models mirroring `Card`, `Column`, `BoardData`, including the dangling-`cardIds` invariant
- [x] `GET /api/board` — the session user's board
- [x] `PUT /api/board` — replace the board, validated against the models
- [x] All board routes behind the Part 4 auth dependency
- [x] Persist the SQLite file to a mounted volume so it survives `stop` then `start`

**Tests.** pytest against a temporary DB: DB and schema are created when absent; a new user gets a seeded
board; `GET /api/board` returns it; `PUT` then `GET` round-trips; malformed board JSON returns 422; both
routes return 401 without a session; one user cannot read another's board.

**Success criteria.** `pytest` passes. Starting the container with no DB file creates one; stopping and
restarting preserves board changes made through the API.

---

## Part 7: Frontend plus Backend

**Goal.** The board is genuinely persistent — the frontend reads and writes through the API.

- [x] `frontend/src/lib/api.ts` with typed `getBoard()` / `saveBoard()` helpers (`credentials: "same-origin"`, which is what same-origin requests need)
- [x] `KanbanBoard` loads from `GET /api/board` instead of `initialData`, with loading and error states
- [x] All five mutations (rename, add, edit, delete, move) persist via `PUT /api/board`
- [x] Debounce column rename so it does not fire per keystroke
- [x] Keep `moveCard` / `updateCard` as the local reducers; send their result rather than reimplementing logic server-side
- [x] `initialData` deleted from the frontend; `backend/app/seed.py` is the only seed
- [x] e2e runs serially and resets the board per test, now that tests mutate shared state

**Tests.**
- Unit (vitest): loading state; board rendered from a mocked API response; each mutation issues a `PUT` with the expected payload; rename debounce collapses rapid keystrokes into one request; API failure surfaces an error
- E2E (Playwright): log in, move a card, reload, card is still in its new column; same for add, edit and delete
- Backend (pytest): existing suites still pass

**Success criteria.** All suites pass. In the browser: every change survives a reload, and survives
`stop.sh` followed by `start.sh`.

---

## Part 8: AI connectivity

**Goal.** Prove the backend can reach OpenRouter.

- [ ] `OPENROUTER_API_KEY` loaded from the environment; startup fails with a clear message if it is missing
- [ ] A small OpenRouter client module in `backend/`, model `nvidia/nemotron-3-ultra-550b-a55b:free`
- [ ] `POST /api/ai/ping` (auth-protected) sending a fixed "what is 2+2" prompt and returning the reply
- [ ] Sensible timeout, and upstream errors surfaced as a clean 502 rather than a stack trace

**Tests.** pytest with the HTTP call mocked: the request carries the right model, auth header and messages;
an upstream error becomes a 502; the route needs auth. Plus one manual live call confirming a real answer of
4 — record the result, do not put a network-dependent test in the suite.

**Success criteria.** Mocked tests pass, and a real call against OpenRouter returns 4.

---

## Part 9: AI over the board

**Goal.** The AI sees the board and the conversation, replies to the user, and may return a board update.

- [ ] `POST /api/ai/chat` taking the user's message and conversation history
- [ ] Prompt assembles: system instructions, the current board JSON from the DB, history, and the new message
- [ ] Define one tool, e.g. `respond`, whose parameters are `{ reply: string, board?: BoardData }`, and set `tool_choice` to force it
- [ ] Parse the tool call; validate `board` against the Pydantic models and reject anything malformed
- [ ] If a valid board comes back, persist it and tell the caller the board changed
- [ ] Response shape: `{ reply, board_updated: bool, board: BoardData | null }`
- [ ] Cap history length so the prompt cannot grow without bound

**Tests.** pytest with the OpenRouter call mocked: a reply-only tool call leaves the DB untouched; a tool
call with a board persists it and sets `board_updated`; an invalid board is rejected with the DB unchanged
and an error returned; the prompt contains the current board JSON and the supplied history; history is
truncated at the cap; the route needs auth. Plus one live call — "move card X to Done" — confirming a real
board update.

**Success criteria.** Mocked tests pass, and a live request that asks for a board change produces a valid,
persisted update.

---

## Part 10: AI sidebar

**Goal.** A chat sidebar where the AI can talk and change the board, with the board refreshing when it does.

- [ ] Collapsible sidebar in the project palette, alongside the board without overlapping it
- [ ] Message list distinguishing user and AI turns, with a pending indicator while waiting
- [ ] Input posts to `/api/ai/chat` with the running conversation history
- [ ] When `board_updated` is true, update board state from the response so the UI refreshes without a reload
- [ ] Errors shown in the thread, not swallowed
- [ ] Conversation history held in component state; it is not persisted in the MVP

**Tests.**
- Unit (vitest): sidebar opens and closes; a sent message appears and the reply renders; pending state shows while in flight; a `board_updated` response re-renders the board; an API error shows a message in the thread
- E2E (Playwright): log in, open the sidebar, ask a question, see a reply; ask for a card to move and see the board update without a reload, with the change surviving a refresh

**Success criteria.** All suites pass. In the browser, a real conversation with the AI moves a real card and
the board updates on its own.
