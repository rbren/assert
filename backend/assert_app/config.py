"""Runtime configuration.

Paths are derived from ``ASSERT_DATA_ROOT`` (defaults to ``<repo>/data``).
Nothing here holds secrets: the agent-server session key is read at request
time by ``agent_client``.
"""
from __future__ import annotations

import os
from pathlib import Path


def _default_repo_root() -> Path:
    # backend/assert_app/config.py → repo root is two directories up.
    return Path(__file__).resolve().parent.parent.parent


REPO_ROOT: Path = Path(os.environ.get("ASSERT_REPO_ROOT", _default_repo_root()))
DATA_DIR: Path = Path(os.environ.get("ASSERT_DATA_ROOT", REPO_ROOT / "data"))
CHECKOUTS_DIR: Path = DATA_DIR / "checkouts"
WORKTREES_DIR: Path = DATA_DIR / "worktrees"

DB_PATH: Path = DATA_DIR / "assert.db"
DB_URL: str = f"sqlite:///{DB_PATH}"

AGENT_SERVER_URL: str = os.environ.get(
    "ASSERT_AGENT_SERVER_URL", "http://127.0.0.1:18000"
)

# Conversation tag key; value is ``assertion-<id>``.
TAG_KEY: str = "assert"

# Where agent transcripts are readable. assert runs on its own vhost, so a
# relative /conversations/<id> link would resolve against assert itself.
CANVAS_URL: str = os.environ.get(
    "ASSERT_CANVAS_URL", "https://canvas.rbren.io"
).rstrip("/")

# Model id served by the agent-server's OpenAI-compatible endpoint, used for
# the cheap "tidy up this assertion" call. See GET /v1/models.
TIDY_MODEL: str = os.environ.get("ASSERT_TIDY_MODEL", "openhands_fable")

# Token used to push remediation branches and open pull requests. Needs
# `repo` scope. Read at call time so the process never caches it.
GITHUB_TOKEN_ENVS: tuple[str, ...] = (
    "ASSERT_GITHUB_TOKEN",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "GITHUB_TOKEN",
)

# Pull requests are opened as drafts: the changes are agent-authored and
# meant to be reviewed, not merged on sight.
PR_DRAFT: bool = os.environ.get("ASSERT_PR_DRAFT", "1") != "0"

MAX_ITERATIONS: int = int(os.environ.get("ASSERT_MAX_ITERATIONS", "60"))
POLL_INTERVAL_SECONDS: float = float(os.environ.get("ASSERT_POLL_SECONDS", "10"))

CORS_ORIGINS: list[str] = [
    o for o in os.environ.get("ASSERT_CORS_ORIGINS", "").split(",") if o
]


def ensure_dirs() -> None:
    for d in (DATA_DIR, CHECKOUTS_DIR, WORKTREES_DIR):
        d.mkdir(parents=True, exist_ok=True)
