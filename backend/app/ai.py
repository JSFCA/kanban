"""The OpenRouter client. No FastAPI in here, and no retries."""

import os

# The package is httpx2 and it imports under that name. There is no top-level
# `httpx` in the image; assuming there was cost a container crash-loop.
import httpx2

URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
TIMEOUT = 30.0

Message = dict[str, str]


class AIError(Exception):
    """Anything that went wrong upstream. The API turns this into a 502."""


def api_key() -> str:
    """Read per call, not at import: tests swap the key to exercise failure."""
    return os.environ.get("OPENROUTER_API_KEY", "")


def build_payload(messages: list[Message]) -> dict:
    return {"model": MODEL, "messages": messages}


async def complete(messages: list[Message]) -> str:
    async with httpx2.AsyncClient(timeout=TIMEOUT) as client:
        try:
            response = await client.post(
                URL,
                headers={"Authorization": f"Bearer {api_key()}"},
                json=build_payload(messages),
            )
        except httpx2.HTTPError as error:
            raise AIError(f"Could not reach OpenRouter: {error}") from error

    if response.status_code != 200:
        raise AIError(f"OpenRouter returned {response.status_code}: {response.text}")

    return response.json()["choices"][0]["message"]["content"]
