# The Project Management MVP web app

## Business Requirements

This project is building a Project Management App. Key features:
- A user can sign in
- When signed in, the user sees a Kanban board representing their project
- The Kanban board has fixed columns that can be renamed
- The cards on the Kanban board can be moved with drag and drop, and edited
- There is an AI chat feature in a sidebar; the AI is able to create / edit / move one or more cards

## Limitations

For the MVP, there will only be a user sign in (hardcoded to 'user' and 'password') but the database will support multiple users for future.

For the MVP, there will only be 1 Kanban board per signed in user.

For the MVP, this will run locally (in a docker container)

## Technical Decisions

- NextJS frontend
- Python FastAPI backend, including serving the static NextJS site at /
- Everything packaged into a Docker container
- Use "uv" as the package manager for python in the Docker container
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root
- Use `nvidia/nemotron-3-ultra-550b-a55b:free` as the model. Note this variant does **not** support
  `response_format` / structured outputs — only `tools` and `tool_choice`. Part 9 therefore gets
  schema-enforced output via a forced tool call. See the Decisions section of docs/PLAN.md
- Use SQLLite local database for the database, creating a new db if it doesn't exist
- Start and Stop server scripts for Mac, PC, Linux in scripts/

## Current state

Parts 1-9 of docs/PLAN.md are complete and merged to main. The app runs in one container: sign in at
http://localhost:8000 with `user` / `password`, and the Kanban board persists to SQLite. The backend reaches
OpenRouter through `POST /api/ai/ping`, and refuses to start without `OPENROUTER_API_KEY`.
`POST /api/ai/chat` puts the AI over the board: it answers questions and can return a whole new board
through a forced tool call, validated and persisted server-side.

Remaining: Part 10 (AI chat sidebar) — the only part with no UI yet.

The frontend began as a standalone demo. It is now statically exported and served by FastAPI, with card
editing, session auth, and all five mutations persisted through the API.

## Color Scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project are in the docs/ directory.
Please review docs/PLAN.md before proceeding.

- docs/PLAN.md — the ten-part plan, decisions, and progress
- docs/DATABASE.md — schema design and its reasoning, signed off before Part 6
- docs/academia.md — a walkthrough of each part for a reader new to Docker and backends

Directory-specific notes live in backend/CLAUDE.md, frontend/CLAUDE.md and scripts/CLAUDE.md. They load
automatically when working in those directories and carry the gotchas worth knowing before editing.

## How each part is built

1. Branch: `part-N-short-name`, off main
2. Review the part critically first; raise anything the plan leaves ambiguous before writing code
3. Test-first — write the test, watch it fail for the right reason, then implement
4. Verify: pytest, vitest and playwright green, **and** the feature exercised in a real browser
5. Update the affected CLAUDE.md files and tick the checklist in docs/PLAN.md
6. Merge to main, re-verify on the merged result, delete the branch, push
7. Update docs/academia.md with a section for the part

Never claim something passes without showing the output. Do not filter test output through `grep` while
diagnosing a failure — that hid the cause of a real bug for three parts.

From Part 8 the AI tests call OpenRouter for real, with no mocking, so the backend suite needs `.env` and a
network. A green suite still does not close a part: in Part 8 all 28 tests passed against a stale local
virtualenv while the container could not start.