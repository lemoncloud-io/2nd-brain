#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@45f6b0f:projects/second-brain/config/scripts/vault_ingest_once.py
"""Run one Claude-first vault ingest pass.

This script is intentionally thin: it resolves/locks the vault, checks whether Claude Code
is available, runs the delegated ingest job when possible, and emits JSON for Hermes/cron.
If Claude is missing or unauthenticated, it exits 42 so Hermes can run the native fallback
workflow from projects/second-brain/config/skills/vault-ingest.md.

The job spec handed to Claude is not stored here — it is read from the "Claude job spec"
block of projects/second-brain/config/skills/vault-ingest-claude.md, which is the single
source of truth for both the delegated and the interactive lane.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

EXPECTED_DIRS = ["wiki", "raw", "Clippings", "templates"]
EXPECTED_FILES = ["VAULT_RULES.md", "wiki/VAULT_MEMORY.md", "wiki/INDEX.md"]

# Tooling paths, resolved from this file rather than from the vault: the spec and the
# verifier ship with the skills, so a sandbox vault still gets the installed copies.
SCRIPTS_DIR = Path(__file__).resolve().parent
VERIFY_SCRIPT = SCRIPTS_DIR / "vault_verify.py"
JOB_SPEC_FILE = SCRIPTS_DIR.parent / "skills" / "vault-ingest-claude.md"
JOB_SPEC_HEADING = "## Claude job spec"
JOB_SPEC_FENCE = "```text"
VAULT_DIR_PLACEHOLDER = "<resolved absolute vault path>"


class JobSpecError(RuntimeError):
    """The canonical job spec could not be read out of the skill file."""


def emit(payload: dict, code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return code


def resolve_vault() -> Path | None:
    candidate = Path(os.environ.get("VAULT_DIR") or os.getcwd()).expanduser().resolve()
    if not (candidate / "VAULT_RULES.md").exists():
        return None
    if not all((candidate / d).is_dir() for d in EXPECTED_DIRS):
        return None
    return candidate


def find_claude() -> str | None:
    path = shutil.which("claude")
    if path:
        return path
    hermes_node = Path.home() / ".hermes" / "node" / "bin" / "claude"
    if hermes_node.exists() and os.access(hermes_node, os.X_OK):
        return str(hermes_node)
    return None


def run(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: int = 60,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, text=True, encoding="utf-8", capture_output=True, timeout=timeout, check=False, env=env)


def acquire_lock(vault: Path) -> Path | None:
    lock_dir = vault / ".locks"
    lock_dir.mkdir(exist_ok=True)
    lock = lock_dir / "vault-ingest.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps({"pid": os.getpid(), "created": int(time.time())}, ensure_ascii=False))
    return lock


def load_job_spec(vault: Path) -> str:
    """Read the ingest job spec out of the vault-ingest-claude skill.

    This script deliberately carries no copy of its own. It used to, and the two drifted:
    the inline copy still told the doer to append to docs/vault-ingest-log.md months after
    that ledger was frozen, and it knew nothing about the branch/commit/PR workflow.
    A missing heading or fence is reported, never worked around.
    """
    if not JOB_SPEC_FILE.is_file():
        raise JobSpecError(f"job spec source missing: {JOB_SPEC_FILE}")

    lines = JOB_SPEC_FILE.read_text(encoding="utf-8").splitlines()
    try:
        heading = lines.index(JOB_SPEC_HEADING)
    except ValueError:
        raise JobSpecError(f"{JOB_SPEC_FILE}: no {JOB_SPEC_HEADING!r} heading") from None
    try:
        open_fence = lines.index(JOB_SPEC_FENCE, heading)
    except ValueError:
        raise JobSpecError(f"{JOB_SPEC_FILE}: no {JOB_SPEC_FENCE!r} fence after {JOB_SPEC_HEADING!r}") from None
    # Bounded at the next heading: an unclosed fence would otherwise swallow the following
    # sections up to some later fence and ship that prose to the doer as instructions.
    close_fence = None
    for i in range(open_fence + 1, len(lines)):
        if lines[i] == "```":
            close_fence = i
            break
        if lines[i].startswith("## "):
            break
    if close_fence is None:
        raise JobSpecError(f"{JOB_SPEC_FILE}: job spec fence is never closed")

    spec = "\n".join(lines[open_fence + 1:close_fence]).strip()
    if not spec:
        raise JobSpecError(f"{JOB_SPEC_FILE}: job spec block is empty")

    found = spec.count(VAULT_DIR_PLACEHOLDER)
    if found != 1:
        # A placeholder reaching the doer voids the working-directory guard silently.
        raise JobSpecError(
            f"{JOB_SPEC_FILE}: expected exactly 1 {VAULT_DIR_PLACEHOLDER!r} in the job spec, found {found}"
        )
    return spec.replace(VAULT_DIR_PLACEHOLDER, str(vault)) + "\n"


def main() -> int:
    vault = resolve_vault()
    if vault is None:
        return emit({"status": "error", "reason": "vault_root_unclear", "fallback": False}, 2)

    missing = [rel for rel in EXPECTED_FILES if not (vault / rel).exists()]
    if missing:
        return emit({"status": "error", "reason": "missing_required_files", "missing": missing, "fallback": False}, 2)

    clippings = sorted(str(p.relative_to(vault)) for p in (vault / "Clippings").glob("*.md"))
    if not clippings:
        return emit({"status": "no_work", "vault": str(vault), "message": "처리할 클리핑 없음"}, 0)

    lock = acquire_lock(vault)
    if lock is None:
        return emit({"status": "locked", "vault": str(vault), "lock": str(vault / ".locks" / "vault-ingest.lock"), "fallback": False}, 3)

    try:
        claude = find_claude()
        if not claude:
            return emit({"status": "fallback_required", "reason": "claude_missing", "vault": str(vault), "clippings": clippings}, 42)

        version = run([claude, "--version"], cwd=vault, timeout=30)
        if version.returncode != 0:
            return emit({"status": "fallback_required", "reason": "claude_version_failed", "stderr": version.stderr[-2000:], "vault": str(vault), "clippings": clippings}, 42)

        auth = run([claude, "auth", "status", "--text"], cwd=vault, timeout=30)
        if auth.returncode != 0:
            return emit({"status": "fallback_required", "reason": "claude_auth_failed", "stderr": auth.stderr[-2000:], "vault": str(vault), "clippings": clippings}, 42)

        try:
            job = load_job_spec(vault)
        except JobSpecError as exc:
            # An unreadable spec is an install defect, not a vault problem. Degrade to the
            # Hermes-native lane (which needs no spec) and name the reason in the report.
            return emit({
                "status": "fallback_required",
                "reason": "job_spec_unavailable",
                "detail": str(exc),
                "vault": str(vault),
                "clippings": clippings,
            }, 42)

        cmd = [
            claude,
            "-p",
            job,
            "--permission-mode",
            "acceptEdits",
            "--allowedTools",
            "Read,Write,Edit,Bash",
            "--max-turns",
            "20",
            "--output-format",
            "json",
        ]
        result = run(cmd, cwd=vault, timeout=1800)
        if result.returncode != 0:
            return emit({
                "status": "claude_failed_after_start",
                "vault": str(vault),
                "clippings_before": clippings,
                "exit_code": result.returncode,
                "stdout_tail": result.stdout[-4000:],
                "stderr_tail": result.stderr[-4000:],
                "fallback": "manual_review_before_fallback",
            }, result.returncode or 1)

        # The doer commits and opens the PR inside the job, so HEAD already contains the
        # change: the append-only check needs the pre-run merge base or it passes vacuously.
        # On master the merge base is HEAD itself, so the append-only diff would be empty
        # and pass vacuously. That only happens when the doer skipped the branch rule.
        branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=vault, timeout=30)
        if branch.stdout.strip() in ("master", "main"):
            return emit({
                "status": "verify_failed",
                "reason": "not_on_ingest_branch",
                "detail": f"committed on {branch.stdout.strip()}; the job must work on an ingest/<date>-<slug> branch",
                "vault": str(vault),
                "clippings_before": clippings,
                "claude_stdout": result.stdout[-8000:],
            }, 1)

        merge_base = run(["git", "merge-base", "HEAD", "master"], cwd=vault, timeout=30)
        base_ref = merge_base.stdout.strip()
        if merge_base.returncode != 0 or not base_ref:
            return emit({
                "status": "verify_failed",
                "reason": "merge_base_unavailable",
                "detail": merge_base.stderr.strip()[-2000:] or "git merge-base HEAD master returned no ref",
                "vault": str(vault),
                "clippings_before": clippings,
                "claude_stdout": result.stdout[-8000:],
            }, 1)

        verify = run(
            [sys.executable, str(VERIFY_SCRIPT), "--lane", "ingest", "--base", base_ref],
            cwd=vault,
            timeout=120,
            env={**os.environ, "VAULT_DIR": str(vault)},
        )
        if verify.returncode != 0:
            return emit({
                "status": "verify_failed",
                "reason": "vault_verify_defects" if verify.returncode == 1 else "vault_verify_could_not_run",
                "verify_exit_code": verify.returncode,
                "verify_stdout": verify.stdout[-4000:],
                "verify_stderr": verify.stderr[-2000:],
                "vault": str(vault),
                "clippings_before": clippings,
                "claude_stdout": result.stdout[-8000:],
            }, verify.returncode)

        remaining = sorted(str(p.relative_to(vault)) for p in (vault / "Clippings").glob("*.md"))
        raw_files = sorted(str(p.relative_to(vault)) for p in (vault / "raw").glob("*.md"))
        wiki_files = sorted(str(p.relative_to(vault)) for p in (vault / "wiki").rglob("*.md"))
        return emit({
            "status": "claude_success",
            "vault": str(vault),
            "clippings_before": clippings,
            "clippings_remaining": remaining,
            "raw_files": raw_files,
            "wiki_files": wiki_files,
            "verify": verify.stdout.strip(),
            "claude_stdout": result.stdout[-8000:],
        }, 0)
    finally:
        try:
            lock.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
