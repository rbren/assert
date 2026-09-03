"""Cloning and inspecting the repositories under investigation.

Each project gets a checkout at ``CHECKOUTS_DIR/<slug>``. Agents run in that
directory read-only-by-convention; we re-resolve HEAD before every run so the
commit recorded with the evidence is the one the agent actually saw.
"""
from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from .config import CHECKOUTS_DIR

log = logging.getLogger(__name__)

_GIT_ENV = {
    "HOME": "/root",  # so ~/.ssh and ~/.gitconfig are found
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "GIT_TERMINAL_PROMPT": "0",  # fail instead of hanging on auth prompts
}


class RepoError(RuntimeError):
    pass


def normalize_url(raw: str) -> tuple[str, str, str]:
    """Return ``(clone_url, owner, repo)`` for a pasted GitHub reference.

    Accepts ``https://github.com/o/r``, ``github.com/o/r``, ``o/r``,
    ``git@github.com:o/r.git`` and trailing ``/tree/<branch>`` noise.
    """
    s = (raw or "").strip()
    if not s:
        raise RepoError("Empty repository URL")

    m = re.match(r"^git@([^:]+):(.+?)(?:\.git)?/?$", s)
    if m:
        host, path = m.group(1), m.group(2)
    else:
        if "://" not in s:
            s = "https://" + (s if "/" in s and "." in s.split("/")[0] else f"github.com/{s}")
        u = urlparse(s)
        host = u.netloc
        path = u.path.strip("/")
        path = re.sub(r"\.git$", "", path)

    parts = [p for p in path.split("/") if p]
    if len(parts) < 2:
        raise RepoError(f"Could not parse owner/repo out of {raw!r}")
    owner, repo = parts[0], parts[1]
    return f"https://{host}/{owner}/{repo}.git", owner, repo


def slug_for(owner: str, repo: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", f"{owner}-{repo}".lower()).strip("-")


def checkout_path(slug: str) -> Path:
    return CHECKOUTS_DIR / slug


def _git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
        env=_GIT_ENV,
        timeout=900,
    )


def clone_or_update(clone_url: str, slug: str) -> tuple[str, str]:
    """Clone (or fetch+reset) the repo. Returns ``(head_sha, branch)``."""
    CHECKOUTS_DIR.mkdir(parents=True, exist_ok=True)
    dest = checkout_path(slug)

    if not (dest / ".git").exists():
        r = subprocess.run(
            ["git", "clone", "--quiet", clone_url, str(dest)],
            capture_output=True,
            text=True,
            env=_GIT_ENV,
            timeout=1800,
        )
        if r.returncode != 0:
            raise RepoError(r.stderr.strip() or "git clone failed")
    else:
        r = _git("fetch", "--quiet", "origin", cwd=dest, check=False)
        if r.returncode != 0:
            log.warning("fetch failed for %s: %s", slug, r.stderr.strip())

    branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=dest).stdout.strip()
    upstream = _git(
        "rev-parse", "--verify", "--quiet", f"origin/{branch}", cwd=dest, check=False
    )
    if upstream.returncode == 0:
        _git("reset", "--hard", "--quiet", f"origin/{branch}", cwd=dest, check=False)
    head = _git("rev-parse", "HEAD", cwd=dest).stdout.strip()
    return head, branch


def head_sha(slug: str) -> str | None:
    dest = checkout_path(slug)
    if not (dest / ".git").exists():
        return None
    r = _git("rev-parse", "HEAD", cwd=dest, check=False)
    return r.stdout.strip() or None


def read_file_lines(
    slug: str, path: str, start: int | None, end: int | None
) -> str | None:
    """Read ``path`` from the checkout, optionally clipped to a line range.

    Returns ``None`` if the path escapes the checkout or does not exist.
    """
    root = checkout_path(slug).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        return None
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    if start is None:
        return text
    lines = text.splitlines()
    lo = max(1, start) - 1
    hi = min(len(lines), end or start)
    return "\n".join(lines[lo:hi])
