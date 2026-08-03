# Scripts

Start, stop and test the app. `.sh` for Mac and Linux, `.ps1` for Windows; each pair does the same thing.

| Script | Does |
|---|---|
| `start` | Builds the image, replaces any running container, runs it on port 8000, waits for `/api/health` |
| `stop` | Removes the container |
| `test` | Runs pytest inside the uv image against a bind-mounted `backend/` |

Notes:

- Image and container are both named `kanban-studio`.
- **Both `start` and `test` require the project-root `.env` and exit immediately with a clear message
  without it.** `start` passes it via `--env-file`, so `OPENROUTER_API_KEY` reaches the container at run
  time and is never baked into the image; the app refuses to start without the key, so warning and
  continuing would only mean watching a crash-loop for 120s. `test` needs it because the Part 8 AI tests
  call OpenRouter for real.
- Override the host port with the `PORT` environment variable.
- `test` bind-mounts the source instead of using the app image, so it picks up edits without a rebuild. The
  side effect is that `backend/.venv` persists on the host and can drift from `uv.lock` — see
  [../backend/CLAUDE.md](../backend/CLAUDE.md).
- `start` bind-mounts `./data` to `/app/data` so the SQLite database outlives the container, and creates
  the directory first because Docker would otherwise create it root-owned.
- `start`'s health poll allows 120s and is the script's only failure path. Do not shorten it: a machine
  that has just finished a docker build, or is setting up the ./data bind mount for the first time, can
  legitimately take longer than a short budget allows.
- Playwright calls `start.sh` from its `globalSetup`, so these scripts are on the critical path for the
  end-to-end suite as well as for running the app.
