"""Bring an existing assert.db up to the current schema.

SQLite can add columns but not drop or rename them, and the app has live data,
so schema changes are applied as idempotent ALTERs rather than a rebuild.
Run from the backend directory: `.venv/bin/python migrate.py`.
"""
from __future__ import annotations

import sqlite3

from assert_app.config import DB_PATH

ADD_COLUMNS = [
    ("assertions", "title", "TEXT NOT NULL DEFAULT ''"),
    ("assertions", "emoji", "TEXT NOT NULL DEFAULT ''"),
    ("assertions", "category", "TEXT NOT NULL DEFAULT 'quality'"),
    ("assertions", "priority", "TEXT NOT NULL DEFAULT 'medium'"),
    ("evidence", "stance", "VARCHAR(10) NOT NULL DEFAULT ''"),
    ("remediations", "fix_id", "INTEGER REFERENCES proposed_fixes(id)"),
    ("remediations", "pr_url", "VARCHAR(500)"),
    ("remediations", "pr_number", "INTEGER"),
    ("remediations", "pr_error", "TEXT"),
]

CREATE_PROPOSED_FIXES = """
CREATE TABLE IF NOT EXISTS proposed_fixes (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    title VARCHAR(200) NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT '',
    effort VARCHAR(10) NOT NULL DEFAULT 'medium',
    confidence INTEGER,
    notes TEXT NOT NULL DEFAULT ''
)
"""

CREATE_REMEDIATIONS = """
CREATE TABLE IF NOT EXISTS remediations (
    id INTEGER PRIMARY KEY,
    assertion_id INTEGER NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'working',
    summary TEXT NOT NULL DEFAULT '',
    diff TEXT NOT NULL DEFAULT '',
    branch VARCHAR(200),
    base_commit VARCHAR(64),
    conversation_id VARCHAR(64),
    error TEXT,
    created_at DATETIME NOT NULL,
    finished_at DATETIME
)
"""


def columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")

    # Tables first: ADD_COLUMNS includes a column that references one of them.
    con.execute(CREATE_PROPOSED_FIXES)
    con.execute(
        "CREATE INDEX IF NOT EXISTS ix_proposed_fixes_run_id "
        "ON proposed_fixes (run_id)"
    )
    con.execute(CREATE_REMEDIATIONS)
    con.execute(
        "CREATE INDEX IF NOT EXISTS ix_remediations_assertion_id "
        "ON remediations (assertion_id)"
    )

    for table, column, ddl in ADD_COLUMNS:
        if column not in columns(con, table):
            con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            print(f"added {table}.{column}")

    # A free-text remediation plan on the run was superseded by proposed_fixes.
    if "remediation" in columns(con, "runs"):
        con.execute("ALTER TABLE runs DROP COLUMN remediation")
        print("dropped runs.remediation")
    if "suggested_text" in columns(con, "runs"):
        con.execute("ALTER TABLE runs DROP COLUMN suggested_text")
        print("dropped runs.suggested_text")

    # Older rows were written before the tidy pass returned a title, and
    # before it was told not to prefix the claim with a label.
    con.execute(
        """
        UPDATE assertions
           SET text = TRIM(SUBSTR(text, INSTR(text, ':') + 1))
         WHERE text LIKE 'Rewritten assertion:%'
            OR text LIKE 'Assertion:%'
        """
    )
    con.execute(
        """
        UPDATE assertions
           SET text = TRIM(text, '"')
         WHERE text LIKE '"%"'
        """
    )
    con.commit()

    backfilled = con.execute(
        "SELECT COUNT(*) FROM assertions WHERE title = ''"
    ).fetchone()[0]
    con.close()
    print(f"schema up to date; {backfilled} assertion(s) still need a title")


if __name__ == "__main__":
    main()
