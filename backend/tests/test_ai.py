"""Part 8 talks to OpenRouter for real.

There is no mocking here by choice: the point of this part is to prove the
backend can reach OpenRouter, and a mocked call proves only that we can write a
mock. Two of these tests spend free-tier quota on every run. The timeout path is
not covered -- it cannot be forced honestly without a mock.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ai
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path / "static", tmp_path / "data" / "kanban.db")) as client:
        yield client


@pytest.fixture
def signed_in(client: TestClient) -> TestClient:
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client


def test_ping_needs_a_session(client: TestClient):
    assert client.post("/api/ai/ping").status_code == 401


def test_payload_carries_the_model_and_messages():
    messages = [{"role": "user", "content": "What is 2+2?"}]

    payload = ai.build_payload(messages)

    assert payload["model"] == "nvidia/nemotron-3-ultra-550b-a55b:free"
    assert payload["messages"] == messages


def test_a_200_without_a_completion_is_an_error():
    """Rate limits arrive as an `error` object with a 200 status, not a 429."""
    body = {"error": {"message": "Rate limit exceeded", "code": 429}}

    with pytest.raises(ai.AIError, match="no completion"):
        ai.extract_message(body)


def test_ping_answers_two_plus_two(signed_in: TestClient):
    response = signed_in.post("/api/ai/ping")

    assert response.status_code == 200
    assert "4" in response.json()["reply"]


def test_an_upstream_rejection_becomes_502(
    signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """A real call with a real bad key: OpenRouter answers 401, we answer 502."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-v1-not-a-real-key")

    response = signed_in.post("/api/ai/ping")

    assert response.status_code == 502
