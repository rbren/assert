"""HTTP wrapper around the local agent-server.

Two things live here:
  - ``chat()``: one-shot LLM call via the OpenAI-compatible endpoint, used to
    tidy up assertion prose.
  - ``create_conversation()`` / ``get_conversation()``: the investigating
    agent, tagged ``assert=assertion-<id>``.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

from .config import AGENT_SERVER_URL, TAG_KEY, TIDY_MODEL

log = logging.getLogger(__name__)

_KEY_FILES = (
    Path("/root/.openhands/agent-canvas/session-api-key.txt"),
    Path.home() / ".openhands" / "agent-canvas" / "session-api-key.txt",
    Path.home() / ".openhands" / "session-api-key.txt",
)


def _load_session_key() -> str:
    for env in ("OH_SESSION_API_KEYS_0", "SESSION_API_KEY", "ASSERT_SESSION_KEY"):
        v = os.environ.get(env)
        if v:
            return v.strip()
    for p in _KEY_FILES:
        if p.exists():
            return p.read_text().strip()
    raise RuntimeError(
        "No agent-server session API key found (checked env "
        "OH_SESSION_API_KEYS_0 / SESSION_API_KEY / ASSERT_SESSION_KEY and "
        f"files {[str(p) for p in _KEY_FILES]})"
    )


def _client(timeout: float = 60.0) -> httpx.Client:
    return httpx.Client(
        base_url=AGENT_SERVER_URL,
        headers={"X-Session-API-Key": _load_session_key()},
        timeout=timeout,
    )


def chat(messages: list[dict[str, str]], *, max_tokens: int = 600) -> str:
    """One-shot completion through the agent-server's OpenAI-compatible API."""
    with _client(timeout=120.0) as c:
        r = c.post(
            "/v1/chat/completions",
            json={
                "model": TIDY_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        r.raise_for_status()
        data = r.json()
    return (data["choices"][0]["message"]["content"] or "").strip()


# The investigating agent needs a shell (grep/git/test runners), a file editor
# (to write its report), and a task tracker for multi-step digging. The active
# agent profile on this host ships an empty tool list, so we set them here.
TOOLS: list[dict[str, Any]] = [
    {"name": "terminal", "params": {}},
    {"name": "file_editor", "params": {}},
    {"name": "task_tracker", "params": {}},
]


def _agent_config() -> dict[str, Any]:
    """``agent_settings`` for ``POST /api/conversations``, from the active
    profile with our tool list swapped in.

    Secrets are fetched with ``X-Expose-Secrets: encrypted`` and round-tripped
    via ``secrets_encrypted``, so the LLM API key never enters this process.
    """
    with _client() as c:
        r = c.get("/api/settings", headers={"X-Expose-Secrets": "encrypted"})
        r.raise_for_status()
        settings = r.json()
    agent_settings = settings.get("agent_settings")
    if not agent_settings or not (agent_settings.get("llm") or {}).get("api_key"):
        raise RuntimeError(
            "Agent-server /api/settings returned no encrypted LLM api_key; "
            "configure a default agent profile first."
        )
    agent_settings = {k: v for k, v in agent_settings.items() if k != "schema_version"}
    agent_settings["tools"] = list(TOOLS)
    return {"agent_settings": agent_settings, "secrets_encrypted": True}


def create_conversation(
    *,
    assertion_id: int,
    initial_message: str,
    working_dir: str,
    title: str | None = None,
    max_iterations: int = 60,
) -> str:
    payload: dict[str, Any] = {
        "workspace": {"kind": "LocalWorkspace", "working_dir": working_dir},
        "worktree": False,
        "max_iterations": max_iterations,
        "stuck_detection": True,
        "autotitle": False,
        "confirmation_policy": {"kind": "NeverConfirm"},
        "tags": {TAG_KEY: f"assertion-{assertion_id}"},
        "initial_message": {
            "role": "user",
            "content": [{"type": "text", "text": initial_message}],
            "run": True,
        },
        **_agent_config(),
    }
    if title:
        payload["title"] = title
    with _client() as c:
        r = c.post("/api/conversations", json=payload)
        r.raise_for_status()
        return r.json()["id"]


def get_conversation(conversation_id: str) -> dict[str, Any] | None:
    with _client() as c:
        r = c.get(f"/api/conversations/{conversation_id}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
