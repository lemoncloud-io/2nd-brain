#!/usr/bin/env python3
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
  8. Every `milestones` entry names its checkpoint in at most 300 bytes — the evidence,
     numbers and verdicts belong in the body. Added 2026-09-21 after one project README's
     frontmatter grew to 76% of the file on milestone names up to 4,889 bytes; contract in
     `docs/project-milestones.md`.
  8a. A project `review` gate is `pending` or `confirmed`; while pending it carries
     `review_since` and a one-line `review_gate` (≤ 300 bytes) and the project is not
     `status: done`. Added 2026-10-15 after one project's preparation PR was merged with
     its review still open and the only mark was a quoted paragraph; contract in
     `docs/project-review.md`.
  9. docs/raw-index.yml and docs/raw-index.md are committed by the lint lane only. A change
     set that touches either file must touch nothing under raw/ or Clippings/ — an ingest
     or promote change set always adds raw files, a lint change set never does. Added
     2026-09-29: the generated date and counts at the top of both files collided between
     any two raw-touching PRs, and a long-lived PR re-conflicted every time master moved.
     Only tracked changes count (a lint pass may run beside pending clippings and
     local-only raw files). Contract in `docs/raw-layout.md` § 색인.
 10. A snapshot lane's new files (team-settings.yaml `raw.snapshot_lanes`) go under
     raw/<lane>/ — a change set may not add raw/<lane>-*.md at the raw root. Added
     2026-10-06: a PR merged minutes after the lane rule landed still put six snapshot
     files at the root, where append-only keeps them. Only additions count
     (tracked, renamed in, untracked); root snapshots already on the base stay legal.
     Contract in `docs/raw-layout.md` § 레인 2.
 11. Every required document is reachable from wiki/INDEX.md (vault_orphans.py — its scope and
     exemptions). Added 2026-10-16: the scanner existed for a day (2026-10-15) and five orphans
     still reached master through two PRs because its exit status was always 0 and
     nothing ran it on a PR. Contract in VAULT_RULES § Note Contracts (Reachability).
 12. The change set adds no broken link — a wikilink or relative Markdown link that resolves to no
     document, on the working tree but not on the base ref. Compared as whole-vault sets, so a
     moved file's stale references in untouched documents count too (one PR moved 53 folders
     and rewrote links in 145 files by hand). Links already broken on the base are a lint item
     (`vault_orphans.py --broken` lists them: 246 in 86 documents on 2026-10-16), never a defect
     here — the set may not grow, that is all.

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
import io
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import vault_orphans
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

# Generated raw index: only the lint lane commits it (docs/raw-layout.md § 색인).
RAW_INDEX_FILES = ("docs/raw-index.yml", "docs/raw-index.md")
RAW_INDEX_EXCLUSIVE_DIRS = ("raw/", "Clippings/")

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



def _changed_paths(
    vault: Path,
    base: str,
    pathspecs: tuple[str, ...] = ("outputs",),
    untracked: bool = True,
    deletions: bool = False,
) -> list[str] | None:
    """Added/modified paths vs base, plus untracked files (a lane may verify pre-commit).

    Defaults cover outputs/ with untracked files, which is what the lane trace needs —
    a deleted run-log is not a trace, so deletions are opt-in.
    Paths come back as git prints them — a non-ASCII name is double-quoted with octal
    escapes (core.quotepath), so callers that match on a prefix strip the quote.
    """
    try:
        diff = subprocess.run(["git", "diff", "--name-status", base, "--", *pathspecs],
                              cwd=vault, capture_output=True, text=True, timeout=60)
        others = None
        if untracked:
            others = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "--", *pathspecs],
                                    cwd=vault, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if diff.returncode != 0 or (others is not None and others.returncode != 0):
        return None
    paths = []
    for line in diff.stdout.splitlines():
        status, _, rest = line.partition("\t")
        if status[:1] in ("A", "M", "R") or (deletions and status[:1] == "D"):
            paths.append(rest.split("\t")[-1])
    if others is not None:
        paths += [p for p in others.stdout.splitlines() if p.strip()]
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


