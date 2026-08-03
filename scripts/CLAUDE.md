# Scripts

Start, stop and test the app. `.sh` for Mac and Linux, `.ps1` for Windows; each pair does the same thing.

| Script | Does |
|---|---|
| `start` | Builds the image, replaces any running container, runs it on port 8000, waits for `/api/health` |
| `stop` | Removes the container |
| `test` | Runs pytest inside the uv image against a bind-mounted `backend/` |

Notes:

- Image and container are both named `kanban-studio`.
- `start` passes the project-root `.env` via `--env-file`, so `OPENROUTER_API_KEY` reaches the container at
  run time and is never baked into the image. It warns rather than fails if `.env` is absent.
- Override the host port with the `PORT` environment variable.
- `test` bind-mounts the source instead of using the app image, so it picks up edits without a rebuild.
- `start` bind-mounts `./data` to `/app/data` so the SQLite database outlives the container, and creates
  the directory first because Docker would otherwise create it root-owned.
- `start`'s health poll allows 120s and is the script's only failure path. Do not shorten it: a machine
  that has just finished a docker build, or is setting up the ./data bind mount for the first time, can
  legitimately take longer than a short budget allows.
- Playwright calls `start.sh` from its `globalSetup`, so these scripts are on the critical path for the
  end-to-end suite as well as for running the app.
