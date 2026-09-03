from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import repos, verification
from .db import get_session, session_scope
from .models import Assertion, Project, ProposedFix, Remediation
from .schemas import (
    AssertionCreate,
    AssertionOut,
    AssertionUpdate,
    ProjectCreate,
    ProjectDetail,
    ProjectSummary,
    RemediateRequest,
    RemediationOut,
    RunOut,
)

log = logging.getLogger(__name__)
router = APIRouter()

_PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


# ─── Serialization ────────────────────────────────────────────────────────


def _run_out(run, project: Project | None = None) -> RunOut | None:  # noqa: ANN001
    if run is None:
        return None
    out = RunOut.model_validate(run)
    if project is not None and run.commit_sha:
        out.commits_behind = repos.commits_since(project.slug, run.commit_sha)
    return out


def _assertion_out(a: Assertion) -> AssertionOut:
    return AssertionOut(
        id=a.id,
        project_id=a.project_id,
        raw_text=a.raw_text,
        text=a.text,
        title=a.title,
        emoji=a.emoji,
        category=a.category,
        priority=a.priority,
        status=a.status,
        created_at=a.created_at,
        updated_at=a.updated_at,
        latest_run=_run_out(a.latest_run, a.project),
        latest_remediation=(
            RemediationOut.model_validate(a.latest_remediation)
            if a.latest_remediation
            else None
        ),
    )


def _project_summary(p: Project) -> ProjectSummary:
    standing: dict[str, int] = {}
    for a in p.assertions:
        standing[a.status] = standing.get(a.status, 0) + 1
    return ProjectSummary(
        id=p.id,
        repo_url=p.repo_url,
        slug=p.slug,
        name=p.name,
        default_branch=p.default_branch,
        head_commit=p.head_commit,
        clone_status=p.clone_status,
        clone_error=p.clone_error,
        created_at=p.created_at,
        assertion_count=len(p.assertions),
        standing=standing,
    )


# ─── Background work ──────────────────────────────────────────────────────


def _clone_project(project_id: int, clone_url: str, slug: str) -> None:
    try:
        sha, branch = repos.clone_or_update(clone_url, slug)
        with session_scope() as db:
            p = db.get(Project, project_id)
            if p:
                p.head_commit = sha
                p.default_branch = branch
                p.clone_status = "ready"
                p.clone_error = None
    except Exception as exc:
        log.exception("Clone failed for %s", clone_url)
        with session_scope() as db:
            p = db.get(Project, project_id)
            if p:
                p.clone_status = "error"
                p.clone_error = str(exc)[:2000]


def _tidy_and_verify(assertion_id: int) -> None:
    """Copy-edit and classify the assertion, then dispatch the investigator."""
    with session_scope() as db:
        a = db.get(Assertion, assertion_id)
        if a is None:
            return
        meta = verification.tidy(a.raw_text)
        a.text = meta["text"]
        a.title = meta["title"]
        a.emoji = meta["emoji"]
        a.category = meta["category"]
        db.commit()
        try:
            verification.start_run(db, a)
        except Exception:
            log.exception("Failed to start run for assertion %s", assertion_id)


# ─── Projects ─────────────────────────────────────────────────────────────


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_session)) -> list[ProjectSummary]:
    projects = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
    return [_project_summary(p) for p in projects]


