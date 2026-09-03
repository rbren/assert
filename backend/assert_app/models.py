from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Project(Base):
    """A GitHub repository under investigation."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    repo_url: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300), default="")
    default_branch: Mapped[str] = mapped_column(String(200), default="main")
    head_commit: Mapped[str | None] = mapped_column(String(64), default=None)
    # "cloning" → "ready" → "error"
    clone_status: Mapped[str] = mapped_column(String(20), default="cloning")
    clone_error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    assertions: Mapped[list["Assertion"]] = relationship(
        "Assertion",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Assertion.created_at.desc()",
    )


class Assertion(Base):
    """A claim about the codebase, plus its most recent verification run."""

    __tablename__ = "assertions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Exactly what the user typed.
    raw_text: Mapped[str] = mapped_column(Text, default="")
    # LLM-tidied version of raw_text — same meaning, cleaner prose.
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )

    project: Mapped[Project] = relationship("Project", back_populates="assertions")
    runs: Mapped[list["Run"]] = relationship(
        "Run",
        back_populates="assertion",
        cascade="all, delete-orphan",
        order_by="Run.created_at.desc()",
    )

    @property
    def latest_run(self) -> "Run | None":
        return self.runs[0] if self.runs else None


class Run(Base):
    """One agent investigation of an assertion, pinned to a commit."""

    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assertion_id: Mapped[int] = mapped_column(
        ForeignKey("assertions.id", ondelete="CASCADE"), index=True
    )
    # "tidying" | "investigating" | "done" | "error"
    status: Mapped[str] = mapped_column(String(20), default="tidying")
    # "true" | "false" | "partly_true" | "unverifiable" (set when status=done)
    verdict: Mapped[str | None] = mapped_column(String(20), default=None)
    # Why the evidence below supports the verdict.
    summary: Mapped[str] = mapped_column(Text, default="")
    # A sharper restatement of the assertion, with nuance/exceptions folded in.
    suggested_text: Mapped[str] = mapped_column(Text, default="")
    # Caveats/exceptions worth surfacing separately from the restatement.
    caveats: Mapped[str] = mapped_column(Text, default="")
    # The commit the evidence was gathered against — the whole point of a run.
    commit_sha: Mapped[str | None] = mapped_column(String(64), default=None)
    conversation_id: Mapped[str | None] = mapped_column(String(64), default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    assertion: Mapped[Assertion] = relationship("Assertion", back_populates="runs")
    evidence: Mapped[list["Evidence"]] = relationship(
        "Evidence",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="Evidence.position",
    )


class Evidence(Base):
    """A single reproducible artifact backing a run's verdict.

    ``kind="command"`` uses command/exit_code/stdout/stderr; ``kind="file"``
    uses path/start_line/end_line/content. Both carry a ``caption`` saying
    what the artifact demonstrates.
    """

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(20))
    caption: Mapped[str] = mapped_column(Text, default="")

    # kind="command"
    command: Mapped[str | None] = mapped_column(Text, default=None)
    exit_code: Mapped[int | None] = mapped_column(Integer, default=None)
    stdout: Mapped[str | None] = mapped_column(Text, default=None)
    stderr: Mapped[str | None] = mapped_column(Text, default=None)

    # kind="file"
    path: Mapped[str | None] = mapped_column(String(1000), default=None)
    start_line: Mapped[int | None] = mapped_column(Integer, default=None)
    end_line: Mapped[int | None] = mapped_column(Integer, default=None)
    content: Mapped[str | None] = mapped_column(Text, default=None)

    run: Mapped[Run] = relationship("Run", back_populates="evidence")
