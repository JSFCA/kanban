# Stage 1: the static site served at /.
# Part 2 ships a placeholder page. Part 3 replaces the copy below with the Next.js build.
FROM node:22-bookworm-slim AS static-build
WORKDIR /build
COPY backend/static ./static

# Stage 2: FastAPI runtime, dependencies managed by uv.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-install-project

COPY backend/app ./app
COPY backend/tests ./tests
COPY --from=static-build /build/static ./static

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
