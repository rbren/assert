"""GitHub API calls for turning a remediation branch into a pull request.

The token lives only in this module's function scope and in the `Authorization`
header — it is never written to the database, the prompt, or the agent's
conversation, so an agent transcript can be shared without leaking it.
"""
from __future__ import annotations

import logging
import os
import re

import httpx

from .config import GITHUB_TOKEN_ENVS

log = logging.getLogger(__name__)

API = "https://api.github.com"


class GitHubError(RuntimeError):
    pass


def token() -> str | None:
    for env in GITHUB_TOKEN_ENVS:
        v = os.environ.get(env)
        if v and v.strip():
            return v.strip()
    return None


def parse_repo(clone_url: str) -> tuple[str, str] | None:
    """``(owner, repo)`` for a github.com clone URL, else ``None``."""
    m = re.match(
        r"^(?:https?://|git@)(?:www\.)?github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$",
        (clone_url or "").strip(),
    )
    return (m.group(1), m.group(2)) if m else None


def _headers(tok: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {tok}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def can_push(owner: str, repo: str) -> tuple[bool, str]:
    """Whether the token may push to the repo, and why not when it may not."""
    tok = token()
    if not tok:
        return False, "No GitHub token is configured on the server."
    try:
        r = httpx.get(f"{API}/repos/{owner}/{repo}", headers=_headers(tok), timeout=30)
    except httpx.HTTPError as exc:
        return False, f"Could not reach the GitHub API: {exc}"
    if r.status_code == 404:
        return False, f"{owner}/{repo} is not visible to the configured token."
    if r.status_code != 200:
        return False, f"GitHub returned {r.status_code} for {owner}/{repo}."
    if not (r.json().get("permissions") or {}).get("push"):
        return False, f"The configured token cannot push to {owner}/{repo}."
    return True, ""


def open_pull_request(
    *,
    owner: str,
    repo: str,
    head: str,
    base: str,
    title: str,
    body: str,
    draft: bool = True,
) -> tuple[str, int]:
    """Open a PR and return ``(html_url, number)``.

    Reuses the existing PR when one is already open for ``head``, so retrying
    an ingest does not create duplicates.
    """
    tok = token()
    if not tok:
        raise GitHubError("No GitHub token is configured on the server.")

    existing = httpx.get(
        f"{API}/repos/{owner}/{repo}/pulls",
        headers=_headers(tok),
        params={"head": f"{owner}:{head}", "state": "open"},
        timeout=30,
    )
    if existing.status_code == 200 and existing.json():
        pr = existing.json()[0]
        return pr["html_url"], pr["number"]

    r = httpx.post(
        f"{API}/repos/{owner}/{repo}/pulls",
        headers=_headers(tok),
        json={
            "title": title,
            "body": body,
            "head": head,
            "base": base,
            "draft": draft,
            "maintainer_can_modify": True,
        },
        timeout=60,
    )
    if r.status_code >= 300:
        detail = r.text
        try:
            payload = r.json()
            detail = payload.get("message") or detail
            if payload.get("errors"):
                detail += f" ({payload['errors']})"
        except ValueError:
            pass
        raise GitHubError(f"GitHub refused to open the pull request: {detail}")
    pr = r.json()
    log.info("opened PR %s", pr["html_url"])
    return pr["html_url"], pr["number"]
