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


CATEGORIES: set[str] = {
    "docs",
    "tests",
    "quality",
    "code health",
    "security",
    "logic",
    "api",
}
DEFAULT_CATEGORY = "quality"

PRIORITIES: set[str] = {"high", "medium", "low"}
DEFAULT_PRIORITY = "medium"


class Assertion(Base):
    """A claim about the codebase, plus its most recent verification run."""

    __tablename__ = "assertions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Exactly what the user typed.
    raw_text: Mapped[str] = mapped_column(Text, default="")
    # LLM-tidied version of raw_text — same meaning, cleaner prose. Markdown.
    text: Mapped[str] = mapped_column(Text, default="")
    # Two-word label plus a single emoji, for scanning the list.
    title: Mapped[str] = mapped_column(String(80), default="")
    emoji: Mapped[str] = mapped_column(String(16), default="")
    category: Mapped[str] = mapped_column(String(20), default=DEFAULT_CATEGORY)
    # User-controlled; the LLM never sets this.
    priority: Mapped[str] = mapped_column(String(10), default=DEFAULT_PRIORITY)
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
    remediations: Mapped[list["Remediation"]] = relationship(
        "Remediation",
        back_populates="assertion",
        cascade="all, delete-orphan",
        order_by="Remediation.created_at.desc()",
    )

    @property
    def latest_run(self) -> "Run | None":
        return self.runs[0] if self.runs else None

    @property
    def latest_remediation(self) -> "Remediation | None":
        return self.remediations[0] if self.remediations else None

    @property
    def status(self) -> str:
        """Where the claim stands: its verdict, or the state of getting one."""
        run = self.latest_run
        if run is None:
            return "queued"
        if run.status in {"tidying", "investigating"}:
            return "checking"
        if run.status == "error":
            return "error"
        return run.verdict or "uncertain"

    @property
    def status_rank(self) -> int:
        """Sort key: things needing attention first, settled truths last."""
        return STATUS_ORDER.index(self.status) if self.status in STATUS_ORDER else 99


# Worst-first: refuted claims outrank claims that hold, and work still in
# flight outranks everything, since it is about to change the picture.
STATUS_ORDER: list[str] = [
    "checking",
    "queued",
    "error",
    "false",
    "mostly_false",
    "partly_true",
    "uncertain",
    "unverifiable",
    "true",
]


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
    # Why the evidence below supports the verdict. Markdown.
    summary: Mapped[str] = mapped_column(Text, default="")
    # Exceptions, ambiguities, and scope limits. Markdown.
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
    fixes: Mapped[list["ProposedFix"]] = relationship(
        "ProposedFix",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProposedFix.position",
    )


EFFORTS: set[str] = {"easy", "medium", "hard"}


class ProposedFix(Base):
    """One candidate way to make the assertion true.

    A run proposes up to five, split so the user can pick by cost and odds —
    a quick partial fix versus a thorough risky one.
    """

    __tablename__ = "proposed_fixes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Short imperative label, e.g. "Add return types to the API layer".
    title: Mapped[str] = mapped_column(String(200), default="")
    # The work order handed to a remediation agent. Markdown.
    plan: Mapped[str] = mapped_column(Text, default="")
    # "easy" | "medium" | "hard"
    effort: Mapped[str] = mapped_column(String(10), default="medium")
    # 0-100: the agent's confidence this fix actually lands.
    confidence: Mapped[int | None] = mapped_column(Integer, default=None)
    # What this fix does and does not achieve. Markdown.
    notes: Mapped[str] = mapped_column(Text, default="")

    run: Mapped[Run] = relationship("Run", back_populates="fixes")


class Remediation(Base):
    """An agent attempt to change the codebase so the assertion becomes true."""

    __tablename__ = "remediations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assertion_id: Mapped[int] = mapped_column(
        ForeignKey("assertions.id", ondelete="CASCADE"), index=True
    )
    # The run whose fix list this came from.
    run_id: Mapped[int | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), default=None
    )
    # The specific fix being attempted.
    fix_id: Mapped[int | None] = mapped_column(
        ForeignKey("proposed_fixes.id", ondelete="SET NULL"), default=None
    )
    # "working" | "done" | "error"
    status: Mapped[str] = mapped_column(String(20), default="working")
    # The agent's account of what it changed. Markdown.
    summary: Mapped[str] = mapped_column(Text, default="")
    # Unified diff of the work, so it can be reviewed without leaving the app.
    diff: Mapped[str] = mapped_column(Text, default="")
    # Scratch branch in the checkout holding the changes.
    branch: Mapped[str | None] = mapped_column(String(200), default=None)
    base_commit: Mapped[str | None] = mapped_column(String(64), default=None)
    conversation_id: Mapped[str | None] = mapped_column(String(64), default=None)
    # The pull request opened from `branch`, once the work is pushed.
    pr_url: Mapped[str | None] = mapped_column(String(500), default=None)
    pr_number: Mapped[int | None] = mapped_column(Integer, default=None)
    # Why no PR exists, when the change itself succeeded (no push rights,
    # nothing to commit, …). Distinct from `error`, which fails the attempt.
    pr_error: Mapped[str | None] = mapped_column(Text, default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    assertion: Mapped[Assertion] = relationship(
        "Assertion", back_populates="remediations"
    )
    fix: Mapped["ProposedFix | None"] = relationship("ProposedFix")


STANCES: set[str] = {"for", "against"}


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
    # Which side of the argument this artifact lands on: "for" | "against".
    # Empty on runs ingested before the agent was asked to take a side.
    stance: Mapped[str] = mapped_column(String(10), default="")

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