def check_raw_index_scope(vault: Path, base: str, defects: list[str]) -> None:
    """docs/raw-index.* may change only in a lint-lane change set (no raw/, no Clippings/).

    Structural, not by branch name: an ingest or promote change set always adds raw files,
    a lint change set never does. Untracked files are left out on purpose — a lint pass may
    run on a machine holding pending clippings or local-only raw files that are not part of
    the change set. Deleting an index file is a change to it like any edit. Runs for every
    lane, like the append-only check.
    """
    paths = _changed_paths(
        vault, base, pathspecs=RAW_INDEX_FILES + RAW_INDEX_EXCLUSIVE_DIRS, untracked=False,
        deletions=True,
    )
    if paths is None:
        defects.append(f"raw index scope check could not run (git diff against {base} failed)")
        return
    plain = [p[1:] if p.startswith('"') else p for p in paths]
    index_changed = [rel for rel in RAW_INDEX_FILES if rel in plain]
    raw_side = [rel for rel in plain if rel.startswith(RAW_INDEX_EXCLUSIVE_DIRS)]
    if not index_changed or not raw_side:
        return
    defects.append(
        f"{' and '.join(index_changed)} changed in the same change set as "
        f"{len(raw_side)} raw/ or Clippings/ path(s) (e.g. {raw_side[0].rstrip(chr(34))}) — "
        "the raw index is committed by the lint lane only and the next lint pass updates it; "
        f"restore the base version: git checkout {base} -- {' '.join(RAW_INDEX_FILES)} "
        "(do not regenerate here — docs/raw-layout.md § 색인)"
    )


