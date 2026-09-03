"""Assertion lifecycle: tidy the prose, dispatch an agent, ingest its report."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from . import agent_client, github, repos
from .config import DATA_DIR, MAX_ITERATIONS, PR_DRAFT
from .models import (
    CATEGORIES,
    DEFAULT_CATEGORY,
    EFFORTS,
    Assertion,
    Evidence,
    ProposedFix,
    Remediation,
    Run,
)
from .prompts import (
    TIDY_SYSTEM,
    build_investigation_prompt,
    build_remediation_prompt,
)

log = logging.getLogger(__name__)

VERDICTS = {
    "true",
    "partly_true",
    "mostly_false",
    "false",
    "uncertain",
    "unverifiable",
}
_MAX_TEXT = 20_000
MAX_FIXES = 5


def reports_dir() -> Path:
    d = DATA_DIR / "reports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def report_path(run: Run) -> Path:
    return reports_dir() / f"run-{run.id}.json"


# The LLM occasionally prefixes the claim with a label despite being told not
# to; strip it rather than surfacing it to the user.
_LABEL_RE = re.compile(
    r"^\s*(?:the\s+)?(?:rewritten|revised|edited|tidied|cleaned[- ]up|polished|"
    r"corrected|updated|final)?\s*assertion\s*[:\-—]\s*",
    re.IGNORECASE,
)


def _strip_label(text: str) -> str:
    """Drop a leading 'Rewritten assertion:' style label and any wrapping quotes."""
    out = _LABEL_RE.sub("", text.strip(), count=1).strip()
    # Only unwrap quotes that enclose the whole thing, not an interior quotation.
    for lq, rq in (('"', '"'), ("'", "'"), ("“", "”"), ("‘", "’")):
        if len(out) >= 2 and out.startswith(lq) and out.endswith(rq):
            inner = out[1:-1]
            if lq not in inner and rq not in inner:
                out = inner.strip()
            break
    return out


def tidy(raw_text: str) -> dict:
    """Copy-edit an assertion and classify it.

    Returns ``{"text", "title", "emoji", "category"}``. Falls back to the raw
    text with empty metadata if the LLM call or its JSON fails.
    """
    fallback = {
        "text": _strip_label(raw_text),
        "title": "",
        "emoji": "",
        "category": DEFAULT_CATEGORY,
    }
    try:
        out = agent_client.chat(
            [
                {"role": "system", "content": TIDY_SYSTEM},
                {"role": "user", "content": raw_text},
            ],
            max_tokens=700,
        )
        data = _parse_report(out)
    except Exception:
        log.exception("Tidy call failed; keeping raw text")
        return fallback

    if not isinstance(data, dict):
        return fallback

    text = _strip_label(str(data.get("text") or ""))
    category = str(data.get("category") or "").strip().lower()
    return {
        "text": text or fallback["text"],
        "title": str(data.get("title") or "").strip()[:80],
        # Guard against the model returning a word instead of an emoji.
        "emoji": str(data.get("emoji") or "").strip()[:8],
        "category": category if category in CATEGORIES else DEFAULT_CATEGORY,
    }


def backfill_metadata(db: Session, assertion: Assertion) -> None:
    """Give a pre-existing assertion a title/emoji/category.

    Re-runs the tidy pass on the already-tidied text purely for its
    classification, leaving the wording alone.
    """
    if assertion.title:
        return
    meta = tidy(assertion.text or assertion.raw_text)
    assertion.title = meta["title"]
    assertion.emoji = meta["emoji"]
    assertion.category = meta["category"]
    # The label strip is worth taking even on old rows.
    if meta["text"]:
        assertion.text = meta["text"]
    db.commit()


def start_run(db: Session, assertion: Assertion) -> Run:
    """Create a run pinned to the checkout's current HEAD and dispatch an agent."""
    project = assertion.project
    sha = repos.head_sha(project.slug)
    if not sha:
        raise RuntimeError(f"Project {project.slug} has no checkout yet")

    run = Run(assertion_id=assertion.id, status="investigating", commit_sha=sha)
    db.add(run)
    db.commit()
    db.refresh(run)

    prompt = build_investigation_prompt(
        assertion_text=assertion.text or assertion.raw_text,
        checkout_dir=str(repos.checkout_path(project.slug)),
        commit_sha=sha,
        report_path=str(report_path(run)),
    )
    try:
        conv_id = agent_client.create_conversation(
            assertion_id=assertion.id,
            initial_message=prompt,
            working_dir=str(repos.checkout_path(project.slug)),
            title=f"assert #{assertion.id}: {(assertion.text or '')[:60]}",
            max_iterations=MAX_ITERATIONS,
        )
    except Exception as exc:
        run.status = "error"
        run.error = f"Could not start agent: {exc}"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise

    run.conversation_id = conv_id
    db.commit()
    db.refresh(run)
    log.info("assertion %s → run %s → conv %s", assertion.id, run.id, conv_id)
    return run


