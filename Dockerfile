# Stage 1: build the Next.js site. `output: "export"` writes plain HTML/JS to out/,
# so none of this stage -- Node, node_modules -- ends up in the final image.
FROM node:22-bookworm-slim AS static-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

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
COPY --from=static-build /build/out ./static

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