def check_snapshot_lane_placement(
    vault: Path, base: str, defects: list[str], lanes: tuple[str, ...] | None = None,
) -> None:
    """A snapshot lane's new files go under raw/<lane>/, never raw/<lane>-*.md at the root.

    `lanes` defaults to team-settings.yaml `raw.snapshot_lanes`, read by the same function
    generate_raw_index.py uses. Only additions count — tracked adds, renames into raw/ and
    untracked files (a promote lane may verify before committing); root snapshots already on
    the base are the legal past and stay (append-only). Runs for every lane.
    """
    if lanes is None:
        try:
            import generate_raw_index  # lazy: its import reads settings relative to cwd

            lanes = generate_raw_index.read_snapshot_lanes(
                str(vault / generate_raw_index.SETTINGS_PATH))
        except SystemExit as exc:  # its fail() exits on a malformed or duplicated key
            defects.append(f"snapshot lane placement check could not run: {exc}")
            return
    if not lanes:
        return
    git = ["git", "-c", "core.quotepath=false", "-C", str(vault)]
    try:
        diff = subprocess.run(git + ["diff", "--name-status", "--find-renames", base, "--", "raw"],
                              capture_output=True, text=True, timeout=60)
        others = subprocess.run(git + ["ls-files", "--others", "--exclude-standard", "--", "raw"],
                                capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        defects.append(f"snapshot lane placement check could not run: {exc}")
        return
    if diff.returncode != 0 or others.returncode != 0:
        defects.append(
            f"snapshot lane placement check could not run (git diff against {base} failed)")
        return
    added = []
    for line in diff.stdout.splitlines():
        status, _, rest = line.partition("\t")
        if status[:1] in ("A", "R"):
            added.append(rest.split("\t")[-1])
    added += [p for p in others.stdout.splitlines() if p.strip()]
    for rel in added:
        name = rel[len("raw/"):] if rel.startswith("raw/") else ""
        if "/" in name or not name.endswith(".md"):
            continue
        for lane in lanes:
            if name.startswith(f"{lane}-"):
                defects.append(
                    f"{rel} added at the raw root — {lane} snapshots go to "
                    f"raw/{lane}/{name[len(lane) + 1:]} (docs/raw-layout.md § 레인 2); "
                    "move it before merging: raw is append-only once it lands"
                )


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
    the clause pile that reached 2,091 bytes in one project README and that
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


MILESTONE_MAX_BYTES = 300
MS_KEY_RE = re.compile(r"^milestones:(?:[ \t]+(.*?))?[ \t]*$")
MS_ITEM_RE = re.compile(r"^[ \t]+-[ \t]+(.*?)[ \t]*$")
MS_NAME_RE = re.compile(r"^[ \t]+name:[ \t]*(.*?)[ \t]*$")
MS_MAP_KEY_RE = re.compile(r"^(name|due|done|status):(?:[ \t]+(.*))?$")
MS_ANY_KEY_RE = re.compile(r"^[A-Za-z_][\w-]*:(?:[ \t]|$)")
MS_DOC = "docs/project-milestones.md"


def scan_milestones(text: str, rel_path: str) -> list[str]:
    """Report `milestones` entries whose name carries the record instead of naming it.

    A milestone name is a label: what the checkpoint is, in at most 300 bytes, one line.
    The evidence — counts, pass tables, deploy rounds, pointers — belongs in the body or in
    the `outputs/` report the label points at. `docs/project-milestones.md` is the contract.
    Both item shapes are legal (a plain string, or a mapping with `due`/`done`); what this
    catches is the shape that parses and still buries the project: the 4,889-byte name that
    made one README's frontmatter 76% of the file.

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
        if MS_KEY_RE.match(lines[offset]):
            key_at = offset
            break
    if key_at is None:
        return []

    value = (MS_KEY_RE.match(lines[key_at]).group(1) or "").strip()
    if value:
        if value.replace(" ", "") == "[]":
            return []  # empty
        if value.startswith("["):
            return [
                f"{rel_path}:{key_at + 1} milestones must be a block sequence, not an inline "
                f"flow sequence — one entry per line ({MS_DOC})"
            ]
        return [
            f"{rel_path}:{key_at + 1} milestones must be a block sequence — an entry per "
            f"checkpoint, not one value ({MS_DOC})"
        ]

    defects: list[str] = []
    item_no = 0
    open_name = False  # the last line read was a name, so an indented plain line continues it
    for offset in range(key_at + 1, end):
        line = lines[offset]
        if not line.strip():
            continue
        item = MS_ITEM_RE.match(line)
        if item:
            item_no += 1
            inner = item.group(1)
            mapping = MS_MAP_KEY_RE.match(inner)
            if mapping and mapping.group(1) != "name":
                open_name = False
                continue  # a mapping entry whose name: line comes further down
            name = mapping.group(2) if mapping else inner
        else:
            named = MS_NAME_RE.match(line)
            if not named:
                if not line[0].isspace():
                    break  # a column-0 key ends the sequence
                stripped = line.strip()
                if open_name and not MS_ANY_KEY_RE.match(stripped) and not stripped.startswith("#"):
                    defects.append(
                        f"{rel_path}:{offset + 1} milestones entry {item_no} name continues onto "
                        f"another line — a name is one line ({MS_DOC})"
                    )
                open_name = False
                continue  # due:/done: and anything else we do not judge
            name = named.group(1)
        name = (name or "").strip()
        if FM_BLOCK_RE.match(name):
            defects.append(
                f"{rel_path}:{offset + 1} milestones entry {item_no} names its checkpoint with a "
                f"block scalar — a name is one line ({MS_DOC})"
            )
            open_name = False  # its body lines are the block, already reported
            continue
        open_name = True
        size = len(_na_unquote(name).encode("utf-8"))
        if size > MILESTONE_MAX_BYTES:
            defects.append(
                f"{rel_path}:{offset + 1} milestones entry {item_no} names its checkpoint in "
                f"{size} bytes (max {MILESTONE_MAX_BYTES}) — the name is a label, the record "
                f"goes in the body ({MS_DOC})"
            )
    return defects


REVIEW_STATES = ("pending", "confirmed")
REVIEW_GATE_MAX_BYTES = 300
RV_KEYS = ("review", "review_since", "review_gate", "review_ref", "status")
RV_KEY_RE = re.compile(r"^(review|review_since|review_gate|review_ref|status):(?:[ \t]+(.*?))?[ \t]*$")
RV_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RV_DOC = "docs/project-review.md"


def _rv_plain(value: str) -> str:
    """A bare enum/date value: strip one quote layer, else cut a trailing ` # comment`."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1].strip()
    return value.split(" #", 1)[0].strip()


def scan_review(text: str, rel_path: str) -> list[str]:
    """Report a project `review` gate that cannot be read as one.

    `review` marks a project whose documents were merged before the user's review passed
    (`pending`) or after it passed (`confirmed`; a missing key means confirmed). While
    pending, `review_since` (the merge date) and `review_gate` (what clears it, one line,
    at most 300 bytes) are required, and the project cannot be `status: done`.
    `docs/project-review.md` is the contract. The lifecycle `status` is a different axis
    and is not judged here.

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

    found: dict[str, tuple[int, str]] = {}
    for offset in range(1, end):
        match = RV_KEY_RE.match(lines[offset])
        if match and match.group(1) not in found:
            found[match.group(1)] = (offset + 1, (match.group(2) or "").strip())

    if "review" not in found:
        for key in ("review_since", "review_gate", "review_ref"):
            if key in found:
                return [
                    f"{rel_path}:{found[key][0]} {key} without review — the gate fields hang "
                    f"off `review: pending`; drop them or add the state ({RV_DOC})"
                ]
        return []

    lineno, raw = found["review"]
    state = _rv_plain(raw)
    if not state:
        return [
            f"{rel_path}:{lineno} review is empty — pending or confirmed, or drop the key "
            f"(absent means confirmed) ({RV_DOC})"
        ]
    if FM_BLOCK_RE.match(state) or state.startswith(("[", "{")):
        return [
            f"{rel_path}:{lineno} review must be a bare value, pending or confirmed — the gate "
            f"goes in review_since · review_gate · review_ref, not nested here ({RV_DOC})"
        ]
    if state not in REVIEW_STATES:
        return [
            f"{rel_path}:{lineno} review is '{state}' — pending or confirmed only; the "
            f"lifecycle is status, not review ({RV_DOC})"
        ]
    if state != "pending":
        return []

    defects: list[str] = []
    for key in ("review_since", "review_gate"):
        if key not in found or not _na_unquote(found[key][1]).strip():
            defects.append(
                f"{rel_path}:{lineno} review: pending needs {key} — when it was merged "
                f"unreviewed and what clears the gate ({RV_DOC})"
            )
    if "review_since" in found:
        since_line, since_raw = found["review_since"]
        since = _rv_plain(since_raw)
        if since and not RV_DATE_RE.match(since):
            defects.append(
                f"{rel_path}:{since_line} review_since is '{since}' — a YYYY-MM-DD date ({RV_DOC})"
            )
    if "review_gate" in found:
        gate_line, gate_raw = found["review_gate"]
        gate = _na_unquote(gate_raw)
        if FM_BLOCK_RE.match(gate):
            defects.append(
                f"{rel_path}:{gate_line} review_gate is a block scalar — the gate is one line, "
                f"the evidence goes in the body ({RV_DOC})"
            )
        else:
            size = len(gate.encode("utf-8"))
            if size > REVIEW_GATE_MAX_BYTES:
                defects.append(
                    f"{rel_path}:{gate_line} review_gate is {size} bytes "
                    f"(max {REVIEW_GATE_MAX_BYTES}) — one clearing condition, detail in the "
                    f"body ({RV_DOC})"
                )
    if "status" in found and _rv_plain(found["status"][1]) == "done":
        defects.append(
            f"{rel_path}:{found['status'][0]} status: done while review: pending — a project "
            f"closes only after its review gate is confirmed ({RV_DOC})"
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
            # an unparseable block makes the next_action/milestones reading meaningless
            defects.extend(scan_next_action(text, rel))
            defects.extend(scan_milestones(text, rel))
            defects.extend(scan_review(text, rel))


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


LINK_LIST = "vault_orphans.py --broken"
BASE_TREE_PATHSPECS = ("*.md", ":(exclude)raw", ":(exclude)archive", ":(exclude)private")


def check_reachability(work: vault_orphans.Vault, defects: list[str]) -> None:
    """Check 11: every required document is reachable from wiki/INDEX.md."""
    if vault_orphans.ROOT_NOTE not in work.files:
        defects.append(f"{vault_orphans.ROOT_NOTE} is missing: reachability cannot be checked")
        return
    for orphan in work.unreachable(work.reachable()):
        defects.append(f"{orphan}: unreachable from {vault_orphans.ROOT_NOTE} (vault_orphans.py --plan)")


def _base_tree_vault(vault: Path, base: str, tmp: str) -> vault_orphans.Vault | str:
    """The base ref's Markdown (outside raw/, archive/, private/) extracted into tmp and scanned;
    a message when git cannot produce it."""
    try:
        proc = subprocess.run(["git", "archive", "--format=tar", base, "--", *BASE_TREE_PATHSPECS],
                              cwd=vault, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return f"link check could not run: {exc}"
    if proc.returncode != 0:
        head = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        return "link check could not run: " + (head[0] if head else "git archive failed")
    with tarfile.open(fileobj=io.BytesIO(proc.stdout)) as tar:
        tar.extractall(tmp, filter="data")
    return vault_orphans.Vault(tmp)


def check_link_ratchet(vault: Path, base: str, work: vault_orphans.Vault, defects: list[str]) -> None:
    """Check 12: no broken link on the working tree that was not already broken on the base."""
    work_broken = work.broken_links()
    if not work_broken:
        return
    with tempfile.TemporaryDirectory() as tmp:
        base_vault = _base_tree_vault(vault, base, tmp)
        if isinstance(base_vault, str):
            defects.append(base_vault)
            return
        new = work_broken - base_vault.broken_links()
    for source, kind, target in sorted(new):
        shown = f"[[{target}]]" if kind == "wiki" else f"({target})"
        defects.append(
            f"{source}: new broken link {shown} — resolves to no document; fix the link, or the "
            f"remaining references of a moved file ({LINK_LIST} lists every broken link)"
        )


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
    check_raw_index_scope(vault, base, defects)
    check_snapshot_lane_placement(vault, base, defects)
    check_frontmatter(vault, defects)
    defects.extend(vault_volume.check(vault))
    work = vault_orphans.Vault(str(vault))
    check_reachability(work, defects)
    check_link_ratchet(vault, base, work, defects)

    lane_label = args.lane if args.lane != "none" else "shared"
    if defects:
        print(f"FAIL ({lane_label}, base {base}): {len(defects)} defect(s)")
        for defect in defects:
            print(f"  - {defect}")
        return 1

    print(
        f"PASS ({lane_label}, base {base}): memory size, memory markers, lane trace, "
        "raw/archive append-only, raw index scope, snapshot lane placement, frontmatter structure, "
        "next_action shape, "
        "milestone names, review gate, volume fold, reachability, link ratchet"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
