import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from app import ai
from app.db import DEFAULT_DB_PATH, initialise, load_board, save_board
from app.models import BoardData

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# The MVP has a single hardcoded account; the database will carry real users later.
USERNAME = "user"
PASSWORD = "password"

# Signs the session cookie. Override in .env for anything but local use.
SESSION_SECRET = os.environ.get("SESSION_SECRET", "local-development-secret")


class Credentials(BaseModel):
    username: str
    password: str


class User(BaseModel):
    username: str


def require_user(request: Request) -> User:
    """Depend on this from any route that must not serve data to a stranger."""
    username = request.session.get("username")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in"
        )
    return User(username=username)


def create_app(
    static_dir: Path = STATIC_DIR, db_path: Path = DEFAULT_DB_PATH
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # On startup, not at import: importing this module must not touch disk.
        initialise(db_path, USERNAME)
        if not ai.api_key():
            raise RuntimeError(
                "OPENROUTER_API_KEY is not set. Put it in the project-root .env; "
                "scripts/start.sh and scripts/test.sh pass that file to the container."
            )
        yield

    app = FastAPI(title="Kanban Studio", lifespan=lifespan)
    app.add_middleware(
        SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax"
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/login")
    def login(credentials: Credentials, request: Request) -> User:
        if credentials.username != USERNAME or credentials.password != PASSWORD:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
        request.session["username"] = credentials.username
        return User(username=credentials.username)

    @app.post("/api/logout")
    def logout(request: Request) -> dict[str, str]:
        request.session.clear()
        return {"status": "signed out"}

    @app.get("/api/me")
    def me(user: User = Depends(require_user)) -> User:
        return user

    @app.get("/api/board")
    def get_board(user: User = Depends(require_user)) -> BoardData:
        return load_board(db_path, user.username)

    @app.put("/api/board")
    def put_board(
        board: BoardData, user: User = Depends(require_user)
    ) -> BoardData:
        save_board(db_path, user.username, board)
        return board

    # async, unlike the routes above: an outbound call can take up to 30
    # seconds, and a sync route would hold a threadpool worker for all of it.
    @app.post("/api/ai/ping")
    async def ai_ping(user: User = Depends(require_user)) -> dict[str, str]:
        try:
            reply = await ai.complete([{"role": "user", "content": "What is 2+2?"}])
        except ai.AIError as error:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error))
        return {"reply": reply}

    # Mounted last so API routes take precedence. check_dir is off because the
    # build output only exists inside the image, not in a host checkout.
    app.mount(
        "/",
        StaticFiles(directory=static_dir, html=True, check_dir=False),
        name="static",
    )
    return app


app = create_app()
