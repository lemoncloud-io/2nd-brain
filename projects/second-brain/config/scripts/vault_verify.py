#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@2156ca2a:projects/second-brain/config/scripts/vault_verify.py
"""Verify the vault invariants shared by every write lane (ingest, lint, promote).

This is the single post-run check. Skills call it instead of restating the same
assertions in prose:

    python3 projects/second-brain/config/scripts/vault_verify.py --lane ingest \
        --base "$(git merge-base HEAD master)"

Checks (all lanes):
  1. wiki/VAULT_MEMORY.md is under 8 KB (8192 bytes on disk, not decoded length).
  2. No `- Last <Name>:` marker in memory appears more than once (never appended).
  3. Every `- Last <Name>:` line is at most 200 bytes.
     (2 and 3 are now guards only: since 2026-09-03 memory stores no per-run markers —
     `Last Ingest/Lint Pass/Promotion` and `Volume to date` conflicted on every concurrent
     ingest and are derived from outputs/runs/ and vault_volume.py instead.)
  4. raw/ and archive/ are append-only: no modify/delete/rename against the base ref.
  5. If memory still carries a `- Volume to date:` line it must match the ledger fold
     (vault_volume.py); an absent line is fine.
  6. Every tracked Markdown file outside raw/ and archive/ has parseable frontmatter.
     Added 2026-08-28 after a merge conflict resolved by keeping both sides put a
     duplicated key and orphaned sequence items into a project README: the text diff
     looked clean, and the whole block silently stopped parsing for Obsidian and for
     every skill that reads frontmatter. The structural pass (scan_frontmatter) is
     dependency-free so it runs everywhere; when PyYAML is importable a full parse
     runs on top of it, catching what the conservative structural pass lets through.
  7. Every `next_action` is one action per string — a quoted scalar or a block sequence
     with each item at most 300 bytes and no `;` joining clauses. Added 2026-09-15 after
     one project README's value reached 2,091 bytes of `;`-joined clauses; contract in
     `docs/project-next-action.md`.

Lane check: `--lane ingest|lint|promote` additionally requires the lane's trace in the
diff against the base ref — a run-log under outputs/runs/ with the matching `kind:`
(ingest, promotion) or a lint report `outputs/*-vault-lint*.md` — so a lane cannot report
success without leaving its record. (Replaced the memory-marker requirement 2026-09-03.)
Omit --lane (or use `--lane none`) for a standalone health check.

Base ref: `--base` defaults to HEAD, which only covers an uncommitted working tree.
Lanes that commit before verifying (ingest commits and opens a PR inside the job)
would see an empty diff and pass vacuously, so every lane call site passes
`--base "$(git merge-base HEAD master)"`. That expression is also correct for a lane
that has not committed yet — on master it resolves to HEAD.

Exit codes: 0 pass, 1 one or more defects, 2 cannot run (vault unresolved, bad usage).
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

import vault_volume

try:  # optional: absent on the Homebrew python3 that usually runs the lanes
    import yaml

    HAVE_YAML = True
except ImportError:  # pragma: no cover - depends on the interpreter, both paths tested
    HAVE_YAML = False

MEMORY_REL = "wiki/VAULT_MEMORY.md"
MEMORY_MAX_BYTES = 8192
MARKER_MAX_BYTES = 200
APPEND_ONLY_DIRS = ["raw", "archive"]

# Lane → how the run must show up in the diff against --base (path prefix, frontmatter kind
# or None for a filename match on "-vault-lint").
LANE_TRACE = {
    "ingest": ("outputs/runs/", "ingest"),
    "promote": ("outputs/runs/", "promotion"),
    "lint": ("outputs/", None),
}

EXPECTED_DIRS = ["wiki", "raw", "Clippings", "templates"]
MARKER_RE = re.compile(r"^- (Last [^:]+):")

# Frontmatter structural check. Deliberately dependency-free: PyYAML is absent on
# machines that run these lanes, and a check that silently skips itself is worse than
# no check. It is conservative by design — it reports only shapes that cannot be valid
# YAML, never style. A full parse runs on top when PyYAML happens to be importable.
FM_FENCE = "---"
FM_KEY_RE = re.compile(r"^(\s*)(?![\s#-])([^:]+?):(?:\s+(.*))?\s*$")
FM_SEQ_RE = re.compile(r"^(\s*)-(?:\s+(.*))?\s*$")
FM_BLOCK_RE = re.compile(r"^[|>][+\-]?\d*$")
FRONTMATTER_SKIP_DIRS = ("raw/", "archive/")


def resolve_vault() -> Path | None:
    """Same contract as vault_ingest_once.py: VAULT_DIR, else cwd, else give up."""
    candidate = Path(os.environ.get("VAULT_DIR") or os.getcwd()).expanduser().resolve()
    if not (candidate / "VAULT_RULES.md").exists():
        return None
    if not all((candidate / d).is_dir() for d in EXPECTED_DIRS):
        return None
    return candidate


def check_memory(vault: Path, lane: str, defects: list[str]) -> None:
    memory = vault / MEMORY_REL
    if not memory.is_file():
        defects.append(f"{MEMORY_REL} is missing")
        return

    size = memory.stat().st_size
    if size >= MEMORY_MAX_BYTES:
        defects.append(f"{MEMORY_REL} is {size} bytes (must stay under {MEMORY_MAX_BYTES})")

    counts: dict[str, int] = {}
    for lineno, raw_line in enumerate(memory.read_text(encoding="utf-8").splitlines(), 1):
        match = MARKER_RE.match(raw_line)
        if not match:
            continue
        name = match.group(1)
        counts[name] = counts.get(name, 0) + 1
        line_bytes = len(raw_line.encode("utf-8"))
        if line_bytes > MARKER_MAX_BYTES:
            defects.append(
                f"{MEMORY_REL}:{lineno} `- {name}:` line is {line_bytes} bytes "
                f"(max {MARKER_MAX_BYTES}); detail belongs in the run-log note"
            )

    for name, count in sorted(counts.items()):
        if count > 1:
            defects.append(
                f"{MEMORY_REL} has {count} `- {name}:` lines; the line is replaced, never appended"
            )



def _changed_paths(vault: Path, base: str) -> list[str] | None:
    """Added/modified paths vs base, plus untracked files (a lane may verify pre-commit)."""
    try:
        diff = subprocess.run(["git", "diff", "--name-status", base, "--", "outputs"],
                              cwd=vault, capture_output=True, text=True, timeout=60)
        untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "--", "outputs"],
                                   cwd=vault, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if diff.returncode != 0 or untracked.returncode != 0:
        return None
    paths = []
    for line in diff.stdout.splitlines():
        status, _, rest = line.partition("\t")
        if status[:1] in ("A", "M", "R"):
            paths.append(rest.split("\t")[-1])
    paths += [p for p in untracked.stdout.splitlines() if p.strip()]
    return paths


def check_lane_trace(vault: Path, base: str, lane: str, defects: list[str]) -> None:
    """A lane run must leave its record: run-log (ingest/promote) or lint report."""
    if lane == "none":
        return
    prefix, kind = LANE_TRACE[lane]
    paths = _changed_paths(vault, base)
    if paths is None:
        defects.append(f"lane trace check could not run for {lane} (git diff against {base} failed)")
        return
    for rel in paths:
        if not (rel.startswith(prefix) and rel.endswith(".md")):
            continue
        if kind is None:
            if "-vault-lint" in Path(rel).name and rel.count("/") == 1:
                return
            continue
        try:
            head = (vault / rel).read_text(encoding="utf-8")[:2000]
        except (OSError, UnicodeDecodeError):
            continue
        if re.search(rf"^kind:\s*{kind}\s*$", head, re.M):
            return
    what = "lint report outputs/*-vault-lint*.md" if kind is None else f"outputs/runs/ run-log with `kind: {kind}`"
    defects.append(f"no {what} added or modified against {base} after a {lane} run")


def _closes_quote(value: str) -> bool:
    """True when a quoted scalar opens and closes on the same line (or is unquoted)."""
    if not value or value[0] not in "\"'":
        return True
    quote = value[0]
    rest = value[1:]
    if quote == "'":
        return rest.rstrip().endswith("'")
    index = 0
    while index < len(rest):
        if rest[index] == "\\":
            index += 2
            continue
        if rest[index] == '"':
            return True
        index += 1
    return False


def scan_frontmatter(text: str, rel_path: str, use_parser: bool = True) -> list[str]:
    """Report frontmatter shapes that no YAML parser can accept.

    Catches the failure class that reached master on 2026-08-28: a merge conflict
    resolved by keeping both sides left sequence items indented under a scalar value
    plus a duplicated key, which renders the whole block unparseable while the text
    diff still looks clean.
    """
    if not text.startswith(FM_FENCE + "\n"):
        return []

    lines = text.split("\n")
    end = None
    for index in range(1, len(lines)):
        if lines[index].rstrip() in (FM_FENCE, "..."):
            end = index
            break
    if end is None:
        return [f"{rel_path}: unterminated frontmatter (no closing `---`)"]

    defects: list[str] = []
    scopes: list[tuple[int, set[str]]] = []  # (indent, keys seen at that indent)
    last_key: tuple[int, str] | None = None  # (indent, key) whose value is a closed scalar
    block_indent: int | None = None
    open_quote: str | None = None

    for offset in range(1, end):
        line = lines[offset]
        lineno = offset + 1

        if open_quote is not None:
            if open_quote in line:
                open_quote = None
            continue

        if not line.strip():
            continue

        indent = len(line) - len(line.lstrip(" \t"))
        if "\t" in line[:indent]:
            defects.append(f"{rel_path}:{lineno} tab used for indentation (YAML forbids tabs)")
            continue

        if block_indent is not None:
            if indent > block_indent:
                continue
            block_indent = None

        if line.lstrip().startswith("#"):
            continue

        seq = FM_SEQ_RE.match(line)
        if seq:
            if last_key is not None and indent > last_key[0]:
                defects.append(
                    f"{rel_path}:{lineno} sequence item is indented under `{last_key[1]}:`, "
                    "which already has a scalar value — a merge conflict resolved by keeping "
                    "both sides leaves exactly this shape"
                )
            while scopes and scopes[-1][0] > indent:
                scopes.pop()
            # each item opens its own mapping scope, so `- name:` may repeat across items
            scopes.append((indent + 1, set()))
            last_key = None
            inline = (seq.group(2) or "").strip()
            if inline.endswith(":"):
                scopes[-1][1].add(inline[:-1].strip())
            continue

        key_match = FM_KEY_RE.match(line)
        if not key_match:
            continue  # wrapped plain scalar, block body, or anything else we do not judge

        key = key_match.group(2).strip()
        value = (key_match.group(3) or "").strip()

        while scopes and scopes[-1][0] > indent:
            scopes.pop()
        if not scopes or scopes[-1][0] < indent:
            scopes.append((indent, set()))
        if key in scopes[-1][1]:
            defects.append(
                f"{rel_path}:{lineno} duplicate key `{key}` at the same level — "
                "the later value silently wins, or the block fails to parse"
            )
        scopes[-1][1].add(key)

        if FM_BLOCK_RE.match(value):
            block_indent = indent
            last_key = None
        elif not value:
            last_key = None
        elif not _closes_quote(value):
            open_quote = value[0]
            last_key = None
        else:
            last_key = (indent, key)

    if defects or not (use_parser and HAVE_YAML):
        # Structural messages name the offending line and the likely cause, so they beat
        # a parser dump. Only fall through to the parser when structure looked fine.
        return defects

    block = "\n".join(lines[1:end])
    try:
        parsed = yaml.safe_load(block)
    except yaml.YAMLError as exc:
        detail = str(exc).replace("\n", " ").strip()
        return [f"{rel_path}: frontmatter is not valid YAML — {detail}"]
    if parsed is not None and not isinstance(parsed, dict):
        return [f"{rel_path}: frontmatter must be a mapping, got {type(parsed).__name__}"]
    return []


NEXT_ACTION_MAX_BYTES = 300
NA_KEY_RE = re.compile(r"^next_action:(?:[ \t]+(.*?))?[ \t]*$")
NA_ITEM_RE = re.compile(r"^[ \t]+-[ \t]+(.*?)[ \t]*$")
NA_DOC = "docs/project-next-action.md"


def _na_unquote(value: str) -> str:
    """Strip one layer of matching quotes so the cap measures the text, not the syntax."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _na_item_defects(rel_path: str, lineno: int, where: str, text: str) -> list[str]:
    defects: list[str] = []
    size = len(text.encode("utf-8"))
    if size > NEXT_ACTION_MAX_BYTES:
        defects.append(
            f"{rel_path}:{lineno} next_action {where} is {size} bytes "
            f"(max {NEXT_ACTION_MAX_BYTES}) — one action per item, detail in the body ({NA_DOC})"
        )
    if ";" in text:
        defects.append(
            f"{rel_path}:{lineno} next_action {where} uses ';' to join clauses — "
            f"each clause is its own sequence item ({NA_DOC})"
        )
    return defects


