import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.models import BoardData
from app.seed import DEMO_BOARD

# In the container this resolves to /app/data, which start.sh bind-mounts from
# ./data on the host, so the file survives a rebuild. See docs/DATABASE.md.
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "kanban.db"

SCHEMA = """
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
"""


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    """
    Opens a connection with foreign keys enabled.

    The pragma is per-connection, not per-database: setting it once when the
    schema is created leaves every later connection unprotected. Always go
    through this helper.
    """
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def initialise(db_path: Path, username: str) -> None:
    """Idempotent: safe to run on every boot, not just the first."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT OR IGNORE INTO users (username) VALUES (?)", (username,)
        )
        user_id = _user_id(connection, username)
        has_board = connection.execute(
            "SELECT 1 FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not has_board:
            connection.execute(
                "INSERT INTO boards (user_id, data) VALUES (?, ?)",
                (user_id, DEMO_BOARD.model_dump_json()),
            )


def _user_id(connection: sqlite3.Connection, username: str) -> int:
    row = connection.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None:
        raise LookupError(f"No such user: {username}")
    return row["id"]


def load_board(db_path: Path, username: str) -> BoardData:
    with connect(db_path) as connection:
        row = connection.execute(
            # ORDER BY id LIMIT 1 because the schema deliberately allows more
            # than one board per user; never assume a single row.
            "SELECT data FROM boards WHERE user_id = ? ORDER BY id LIMIT 1",
            (_user_id(connection, username),),
        ).fetchone()
    if row is None:
        raise LookupError(f"No board for user: {username}")
    return BoardData.model_validate(json.loads(row["data"]))


def save_board(db_path: Path, username: str, board: BoardData) -> None:
    with connect(db_path) as connection:
        connection.execute(
            """
            UPDATE boards
               SET data = ?, updated_at = datetime('now')
             WHERE id = (SELECT id FROM boards WHERE user_id = ? ORDER BY id LIMIT 1)
            """,
            (board.model_dump_json(), _user_id(connection, username)),
        )
