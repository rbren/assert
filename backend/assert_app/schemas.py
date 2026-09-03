from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    repo_url: str


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_url: str
    slug: str
    name: str
    default_branch: str
    head_commit: str | None
    clone_status: str
    clone_error: str | None
    created_at: datetime
    assertion_count: int = 0


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    caption: str
    command: str | None
    exit_code: int | None
    stdout: str | None
    stderr: str | None
    path: str | None
    start_line: int | None
    end_line: int | None
    content: str | None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    verdict: str | None
    summary: str
    suggested_text: str
    caveats: str
    commit_sha: str | None
    conversation_id: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    evidence: list[EvidenceOut] = []


class AssertionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    raw_text: str
    text: str
    created_at: datetime
    updated_at: datetime
    latest_run: RunOut | None = None


class AssertionCreate(BaseModel):
    text: str


class AssertionUpdate(BaseModel):
    text: str


class ProjectDetail(ProjectSummary):
    assertions: list[AssertionOut] = []
