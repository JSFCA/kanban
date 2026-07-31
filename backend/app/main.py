from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def create_app(static_dir: Path = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="Kanban Studio")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # Mounted last so API routes take precedence. check_dir is off because the
    # build output only exists inside the image, not in a host checkout.
    app.mount(
        "/",
        StaticFiles(directory=static_dir, html=True, check_dir=False),
        name="static",
    )
    return app


app = create_app()
