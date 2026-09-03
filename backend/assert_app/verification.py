"""Assertion lifecycle: tidy the prose, dispatch an agent, ingest its report."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from . import agent_client, repos
from .config import DATA_DIR, MAX_ITERATIONS
from .models import Assertion, Evidence, Run
from .prompts import TIDY_SYSTEM, build_investigation_prompt

log = logging.getLogger(__name__)

VERDICTS = {"true", "false", "partly_true", "unverifiable"}
_MAX_TEXT = 20_000


def reports_dir() -> Path:
    d = DATA_DIR / "reports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def report_path(run: Run) -> Path:
    return reports_dir() / f"run-{run.id}.json"


def tidy(raw_text: str) -> str:
    """Copy-edit an assertion. Falls back to the raw text if the LLM fails."""
    try:
        out = agent_client.chat(
            [
                {"role": "system", "content": TIDY_SYSTEM},
                {"role": "user", "content": raw_text},
            ],
            max_tokens=400,
        )
    except Exception:
        log.exception("Tidy call failed; keeping raw text")
        return raw_text.strip()
    out = out.strip().strip("`").strip()
    return out or raw_text.strip()


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
    run.verdict = verdict if verdict in VERDICTS else "unverifiable"
    run.summary = _clip(data.get("summary"))
    run.suggested_text = _clip(data.get("suggested_assertion"))
    run.caveats = _clip(data.get("caveats"))
    run.status = "done"
    run.error = None
    run.finished_at = datetime.now(timezone.utc)

    for old in list(run.evidence):
        db.delete(old)

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
