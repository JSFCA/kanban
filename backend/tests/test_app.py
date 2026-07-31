from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    """Stands in for the Next.js build output that Docker copies into the image."""
    (tmp_path / "index.html").write_text("<h1>Kanban Studio</h1>")
    assets = tmp_path / "_next"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('kanban');")
    return tmp_path


@pytest.fixture
def client(static_dir: Path) -> TestClient:
    return TestClient(create_app(static_dir))


def test_health_returns_ok(client: TestClient):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_the_built_index(client: TestClient):
    response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Kanban Studio" in response.text


def test_static_asset_resolves(client: TestClient):
    response = client.get("/_next/app.js")

    assert response.status_code == 200
    assert "console.log('kanban');" in response.text


def test_unknown_api_path_returns_404_not_the_page(client: TestClient):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert "Kanban Studio" not in response.text


def test_missing_static_dir_does_not_break_the_api(tmp_path: Path):
    """The build output only exists inside the image, so the host must not crash."""
    client = TestClient(create_app(tmp_path / "absent"))

    assert client.get("/api/health").status_code == 200
