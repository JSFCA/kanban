"""The OpenRouter client. No FastAPI in here, no database, and no retries."""

import json
import os

# The package is httpx2 and it imports under that name. There is no top-level
# `httpx` in the image; assuming there was cost a container crash-loop.
import httpx2

from app.models import BoardData

URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
TIMEOUT = 30.0

# The most recent turns kept in the prompt, so a long conversation cannot grow
# it without bound.
HISTORY_LIMIT = 20

Message = dict[str, str]


class AIError(Exception):
    """Anything that went wrong upstream. The API turns this into a 502."""


def api_key() -> str:
    """Read per call, not at import: tests swap the key to exercise failure."""
    return os.environ.get("OPENROUTER_API_KEY", "")


def build_payload(messages: list[Message], tool: dict | None = None) -> dict:
    payload = {"model": MODEL, "messages": messages}
    if tool:
        # tool_choice forces the call. This model does not support
        # response_format, so a forced tool is how the reply gets a schema.
        name = tool["function"]["name"]
        payload["tools"] = [tool]
        payload["tool_choice"] = {"type": "function", "function": {"name": name}}
    return payload


async def _post(payload: dict) -> dict:
    async with httpx2.AsyncClient(timeout=TIMEOUT) as client:
        try:
            response = await client.post(
                URL,
                headers={"Authorization": f"Bearer {api_key()}"},
                json=payload,
            )
        except httpx2.HTTPError as error:
            raise AIError(f"Could not reach OpenRouter: {error}") from error

    if response.status_code != 200:
        raise AIError(f"OpenRouter returned {response.status_code}: {response.text}")

    return extract_message(response.json())


def extract_message(body: dict) -> dict:
    """
    A 200 does not guarantee a completion: OpenRouter returns rate limits and
    some upstream failures as an `error` object with a 200 status. Seen in the
    wild, as a KeyError and a 500 where a 502 was promised. The body goes into
    the message because that is the only record of what actually came back.
    """
    if not body.get("choices"):
        raise AIError(f"OpenRouter returned no completion: {body}")
    return body["choices"][0]["message"]


async def complete(messages: list[Message]) -> str:
    return (await _post(build_payload(messages)))["content"]


# The board schema comes from the models so it cannot drift from them. Pydantic
# emits `$defs` with `#/$defs/Card` references resolved against the document
# root, so the definitions are hoisted to the top of `parameters` -- left nested
# under `board` they would point at nothing.
_BOARD_SCHEMA = BoardData.model_json_schema()
_BOARD_DEFS = _BOARD_SCHEMA.pop("$defs", {})

RESPOND_TOOL = {
    "type": "function",
    "function": {
        "name": "respond",
        "description": (
            "Reply to the user. Include `board` only when the user asked for a "
            "change to the board; omit it entirely for questions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reply": {
                    "type": "string",
                    "description": "The message shown to the user.",
                },
                "board": {
                    **_BOARD_SCHEMA,
                    "description": "The complete updated board. Omit when nothing changed.",
                },
            },
            "required": ["reply"],
            "$defs": _BOARD_DEFS,
        },
    },
}

SYSTEM_PROMPT = """You manage a Kanban board for the user. Always answer by calling the `respond` tool.

The board is JSON with `columns` (ordered, each holding an ordered list of `cardIds`) and `cards` (keyed by
card id). This is the board right now:

{board}

Rules for the `board` argument:
- Send it only when the user asked you to change something. For a question, omit it and just reply.
- Send the whole board, not a fragment. Anything you leave out is deleted.
- Keep existing ids. Moving a card means removing its id from one column's cardIds and adding it to another.
- New cards need a new unique id, an entry in `cards`, and their id in exactly one column's cardIds.
- Every id in any cardIds must exist in `cards`, or the update is rejected.
"""


def build_messages(
    board: BoardData, history: list[Message], message: str
) -> list[Message]:
    system = SYSTEM_PROMPT.format(board=board.model_dump_json(indent=2))
    return [
        {"role": "system", "content": system},
        *history[-HISTORY_LIMIT:],
        {"role": "user", "content": message},
    ]


async def call_respond(messages: list[Message]) -> dict:
    """Return the forced tool call's arguments."""
    reply = await _post(build_payload(messages, RESPOND_TOOL))
    calls = reply.get("tool_calls")
    if not calls:
        raise AIError(f"The model answered without calling the tool: {reply}")
    try:
        return json.loads(calls[0]["function"]["arguments"])
    except json.JSONDecodeError as error:
        raise AIError(f"The tool call was not valid JSON: {error}") from error
