from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import repos, verification
from .db import get_session, session_scope
from .models import Assertion, Project
from .schemas import (
    AssertionCreate,
    AssertionOut,
    AssertionUpdate,
    ProjectCreate,
    ProjectDetail,
    ProjectSummary,
    RunOut,
)

log = logging.getLogger(__name__)
router = APIRouter()


# ─── Serialization ────────────────────────────────────────────────────────


def _run_out(run) -> RunOut | None:  # noqa: ANN001
    return RunOut.model_validate(run) if run else None


def _assertion_out(a: Assertion) -> AssertionOut:
    return AssertionOut(
        id=a.id,
        project_id=a.project_id,
        raw_text=a.raw_text,
        text=a.text,
        created_at=a.created_at,
        updated_at=a.updated_at,
        latest_run=_run_out(a.latest_run),
    )


def _project_summary(p: Project) -> ProjectSummary:
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
    """Copy-edit the assertion, then dispatch the investigating agent."""
    with session_scope() as db:
        a = db.get(Assertion, assertion_id)
        if a is None:
            return
        a.text = verification.tidy(a.raw_text)
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
    db.refresh(project)
    return ProjectDetail(
        **_project_summary(project).model_dump(),
        assertions=[_assertion_out(a) for a in project.assertions],
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
    background: BackgroundTasks,
    db: Session = Depends(get_session),
) -> AssertionOut:
    """Replace the assertion's wording and re-verify it as written.

    Used by "accept the suggested assertion" — the text is already polished,
    so we skip the tidy pass and go straight to a fresh run.
    """
    a = db.get(Assertion, assertion_id)
    if a is None:
        raise HTTPException(404, "Assertion not found")
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Assertion cannot be empty")
    a.text = text
    db.commit()
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
    db.delete(a)
    db.commit()
    return Response(status_code=204)
