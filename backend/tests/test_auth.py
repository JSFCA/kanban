from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(tmp_path))


def login(client: TestClient, username: str = "user", password: str = "password"):
    return client.post("/api/login", json={"username": username, "password": password})


def test_login_with_correct_credentials_sets_a_session(client: TestClient):
    response = login(client)

    assert response.status_code == 200
    assert response.json() == {"username": "user"}
    assert "session" in response.cookies or "session" in client.cookies


def test_login_with_a_wrong_password_is_rejected(client: TestClient):
    response = login(client, password="nope")

    assert response.status_code == 401
    assert "session" not in client.cookies


def test_login_with_an_unknown_user_is_rejected(client: TestClient):
    response = login(client, username="intruder")

    assert response.status_code == 401
    assert "session" not in client.cookies


def test_me_without_a_session_is_401(client: TestClient):
    response = client.get("/api/me")

    assert response.status_code == 401


def test_me_with_a_session_returns_the_user(client: TestClient):
    login(client)

    response = client.get("/api/me")

    assert response.status_code == 200
    assert response.json() == {"username": "user"}


def test_logout_clears_the_session(client: TestClient):
    login(client)

    response = client.post("/api/logout")

    assert response.status_code == 200
    assert client.get("/api/me").status_code == 401


def test_session_cookie_is_http_only(client: TestClient):
    """A script-readable session cookie would be stealable by injected JavaScript."""
    response = login(client)

    set_cookie = response.headers["set-cookie"]
    assert "httponly" in set_cookie.lower()


def test_health_stays_public(client: TestClient):
    """start.sh and Playwright poll this before anyone can log in."""
    assert client.get("/api/health").status_code == 200
