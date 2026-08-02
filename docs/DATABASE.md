# Database design

SQLite, created on first run, holding users and their Kanban boards. Part 6 builds against this; nothing
here is implemented yet.

## Shape

Two tables. A user has boards; a board holds its entire contents as one JSON document.

```
users                         boards
-----                         ------
id        INTEGER PK    <---- user_id   INTEGER NOT NULL
username  TEXT UNIQUE         id        INTEGER PK
created_at TEXT               title     TEXT NOT NULL
                              data      TEXT NOT NULL   (JSON)
                              updated_at TEXT
```

## Schema

```sql
-- Applies to this connection only. See the warning below.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boards (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'My Board',
    data       TEXT NOT NULL CHECK (json_valid(data)),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_boards_user_id ON boards(user_id);
```

### Column notes

| Column | Why |
|---|---|
| `users.username` | `UNIQUE` is the real identity constraint. The MVP seeds exactly one row, `user` |
| `boards.user_id` | Plain foreign key, no `UNIQUE` — see "One board per user" below |
| `boards.data` | The whole board as JSON. `json_valid()` stops malformed text entering the column |
| `boards.title` | Unused by the UI today. It costs nothing and avoids a migration when boards get names |
| `*_at` | ISO-8601 text via `datetime('now')`. SQLite has no date type; text sorts correctly |

`ON DELETE CASCADE` means deleting a user removes their boards rather than leaving orphans.

### Two SQLite specifics worth knowing

**Foreign keys are off by default, and the `PRAGMA` above is not enough.** It applies only to the
connection that ran it — the one that created the schema. Every later connection starts with foreign keys
disabled again, and `REFERENCES` becomes decorative.

Verified against SQLite 3.40.1 rather than assumed:

```
connection 1 (ran the schema)  foreign_keys = 1
connection 2 (fresh)           foreign_keys = 0
  INSERT INTO boards (user_id, data) VALUES (999, '{}')  ->  accepted
```

A board belonging to user 999, who does not exist, stored without complaint. **Part 6 must issue
`PRAGMA foreign_keys = ON` on every connection it opens**, not once at startup. With SQLAlchemy that is a
`connect` event listener; with raw `sqlite3` it belongs in whatever helper hands out connections.

**`json_valid()` needs the JSON1 extension**, compiled into every modern SQLite build including the one in
`python:3.13`. No extra dependency.

The rest of the schema was executed for real too: the sample document below inserts cleanly, the
`json_valid` CHECK rejects non-JSON text, two boards for one user are accepted (no `UNIQUE`), and
`ALTER TABLE users ADD COLUMN password_hash TEXT` succeeds without a table rebuild.

## Why the board is JSON, not tables

The obvious alternative is normalized: a `columns` table and a `cards` table with foreign keys and a
position column. That is the textbook answer, and it is the wrong one here.

**For it:**

- The frontend already treats the board as one document — [`BoardData`](../frontend/src/lib/kanban.ts) is
  exactly `{ columns, cards }`. Storing it as-is means no translation layer in either direction.
- Every operation is whole-board. `PUT /api/board` replaces it; the AI in Part 9 returns a complete revised
  board. Nothing in the app updates one card in isolation.
- Card ordering is `column.cardIds`, an array. Normalizing means a `position` integer per card and
  renumbering siblings on every drag — a well-known source of off-by-one bugs.
- One user, one board, a few dozen cards. There is no volume of data to justify the machinery.

**What it costs, honestly:**

- **No querying inside a board.** "Which cards mention deploy?" means reading the JSON and filtering in
  Python, not a `WHERE` clause. Fine at this size; not fine at ten thousand cards.
- **No referential integrity for cards.** Nothing stops `cardIds` naming a card absent from `cards`. The
  Pydantic models in Part 6 must validate this, because the database will not.
- **Whole-board writes mean last-write-wins.** Two simultaneous edits — plausible in Part 10, where you and
  the AI can both change the board — and one silently overwrites the other. `updated_at` exists so a later
  part can add optimistic concurrency if that becomes a real problem.
- **Migrating the board's shape is a data migration**, not an `ALTER TABLE`. Adding a field to `Card` means
  rewriting every stored document, or tolerating both shapes when reading.

If cards ever need independent querying, the move is to normalize then. Going the other way — starting
normalized and collapsing to JSON — is the harder migration.