def scan_next_action(text: str, rel_path: str) -> list[str]:
    """Report `next_action` values that hold more than one action in one string.

    The field is either a quoted scalar (exactly one action) or a block sequence with one
    action per item; `docs/project-next-action.md` is the contract. Both shapes have always
    parsed — what this catches is the shape that parses and still cannot be read or edited:
    the clause pile that reached 2,091 bytes in projects/cloud-voucher/README.md and that
    the 2026-08-28 merge break happened to land on.

    Dependency-free on purpose, like scan_frontmatter — the lanes run where PyYAML is absent.
    """
    if not text.startswith(FM_FENCE + "\n"):
        return []

    lines = text.split("\n")
    end = None
    for index in range(1, len(lines)):
        if lines[index].rstrip() in (FM_FENCE, "..."):
            end = index
            break
    if end is None:
        return []  # scan_frontmatter owns this defect

    key_at = None
    for offset in range(1, end):
        match = NA_KEY_RE.match(lines[offset])
        if match:
            key_at = offset
            break
    if key_at is None:
        return []

    value = (NA_KEY_RE.match(lines[key_at]).group(1) or "").strip()
    lineno = key_at + 1

    if value:
        if value.startswith("["):
            if value.replace(" ", "") == "[]":
                return []  # empty, same as ""
            return [
                f"{rel_path}:{lineno} next_action must be a quoted scalar or a block sequence, "
                f"not an inline flow sequence — one item per line ({NA_DOC})"
            ]
        if FM_BLOCK_RE.match(value):
            return [
                f"{rel_path}:{lineno} next_action must be a quoted scalar or a block sequence, "
                f"not a block scalar — a value with line breaks is unreadable in the base "
                f"table cell ({NA_DOC})"
            ]
        return _na_item_defects(rel_path, lineno, "scalar", _na_unquote(value))

    defects: list[str] = []
    item_no = 0
    for offset in range(key_at + 1, end):
        line = lines[offset]
        if not line.strip():
            continue
        item = NA_ITEM_RE.match(line)
        if not item:
            break  # a column-0 key ends the sequence; anything else we do not judge
        item_no += 1
        defects.extend(
            _na_item_defects(rel_path, offset + 1, f"item {item_no}", _na_unquote(item.group(1)))
        )
    return defects


