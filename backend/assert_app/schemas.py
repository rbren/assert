from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from .models import CATEGORIES, PRIORITIES


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
    # status → how many of this project's claims are standing there.
    standing: dict[str, int] = {}


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


class ProposedFixOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    position: int
    title: str
    plan: str
    effort: str
    confidence: int | None
    notes: str


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    verdict: str | None
    summary: str
    caveats: str
    commit_sha: str | None
    conversation_id: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    evidence: list[EvidenceOut] = []
    fixes: list[ProposedFixOut] = []
    # How many commits have landed on the default branch since this run.
    commits_behind: int | None = None


class RemediationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assertion_id: int
    run_id: int | None
    fix_id: int | None
    status: str
    summary: str
    diff: str
    branch: str | None
    base_commit: str | None
    conversation_id: str | None
    pr_url: str | None
    pr_number: int | None
    pr_error: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class AssertionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    raw_text: str
    text: str
    title: str
    emoji: str
    category: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    latest_run: RunOut | None = None
    latest_remediation: RemediationOut | None = None


class AssertionCreate(BaseModel):
    text: str
    priority: str | None = None

    @field_validator("priority")
    @classmethod
    def _known_priority(cls, v: str | None) -> str | None:
        if v is not None and v not in PRIORITIES:
            raise ValueError(f"priority must be one of {sorted(PRIORITIES)}")
        return v


class AssertionUpdate(BaseModel):
    """Partial update. Omitted fields are left alone.

    Editing ``text`` skips the tidy pass — the user's wording is taken as-is.
    """

    text: str | None = None
    title: str | None = None
    emoji: str | None = None
    category: str | None = None
    priority: str | None = None

    @field_validator("category")
    @classmethod
    def _known_category(cls, v: str | None) -> str | None:
        if v is not None and v not in CATEGORIES:
            raise ValueError(f"category must be one of {sorted(CATEGORIES)}")
        return v

    @field_validator("priority")
    @classmethod
    def _known_priority(cls, v: str | None) -> str | None:
        if v is not None and v not in PRIORITIES:
            raise ValueError(f"priority must be one of {sorted(PRIORITIES)}")
        return v


class RemediateRequest(BaseModel):
    """Which proposed fix to attempt. Omit to take the run's top-rated one."""

    fix_id: int | None = None


class ProjectDetail(ProjectSummary):
    assertions: list[AssertionOut] = []