def _parse_report(text: str) -> dict:
    """Parse the agent's report, tolerating a stray markdown fence."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n", "", text)
        text = re.sub(r"\n```$", "", text.strip())
    return json.loads(text)


def _clip(v: object) -> str:
    return str(v or "")[:_MAX_TEXT]


def ingest_report(db: Session, run: Run) -> bool:
    """Load the agent's report into the run. Returns True if ingested."""
    path = report_path(run)
    if not path.exists():
        return False
    try:
        data = _parse_report(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        run.status = "error"
        run.error = f"Agent report was not valid JSON: {exc}"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        return True

    verdict = str(data.get("verdict") or "").strip().lower()
    run.verdict = verdict if verdict in VERDICTS else "uncertain"
    run.summary = _clip(data.get("summary"))
    run.caveats = _clip(data.get("caveats"))
    run.status = "done"
    run.error = None
    run.finished_at = datetime.now(timezone.utc)

    for old in list(run.evidence):
        db.delete(old)
    for old in list(run.fixes):
        db.delete(old)

    if run.verdict != "true":
        for i, item in enumerate((data.get("fixes") or [])[:MAX_FIXES]):
            if not isinstance(item, dict):
                continue
            effort = str(item.get("effort") or "").strip().lower()
            raw_conf = item.get("confidence")
            db.add(
                ProposedFix(
                    run_id=run.id,
                    position=i,
                    title=_clip(item.get("title"))[:200],
                    plan=_clip(item.get("plan")),
                    effort=effort if effort in EFFORTS else "medium",
                    confidence=(
                        max(0, min(100, raw_conf))
                        if isinstance(raw_conf, int)
                        else None
                    ),
                    notes=_clip(item.get("notes")),
                )
            )

    slug = run.assertion.project.slug
    for i, item in enumerate(data.get("evidence") or []):
        if not isinstance(item, dict):
            continue
        kind = "file" if str(item.get("kind")) == "file" else "command"
        ev = Evidence(
            run_id=run.id,
            position=i,
            kind=kind,
            caption=_clip(item.get("caption")),
        )
        if kind == "command":
            ev.command = _clip(item.get("command"))
            raw_exit = item.get("exit_code")
            ev.exit_code = raw_exit if isinstance(raw_exit, int) else None
            ev.stdout = _clip(item.get("stdout"))
            ev.stderr = _clip(item.get("stderr"))
        else:
            ev.path = _clip(item.get("path"))
            ev.start_line = item.get("start_line") if isinstance(
                item.get("start_line"), int
            ) else None
            ev.end_line = item.get("end_line") if isinstance(
                item.get("end_line"), int
            ) else None
            # Snapshot the excerpt now so the UI stays correct even if the
            # checkout later moves past run.commit_sha.
            ev.content = _clip(
                repos.read_file_lines(slug, ev.path or "", ev.start_line, ev.end_line)
            )
        db.add(ev)

    db.commit()
    db.refresh(run)
    log.info("run %s ingested: %s", run.id, run.verdict)
    return True


def sync_run(db: Session, run: Run) -> Run:
    """Reconcile an in-flight run against its conversation's status."""
    if run.status != "investigating":
        return run
    if ingest_report(db, run):
        return run
    if not run.conversation_id:
        return run

    try:
        conv = agent_client.get_conversation(run.conversation_id)
    except Exception:
        log.exception("Could not fetch conversation %s", run.conversation_id)
        return run

    status = (conv or {}).get("execution_status")
    if status in {"finished", "error", "stuck", "paused"}:
        # The agent stopped without leaving a parseable report.
        run.status = "error"
        run.error = (
            f"Agent finished ({status}) without writing a report to "
            f"{report_path(run).name}."
        )
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
    return run


# --- remediation ------------------------------------------------------------


def remediation_report_path(rem: Remediation) -> Path:
    return reports_dir() / f"remediation-{rem.id}.json"


def start_remediation(
    db: Session, assertion: Assertion, fix: ProposedFix | None = None
) -> Remediation:
    """Dispatch an agent to apply ``fix`` on a scratch worktree.

    Defaults to the run's first (best-rated) fix when none is named.
    """
    run = assertion.latest_run
    if run is None or run.status != "done":
        raise RuntimeError("Assertion has no finished run to remediate")
    if run.verdict == "true":
        raise RuntimeError("Assertion is already true")

    if fix is None:
        if not run.fixes:
            raise RuntimeError("The latest run proposed no fixes")
        fix = run.fixes[0]
    elif fix.run_id != run.id:
        raise RuntimeError("That fix belongs to an older run")

    project = assertion.project
    rem = Remediation(
        assertion_id=assertion.id,
        run_id=run.id,
        fix_id=fix.id,
        status="working",
        base_commit=repos.head_sha(project.slug),
    )
    db.add(rem)
    db.commit()
    db.refresh(rem)

    branch = f"assert/remediation-{rem.id}"
    try:
        worktree = repos.create_worktree(project.slug, branch)
    except Exception as exc:
        rem.status = "error"
        rem.error = f"Could not create worktree: {exc}"
        rem.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise

    rem.branch = branch
    db.commit()

    prompt = build_remediation_prompt(
        assertion_text=assertion.text or assertion.raw_text,
        fix_title=fix.title,
        remediation_plan=fix.plan,
        checkout_dir=str(worktree),
        branch=branch,
        report_path=str(remediation_report_path(rem)),
    )
    try:
        conv_id = agent_client.create_conversation(
            assertion_id=assertion.id,
            initial_message=prompt,
            working_dir=str(worktree),
            title=f"fix #{assertion.id}: {(fix.title or assertion.title)[:60]}",
            max_iterations=MAX_ITERATIONS,
        )
    except Exception as exc:
        rem.status = "error"
        rem.error = f"Could not start agent: {exc}"
        rem.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise

    rem.conversation_id = conv_id
    db.commit()
    db.refresh(rem)
    log.info("assertion %s → remediation %s → conv %s", assertion.id, rem.id, conv_id)
    return rem


def ingest_remediation(db: Session, rem: Remediation) -> bool:
    """Load the remediation agent's report and capture its diff."""
    path = remediation_report_path(rem)
    if not path.exists():
        return False

    slug = rem.assertion.project.slug
    try:
        data = _parse_report(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        rem.status = "error"
        rem.error = f"Agent report was not valid JSON: {exc}"
        rem.finished_at = datetime.now(timezone.utc)
        db.commit()
        return True

    rem.summary = _clip(data.get("summary"))
    rem.status = "error" if str(data.get("status")) == "blocked" else "done"
    if rem.status == "error" and not rem.error:
        rem.error = "Agent reported it was blocked."
    rem.diff = _clip(
        repos.worktree_diff(slug, rem.branch or "", rem.base_commit or "")
    )
    rem.finished_at = datetime.now(timezone.utc)
    db.commit()

    if rem.status == "done":
        _open_pull_request(db, rem, pr_title=str(data.get("pr_title") or "").strip())

    db.refresh(rem)
    log.info("remediation %s ingested: %s", rem.id, rem.status)
    return True


def _pr_body(rem: Remediation) -> str:
    a = rem.assertion
    fix_title = rem.fix.title if rem.fix else ""
    lines = [
        "### Assertion",
        "",
        f"> {a.text or a.raw_text}",
        "",
    ]
    if fix_title:
        lines += [f"### Fix applied: {fix_title}", ""]
    if rem.summary:
        lines += [rem.summary, ""]
    if rem.base_commit:
        lines += [f"Branched from `{rem.base_commit[:10]}`.", ""]
    lines += [
        "---",
        "",
        "_This pull request was opened by an AI agent (OpenHands) on behalf of "
        "@rbren, via [assert](https://github.com/rbren/assert), which checks "
        "assertions about a codebase and proposes fixes when they do not hold. "
        "Please review before merging._",
    ]
    return "\n".join(lines)


def _open_pull_request(db: Session, rem: Remediation, *, pr_title: str) -> None:
    """Push the remediation branch and open a PR for it.

    Failures here are recorded on ``pr_error`` and deliberately do not fail the
    remediation: the change still exists locally and its diff is worth showing.
    """
    project = rem.assertion.project
    branch = rem.branch or ""
    slug = project.slug

    def fail(msg: str) -> None:
        rem.pr_error = msg
        db.commit()
        log.warning("remediation %s: no PR: %s", rem.id, msg)

    parsed = github.parse_repo(project.repo_url)
    if not parsed:
        return fail("Only github.com repositories can have pull requests opened.")
    owner, repo = parsed

    repos.commit_all(slug, branch, pr_title or f"assert: {rem.assertion.title}")
    if not repos.has_commits(slug, branch, rem.base_commit or ""):
        return fail("The agent left no commits on its branch, so there is nothing to open.")

    ok, why = github.can_push(owner, repo)
    if not ok:
        return fail(why)

    token = github.token()
    try:
        repos.push_branch(slug, branch, token)
    except Exception as exc:
        return fail(f"Could not push the branch: {exc}")

    try:
        url, number = github.open_pull_request(
            owner=owner,
            repo=repo,
            head=branch,
            base=project.default_branch or "main",
            title=pr_title or f"assert: {rem.assertion.title or 'fix'}",
            body=_pr_body(rem),
            draft=PR_DRAFT,
        )
    except Exception as exc:
        return fail(str(exc))

    rem.pr_url = url
    rem.pr_number = number
    rem.pr_error = None
    db.commit()


def sync_remediation(db: Session, rem: Remediation) -> Remediation:
    """Reconcile an in-flight remediation against its conversation's status."""
    if rem.status != "working":
        return rem
    if ingest_remediation(db, rem):
        return rem
    if not rem.conversation_id:
        return rem

    try:
        conv = agent_client.get_conversation(rem.conversation_id)
    except Exception:
        log.exception("Could not fetch conversation %s", rem.conversation_id)
        return rem

    status = (conv or {}).get("execution_status")
    if status in {"finished", "error", "stuck", "paused"}:
        rem.status = "error"
        rem.error = f"Agent finished ({status}) without writing a report."
        rem.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(rem)
    return rem
