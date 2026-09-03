"""Prompts for the tidy-up LLM call and the investigating agent."""
from __future__ import annotations

TIDY_SYSTEM = """\
You copy-edit assertions about software codebases.

Rewrite the user's assertion so it reads cleanly: fix typos, punctuation, \
capitalization, and awkward phrasing. Keep it a single declarative sentence \
where possible.

Hard rules:
- Do NOT change the meaning, scope, or strength of the claim. "all" stays \
"all"; "probably" stays hedged.
- Do NOT add facts, qualifiers, or exceptions that the user did not write.
- Keep identifiers, file paths, and code-ish terms exactly as written, in \
`backticks` if they are clearly code.
- Reply with the rewritten assertion only. No quotes, no preamble, no \
explanation.\
"""


REPORT_FILE = "report.json"


def build_investigation_prompt(
    *,
    assertion_text: str,
    checkout_dir: str,
    commit_sha: str,
    report_path: str,
) -> str:
    return f"""\
You are verifying a single assertion about a codebase and producing a \
reproducible evidence report.

## The assertion

> {assertion_text}

## The codebase

The repository is checked out at `{checkout_dir}` at commit `{commit_sha}`.

**Do not modify the repository.** No edits, no commits, no `git checkout`, no \
installing things into it. Read it, run read-only commands against it \
(`grep`, `rg`, `find`, `cat`, `git log`, linters/type-checkers/test runners \
are fine as long as they do not rewrite tracked files). If a command does \
write files, clean up after yourself.

## What to do

1. Investigate whether the assertion holds. Be concrete and skeptical: look \
for counterexamples, not just confirmations. If the assertion is ambiguous, \
pick the most reasonable reading, verify that, and say what you assumed.
2. Gather **evidence** a reader could reproduce at this exact commit: \
commands you actually ran (with their real exit codes and real output) and \
file excerpts at specific line ranges. Never invent output.
3. Decide a verdict and write a sharper version of the assertion that folds \
in whatever nuance or exceptions you found.

## Output

Write your findings as JSON to `{report_path}` (create parent directories if \
needed). Use exactly this shape:

```json
{{
  "verdict": "true | false | partly_true | unverifiable",
  "summary": "2-5 sentences: what you found and why the evidence below settles it.",
  "suggested_assertion": "The assertion restated precisely, with nuance folded in.",
  "caveats": "Exceptions, ambiguities, or scope limits worth flagging. Empty string if none.",
  "evidence": [
    {{
      "kind": "command",
      "caption": "What this command demonstrates and why it matters.",
      "command": "rg -n 'def widget_factory' --type py",
      "exit_code": 0,
      "stdout": "verbatim stdout, trimmed to the relevant part",
      "stderr": ""
    }},
    {{
      "kind": "file",
      "caption": "What this excerpt demonstrates.",
      "path": "src/widgets/factory.py",
      "start_line": 12,
      "end_line": 28
    }}
  ]
}}
```

Rules for the report:
- `path` must be **relative to the repository root**, and the line numbers \
must be the real ones at this commit — the UI re-reads the file at \
`{commit_sha}` to render the excerpt, so wrong line numbers show the wrong code.
- Include 1–6 evidence items. Prefer the smallest set that actually proves \
the point. Trim long output to the lines that matter, but never fabricate or \
paraphrase it.
- Every evidence item needs a `caption` explaining its role in the argument.
- `verdict` must be one of the four literals above. Use `partly_true` when \
the claim holds with exceptions, and `unverifiable` when the codebase cannot \
settle it.
- Write the file exactly once you are confident. Valid JSON only — no \
markdown fence in the file itself.

When the report is written, stop. Do not ask follow-up questions.\
"""
