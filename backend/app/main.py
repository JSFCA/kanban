import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

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


def create_app(static_dir: Path = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="Kanban Studio")
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

    # Mounted last so API routes take precedence. check_dir is off because the
    # build output only exists inside the image, not in a host checkout.
    app.mount(
        "/",
        StaticFiles(directory=static_dir, html=True, check_dir=False),
        name="static",
    )
    return app


app = create_app()