## One board per user

`boards.user_id` carries **no** `UNIQUE` constraint, so supporting several boards per user later needs no
schema change. SQLite cannot drop a constraint in place; removing one means rebuilding the table and
copying the data, which is precisely the migration this avoids.

The cost is that the database will not stop a bug inserting a second board. Part 6 must therefore be
deterministic rather than relying on there being only one:

```sql
SELECT * FROM boards WHERE user_id = ? ORDER BY id LIMIT 1
```

Never a bare `SELECT * FROM boards`, and never assuming the result set has one row.

## Authentication is not in the schema

There is no `password_hash` column. Sign-in stays hardcoded in `app/main.py` for the MVP, so a column
nothing reads would be dead weight — and worse, it could be mistaken for working authentication.

`users` exists because boards must be **scoped** to somebody. That is a different job from proving who
somebody is.

Adding real accounts later:

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
```

SQLite supports `ADD COLUMN` directly, so this is a one-line change with no table rebuild. It would be
accompanied by hashing with a deliberately slow algorithm built for passwords — bcrypt, scrypt or argon2 —
never a plain hash like SHA-256, and `require_user` would verify against the stored hash instead of a
constant.

## Where the file lives

```
host                                    container
./data/kanban.db        <-- mounted -->  /app/data/kanban.db
```

A bind mount, so the database is an ordinary file in your project at `data/kanban.db`. You can open it with
any SQLite browser to see exactly what the AI wrote in Part 9, back it up by copying it, or delete it for a
clean slate.

`data/` goes in `.gitignore` — it holds runtime state, not source.

This is the reason a volume is needed at all: **containers are disposable**. Anything written inside a
container's own filesystem disappears when `stop.sh` removes it. The mount puts the file on your machine,
where a rebuild cannot touch it.

`start.sh` and `start.ps1` gain `-v "$ROOT/data":/app/data` in Part 6.

## Creation on first run

On startup the backend will:

1. Create `/app/data/` if absent.
2. Open `kanban.db`, creating an empty file if it does not exist. This is automatic in SQLite — connecting
   to a missing path creates it.
3. Run the `CREATE TABLE IF NOT EXISTS` statements above. Safe on every boot, not just the first.
4. Insert the `user` row if missing.
5. Insert a board for that user if they have none, seeded from the demo board the frontend currently
   hardcodes as `initialData`.

Step 5 is what makes a fresh checkout show a populated board rather than five empty columns. After Part 7
the frontend loads from the API, so this becomes the single source of that seed data.

Every step is idempotent — running it on each boot is a no-op once things exist. There is no separate
migration tool; at this size, `IF NOT EXISTS` is enough. A schema that changes after real data exists would
need a proper migration, and that is the point to reach for one.

## Sample document

The exact shape of `boards.data`, matching `BoardData`:

```json
{
  "columns": [
    { "id": "col-backlog",  "title": "Backlog",     "cardIds": ["card-1", "card-2"] },
    { "id": "col-discovery","title": "Discovery",   "cardIds": ["card-3"] },
    { "id": "col-progress", "title": "In Progress", "cardIds": [] },
    { "id": "col-review",   "title": "Review",      "cardIds": [] },
    { "id": "col-done",     "title": "Done",        "cardIds": [] }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Align roadmap themes",
      "details": "Draft quarterly themes with impact statements and metrics."
    },
    "card-2": {
      "id": "card-2",
      "title": "Gather customer signals",
      "details": "Review support tags, sales notes, and churn feedback."
    },
    "card-3": {
      "id": "card-3",
      "title": "Prototype analytics view",
      "details": "Sketch initial dashboard layout and key drill-downs."
    }
  }
}
```

Note `cards` is an object keyed by card id, not an array, and ordering lives entirely in each column's
`cardIds`. A card id appearing in no column would be invisible in the UI but still stored — another
invariant Part 6's validation owns, since the database cannot express it.

## What later parts need from this

| Part | Needs |
|---|---|
| 6 | `GET`/`PUT /api/board` reading and writing `boards.data` for the session user |
| 7 | Nothing new; the frontend calls those routes |
| 9 | Read the board as JSON for the prompt, write back the AI's revised board |
| 10 | Nothing new; the sidebar goes through Part 9's endpoint |

Every one of those is "read the whole document" or "write the whole document", which is what this design is
built for.
