"""Part 9 talks to OpenRouter for real, like Part 8.

Two of these tests spend free-tier quota and depend on the model behaving. The
board-mutation test asks for a specific move and retries once, because a model
that declines is a real failure mode worth seeing rather than hiding behind a
loose assertion.

What is *not* live: the rejection path. There is no way to make the model emit a
malformed board on demand, so `apply_tool_call` is called directly with one. That
is our code under test, not a mock of theirs.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ai
from app.main import apply_tool_call, create_app
from app.seed import DEMO_BOARD


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "data" / "kanban.db"


@pytest.fixture
def client(tmp_path: Path, db_path: Path):
    with TestClient(create_app(tmp_path / "static", db_path)) as client:
        yield client


@pytest.fixture
def signed_in(client: TestClient) -> TestClient:
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client


def stored_board(db_path: Path) -> dict:
    import sqlite3

    return json.loads(
        sqlite3.connect(db_path).execute("SELECT data FROM boards").fetchone()[0]
    )


def test_chat_needs_a_session(client: TestClient):
    response = client.post("/api/ai/chat", json={"message": "hello"})

    assert response.status_code == 401


def test_the_prompt_carries_the_board_and_the_history():
    history = [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "sure"}]

    messages = ai.build_messages(DEMO_BOARD, history, "move a card")

    assert messages[0]["role"] == "system"
    assert "card-1" in messages[0]["content"], "the current board must be in the prompt"
    assert messages[1:-1] == history
    assert messages[-1] == {"role": "user", "content": "move a card"}


def test_history_is_capped():
    history = [{"role": "user", "content": str(n)} for n in range(ai.HISTORY_LIMIT * 2)]

    messages = ai.build_messages(DEMO_BOARD, history, "now")

    # system + capped history + the new message
    assert len(messages) == ai.HISTORY_LIMIT + 2
    assert messages[1]["content"] == str(ai.HISTORY_LIMIT), "the oldest turns go first"


def test_the_tool_schema_resolves_its_own_refs():
    """$defs must sit at the parameters root or `#/$defs/Card` points nowhere."""
    parameters = ai.RESPOND_TOOL["function"]["parameters"]

    assert "Card" in parameters["$defs"]
    assert "$defs" not in parameters["properties"]["board"]


def test_a_malformed_board_is_rejected_and_the_db_is_untouched(
    signed_in: TestClient, db_path: Path
):
    before = stored_board(db_path)
    arguments = {
        "reply": "Done!",
        "board": {"columns": [{"id": "c", "title": "C", "cardIds": ["ghost"]}], "cards": {}},
    }

    with pytest.raises(ai.AIError):
        apply_tool_call(db_path, "user", arguments)

    assert stored_board(db_path) == before


def test_an_echoed_board_is_not_an_update(signed_in: TestClient, db_path: Path):
    """Asked a question, the model sometimes returns the board untouched."""
    arguments = {"reply": "Here it is.", "board": stored_board(db_path)}

    response = apply_tool_call(db_path, "user", arguments)

    assert response.board_updated is False
    assert response.board is None


def test_a_question_does_not_change_the_board(signed_in: TestClient, db_path: Path):
    before = stored_board(db_path)

    response = signed_in.post(
        "/api/ai/chat",
        json={"message": "Which cards are in the Done column? Just list them."},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    # Named values, because when the model misbehaves the failure has to say how.
    assert body["reply"], f"empty reply: {body}"
    assert body["board_updated"] is False, f"a question changed the board: {body}"
    assert body["board"] is None, f"a question returned a board: {body}"
    assert stored_board(db_path) == before, "the stored board moved"


def test_moving_a_card_is_persisted(signed_in: TestClient, db_path: Path):
    """Strict: the named card must land in Done. One retry, then it is a failure."""
    for attempt in range(2):
        response = signed_in.post(
            "/api/ai/chat",
            json={"message": "Move the card titled 'Design card layout' to the Done column."},
        )
        assert response.status_code == 200, response.text
        if response.json()["board_updated"]:
            break
    else:
        pytest.fail("the model declined to change the board twice")

    done = next(c for c in response.json()["board"]["columns"] if c["id"] == "col-done")
    assert "card-5" in done["cardIds"]
    assert "card-5" in stored_board(db_path)["columns"][4]["cardIds"]
