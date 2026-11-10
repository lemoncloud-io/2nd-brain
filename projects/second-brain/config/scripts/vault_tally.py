#!/usr/bin/env python3
"""Count vault things on demand — documents in a folder, folders of an index, rows of a table.

A hub (project README, folder README, wiki root) points at a collection and must not restate
how many items it holds (VAULT_RULES § Live tallies): the number is true only until the next PR
adds an item, so every such PR edits the hub line (parallel PRs then conflict on it, 2026-10-21)
or leaves it false (`42건` where the folder held 47). Instead the number is asked for:

    python3 vault_tally.py docs    <dir> [--name feature-definition.md] [--flat]
    python3 vault_tally.py folders <dir>
    python3 vault_tally.py rows    <file> [--section "요구사항 정의서"]
    (any form takes --root DIR and --json)

docs     Markdown documents under <dir>, recursive unless --flat; the folder's own README.md is
         not counted (it is the index, not an item); --name counts files of that name only.
folders  direct subfolders of <dir> that carry a README.md — the items of a folder index.
rows     body rows of the Markdown tables in <file> (a row is a `|` line after a `| --- |`
         separator, until the table ends); --section limits it to one heading's subtree.
Code fences are skipped. A project-specific set of tallies is composed from these three — a
project's own wiki lint can offer a `--tally` that calls them.

`live_tallies(text)` is the matching detector: lines that carry a bare count (`42건`, `35 folders`)
with no date on the line. `vault_verify.py` (check 13) fails a change set that adds one to a hub;
a project's own wiki lint may fail its root README on any. A dated count (`2026-10-15 실측 67개`) is a record.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

TALLY = re.compile(r"(?<![\w.\-/])\d+\s?(?:건|개|편|파일|문서|폴더|항목|행"
                   r"|(?:rows?|files?|docs?|documents?|folders?|items?|entries)\b)")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
INLINE_CODE = re.compile(r"`[^`\n]*`")
FENCE = re.compile(r"^\s*(```|~~~)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
SEPARATOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
SKIP_DIRS = {"node_modules", ".git", ".claude", ".obsidian", "__pycache__"}


def live_tallies(text: str) -> list[tuple[int, str]]:
    """(line number, matched count) for every line with a bare count and no date; inline code is ignored."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if DATE.search(line):
            continue
        m = TALLY.search(INLINE_CODE.sub("", line))
        if m:
            out.append((n, m.group(0)))
    return out


def count_docs(root: str, rel_dir: str, name: str | None = None, recursive: bool = True) -> int:
    top = os.path.join(root, rel_dir)
    n = 0
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS) if recursive else []
        for f in filenames:
            if not f.endswith(".md"):
                continue
            if name is not None:
                n += f == name
            elif not (dirpath == top and f == "README.md"):
                n += 1
    return n


def count_folders(root: str, rel_dir: str) -> int:
    top = os.path.join(root, rel_dir)
    return sum(1 for d in os.listdir(top)
               if d not in SKIP_DIRS and os.path.isfile(os.path.join(top, d, "README.md")))


def count_rows(root: str, rel_file: str, section: str | None = None) -> int:
    with open(os.path.join(root, rel_file), encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    n, in_fence, in_body, active, active_level = 0, False, False, section is None, 0
    for line in lines:
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        h = HEADING.match(line)
        if h and section is not None:
            level = len(h.group(1))
            if section in h.group(2):
                active, active_level = True, level
            elif active and level <= active_level:
                active = False
            in_body = False
            continue
        if SEPARATOR.match(line) and line.lstrip().startswith("|"):
            in_body = True
            continue
        if not line.lstrip().startswith("|"):
            in_body = False
            continue
        if in_body and active:
            n += 1
    return n


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("kind", choices=("docs", "folders", "rows"))
    ap.add_argument("path")
    ap.add_argument("--root", default=".")
    ap.add_argument("--name", help="docs: count files of this name only")
    ap.add_argument("--flat", action="store_true", help="docs: this folder only, no recursion")
    ap.add_argument("--section", help="rows: only tables under this heading")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    if a.kind == "docs":
        n = count_docs(root, a.path, a.name, not a.flat)
    elif a.kind == "folders":
        n = count_folders(root, a.path)
    else:
        n = count_rows(root, a.path, a.section)
    if a.json:
        print(json.dumps({"kind": a.kind, "path": a.path, "name": a.name, "section": a.section, "count": n},
                         ensure_ascii=False))
    else:
        print(n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
