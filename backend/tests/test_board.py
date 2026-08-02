import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "data" / "kanban.db"


@pytest.fixture
def client(tmp_path: Path, db_path: Path):
    """Context manager form so startup runs and the schema is created."""
    with TestClient(create_app(tmp_path / "static", db_path)) as client:
        yield client


@pytest.fixture
def signed_in(client: TestClient) -> TestClient:
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client


def test_startup_creates_the_database_file(client: TestClient, db_path: Path):
    assert db_path.exists()


def test_startup_creates_the_schema(client: TestClient, db_path: Path):
    tables = {
        row[0]
        for row in sqlite3.connect(db_path).execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }

    assert {"users", "boards"} <= tables


def test_the_seeded_user_gets_a_demo_board(signed_in: TestClient):
    response = signed_in.get("/api/board")

    assert response.status_code == 200
    board = response.json()
    assert len(board["columns"]) == 5
    assert board["cards"]


def test_put_then_get_round_trips(signed_in: TestClient):
    board = signed_in.get("/api/board").json()
    board["columns"][0]["title"] = "Renamed column"

    put = signed_in.put("/api/board", json=board)

    assert put.status_code == 200
    assert signed_in.get("/api/board").json()["columns"][0]["title"] == "Renamed column"


def test_a_saved_board_survives_a_new_connection(signed_in: TestClient, db_path: Path):
    board = signed_in.get("/api/board").json()
    board["columns"][0]["title"] = "Persisted"
    signed_in.put("/api/board", json=board)

    stored = sqlite3.connect(db_path).execute("SELECT data FROM boards").fetchone()[0]

    assert json.loads(stored)["columns"][0]["title"] == "Persisted"


def test_malformed_board_is_rejected(signed_in: TestClient):
    response = signed_in.put("/api/board", json={"columns": "not a list"})

    assert response.status_code == 422


def test_a_card_id_with_no_card_is_rejected(signed_in: TestClient):
    """The database cannot express this invariant, so the models must."""
    board = signed_in.get("/api/board").json()
    board["columns"][0]["cardIds"].append("card-does-not-exist")

    response = signed_in.put("/api/board", json=board)

    assert response.status_code == 422


def test_get_board_needs_a_session(client: TestClient):
    assert client.get("/api/board").status_code == 401


def test_put_board_needs_a_session(client: TestClient):
    assert client.put("/api/board", json={"columns": [], "cards": {}}).status_code == 401


def test_one_user_cannot_read_another_users_board(signed_in: TestClient, db_path: Path):
    other = json.dumps({"columns": [], "cards": {}})
    with sqlite3.connect(db_path) as con:
        con.execute("INSERT INTO users (username) VALUES ('someone-else')")
        con.execute(
            "INSERT INTO boards (user_id, data) VALUES "
            "((SELECT id FROM users WHERE username = 'someone-else'), ?)",
            (other,),
        )

    board = signed_in.get("/api/board").json()

    assert len(board["columns"]) == 5


def test_foreign_keys_are_enforced_on_every_connection(client: TestClient, db_path: Path):
    """Part 5 proved the pragma is per-connection; this pins that it is applied."""
    from app.db import connect

    with pytest.raises(sqlite3.IntegrityError):
        with connect(db_path) as con:
            con.execute("INSERT INTO boards (user_id, data) VALUES (999, '{}')")