@router.post("/projects", response_model=ProjectSummary, status_code=201)
def create_project(
    payload: ProjectCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
) -> ProjectSummary:
    try:
        clone_url, owner, repo = repos.normalize_url(payload.repo_url)
    except repos.RepoError as exc:
        raise HTTPException(400, str(exc)) from exc

    existing = db.scalar(select(Project).where(Project.repo_url == clone_url))
    if existing:
        return _project_summary(existing)

    project = Project(
        repo_url=clone_url,
        slug=repos.slug_for(owner, repo),
        name=f"{owner}/{repo}",
        clone_status="cloning",
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    background.add_task(_clone_project, project.id, clone_url, project.slug)
    return _project_summary(project)


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project(
    project_id: int, db: Session = Depends(get_session)
) -> ProjectDetail:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    for a in project.assertions:
        if a.latest_run:
            verification.sync_run(db, a.latest_run)
        if a.latest_remediation:
            verification.sync_remediation(db, a.latest_remediation)
    db.refresh(project)
    # Default order: unsettled first, then by priority, then newest. The
    # client can re-sort, but the first paint should already be useful.
    ordered = sorted(
        project.assertions,
        key=lambda a: (
            a.status_rank,
            _PRIORITY_RANK.get(a.priority, 1),
            -a.id,
        ),
    )
    return ProjectDetail(
        **_project_summary(project).model_dump(),
        assertions=[_assertion_out(a) for a in ordered],
    )


@router.post("/projects/{project_id}/refresh", response_model=ProjectSummary)
def refresh_project(
    project_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
) -> ProjectSummary:
    """Re-fetch the checkout so new assertions run against current HEAD."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    project.clone_status = "cloning"
    db.commit()
    background.add_task(
        _clone_project, project.id, project.repo_url, project.slug
    )
    db.refresh(project)
    return _project_summary(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project_id: int, db: Session = Depends(get_session)
) -> Response:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    db.delete(project)
    db.commit()
    return Response(status_code=204)


# ─── Assertions ───────────────────────────────────────────────────────────


@router.post(
    "/projects/{project_id}/assertions",
    response_model=AssertionOut,
    status_code=201,
)
def create_assertion(
    project_id: int,
    payload: AssertionCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
) -> AssertionOut:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    if project.clone_status != "ready":
        raise HTTPException(409, f"Project checkout is {project.clone_status}")
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Assertion cannot be empty")

    a = Assertion(project_id=project.id, raw_text=text, text=text)
    if payload.priority:
        a.priority = payload.priority
    db.add(a)
    db.commit()
    db.refresh(a)

    background.add_task(_tidy_and_verify, a.id)
    return _assertion_out(a)


@router.get("/assertions/{assertion_id}", response_model=AssertionOut)
def get_assertion(
    assertion_id: int, db: Session = Depends(get_session)
) -> AssertionOut:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    if a.latest_run:
        verification.sync_run(db, a.latest_run)
    db.refresh(a)
    return _assertion_out(a)


@router.get("/assertions/{assertion_id}/runs", response_model=list[RunOut])
def list_runs(
    assertion_id: int, db: Session = Depends(get_session)
) -> list[RunOut]:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    return [RunOut.model_validate(r) for r in a.runs]


@router.patch("/assertions/{assertion_id}", response_model=AssertionOut)
def update_assertion(
    assertion_id: int,
    payload: AssertionUpdate,
    db: Session = Depends(get_session),
) -> AssertionOut:
    """Edit an assertion in place.

    The user's wording is taken verbatim — no tidy pass, since they are
    deliberately choosing these words. Changing the text invalidates the
    existing verdict, so it triggers a fresh run; metadata-only edits
    (priority, category, title) do not.
    """
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")

    text_changed = False
    if payload.text is not None:
        text = payload.text.strip()
        if not text:
            raise HTTPException(400, "Assertion cannot be empty")
        text_changed = text != a.text
        a.text = text
    for field in ("title", "emoji", "category", "priority"):
        value = getattr(payload, field)
        if value is not None:
            setattr(a, field, value.strip() if isinstance(value, str) else value)
    db.commit()

    if text_changed:
        if a.project.clone_status != "ready":
            raise HTTPException(409, f"Project checkout is {a.project.clone_status}")
        verification.start_run(db, a)
    db.refresh(a)
    return _assertion_out(a)


@router.post("/assertions/{assertion_id}/verify", response_model=AssertionOut)
def reverify(
    assertion_id: int, db: Session = Depends(get_session)
) -> AssertionOut:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    if a.latest_run and a.latest_run.status == "investigating":
        raise HTTPException(409, "A verification run is already in flight")
    verification.start_run(db, a)
    db.refresh(a)
    return _assertion_out(a)


@router.delete("/assertions/{assertion_id}", status_code=204)
def delete_assertion(
    assertion_id: int, db: Session = Depends(get_session)
) -> Response:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    # Drop any remediation worktrees before the rows cascade away.
    for rem in a.remediations:
        if rem.branch:
            repos.remove_worktree(a.project.slug, rem.branch)
    db.delete(a)
    db.commit()
    return Response(status_code=204)


# ─── Remediation ──────────────────────────────────────────────────────────


@router.post(
    "/assertions/{assertion_id}/remediate",
    response_model=RemediationOut,
    status_code=201,
)
def remediate(
    assertion_id: int,
    payload: RemediateRequest | None = None,
    db: Session = Depends(get_session),
) -> RemediationOut:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    if a.latest_remediation and a.latest_remediation.status == "working":
        raise HTTPException(409, "A remediation is already in flight")

    fix = None
    if payload and payload.fix_id is not None:
        fix = db.get(ProposedFix, payload.fix_id)
        if fix is None:
            raise HTTPException(404, "Fix not found")
    try:
        rem = verification.start_remediation(db, a, fix)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return RemediationOut.model_validate(rem)


@router.get(
    "/assertions/{assertion_id}/remediations",
    response_model=list[RemediationOut],
)
def list_remediations(
    assertion_id: int, db: Session = Depends(get_session)
) -> list[RemediationOut]:
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    if a.latest_remediation:
        verification.sync_remediation(db, a.latest_remediation)
        db.refresh(a)
    return [RemediationOut.model_validate(r) for r in a.remediations]


@router.delete("/remediations/{remediation_id}", status_code=204)
def discard_remediation(
    remediation_id: int, db: Session = Depends(get_session)
) -> Response:
    rem = db.get(Remediation, remediation_id)
    if rem is None:
        raise HTTPException(404, "Remediation not found")
    if rem.branch:
        repos.remove_worktree(rem.assertion.project.slug, rem.branch)
    db.delete(rem)
    db.commit()
    return Response(status_code=204)