def check_frontmatter(vault: Path, defects: list[str]) -> None:
    """Run the structural check over every tracked Markdown file outside raw/ and archive/."""
    try:
        proc = subprocess.run(
            ["git", "ls-files", "-z", "*.md"],
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        defects.append(f"frontmatter check could not run: {exc}")
        return
    if proc.returncode != 0:
        stderr_head = proc.stderr.strip().splitlines()[0] if proc.stderr.strip() else "git ls-files failed"
        defects.append(f"frontmatter check could not run: {stderr_head}")
        return

    for rel in proc.stdout.split("\0"):
        if not rel or rel.startswith(FRONTMATTER_SKIP_DIRS):
            continue
        path = vault / rel
        if not path.is_file():
            continue  # staged deletion
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            defects.append(f"{rel}: could not read for the frontmatter check ({exc})")
            continue
        structural = scan_frontmatter(text, rel)
        defects.extend(structural)
        if not structural:
            # an unparseable block makes the next_action reading meaningless
            defects.extend(scan_next_action(text, rel))


def check_append_only(vault: Path, base: str, defects: list[str]) -> None:
    existing = [d for d in APPEND_ONLY_DIRS if (vault / d).exists()]
    if not existing:
        return
    try:
        proc = subprocess.run(
            ["git", "diff", "--name-status", base, "--"] + existing,
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        defects.append(f"append-only check could not run: {exc}")
        return
    if proc.returncode != 0:
        # First stderr line only: git's full usage dump would flood the defect list
        # and push the real defects past the caller's tail truncation.
        stderr_head = proc.stderr.strip().splitlines()[0] if proc.stderr.strip() else "git diff failed"
        defects.append(f"append-only check could not run: {stderr_head}")
        return

    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        status, _, rest = line.partition("\t")
        if status.startswith("A"):
            continue  # new snapshots are the only legal change
        defects.append(f"append-only violation ({status}): {rest.replace(chr(9), ' -> ')}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify shared vault invariants.")
    parser.add_argument(
        "--lane",
        choices=list(LANE_TRACE) + ["none"],
        default="none",
        help="lane that just ran; requires its run-log/report in the diff against --base",
    )
    parser.add_argument(
        "--base",
        default="HEAD",
        help='git ref the append-only check diffs against; lanes that commit before '
        'verifying must pass "$(git merge-base HEAD master)" (default: HEAD)',
    )
    args = parser.parse_args()
    base = args.base.strip() or "HEAD"

    vault = resolve_vault()
    if vault is None:
        print(
            "vault_verify: cannot resolve the vault root. Set VAULT_DIR or run from a "
            "directory holding VAULT_RULES.md plus " + ", ".join(EXPECTED_DIRS) + "/.",
            file=sys.stderr,
        )
        return 2

    defects: list[str] = []
    check_memory(vault, args.lane, defects)
    check_lane_trace(vault, base, args.lane, defects)
    check_append_only(vault, base, defects)
    check_frontmatter(vault, defects)
    defects.extend(vault_volume.check(vault))

    lane_label = args.lane if args.lane != "none" else "shared"
    if defects:
        print(f"FAIL ({lane_label}, base {base}): {len(defects)} defect(s)")
        for defect in defects:
            print(f"  - {defect}")
        return 1

    print(
        f"PASS ({lane_label}, base {base}): memory size, memory markers, lane trace, "
        "raw/archive append-only, frontmatter structure, next_action shape, volume fold"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
