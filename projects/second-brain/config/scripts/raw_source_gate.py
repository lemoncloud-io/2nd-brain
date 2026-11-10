#!/usr/bin/env python3
"""URL duplicate gate for ingest — the clipping's `source:` against raw/ AND open PRs.

`docs/raw-layout.md` § ingest 게이트: a clipping whose `source:` already exists updates the
existing note instead of creating a new one. Checking only the current branch's raw/ missed two
cases (`wiki/vault-ingest-judgment-rules.md` § 게이트와 파일 처리): the same original in a
parallel ingest PR not merged yet, and a newsletter archive URL shared by every section of one
issue. Owner decision 2026-10-27: widen the gate to open PRs, and give archive URLs a section
fragment (`<archive URL>#<n>`, newsletter-digest skill § 6).

    python3 raw_source_gate.py Clippings/*.md            # exit 1 when any source is taken
    python3 raw_source_gate.py --no-prs Clippings/x.md   # raw/ only (offline)
    (both take --root DIR and --json)

Open PRs are read with `gh` (`gh pr list` files, `gh api .../contents?ref=<head>`): only `.md`
files a PR adds or changes under raw/ are fetched. If `gh` fails, the gate says so and exits 2 —
it never reports "no duplicate" for a check it could not run.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.parse

SOURCE = re.compile(r'^source:\s*"?([^"\n]+?)"?\s*$', re.M)
SKIP_DIRS = {".git", "node_modules"}


def source_of(text: str) -> str:
    head = text.split("\n---", 1)[0] if text.startswith("---") else ""
    m = SOURCE.search(head)
    return m.group(1).strip() if m else ""


def raw_sources(root: str) -> dict[str, list[str]]:
    """source URL -> raw paths, from the frontmatter of every raw/**/*.md."""
    out: dict[str, list[str]] = {}
    top = os.path.join(root, "raw")
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for f in sorted(filenames):
            if not f.endswith(".md"):
                continue
            p = os.path.join(dirpath, f)
            with open(p, encoding="utf-8", errors="replace") as fh:
                s = source_of(fh.read(4096))
            if s:
                out.setdefault(s, []).append(os.path.relpath(p, root))
    return out


def gh(args: list[str], root: str) -> str:
    return subprocess.run(["gh", *args], cwd=root, capture_output=True, text=True, encoding="utf-8", check=True).stdout


def open_pr_sources(root: str, run=gh) -> dict[str, list[str]]:
    """source URL -> ["#<pr> <path>"] for raw/*.md files that open PRs add or change."""
    prs = json.loads(run(["pr", "list", "--state", "open", "--limit", "100",
                          "--json", "number,headRefName,files"], root))
    out: dict[str, list[str]] = {}
    for pr in prs:
        for f in pr.get("files") or []:
            path = f.get("path", "")
            if not (path.startswith("raw/") and path.endswith(".md")):
                continue
            q = urllib.parse.quote(path)
            ref = urllib.parse.quote(pr["headRefName"], safe="")
            try:
                body = run(["api", f"repos/{{owner}}/{{repo}}/contents/{q}?ref={ref}", "--jq", ".content"], root)
            except subprocess.CalledProcessError:
                continue  # deleted on the head, or renamed away
            s = source_of(base64.b64decode(body.strip() or "").decode("utf-8", "replace"))
            if s:
                out.setdefault(s, []).append(f"#{pr['number']} {path}")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("clippings", nargs="+")
    ap.add_argument("--root", default=".")
    ap.add_argument("--no-prs", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    local = raw_sources(root)
    prs: dict[str, list[str]] = {}
    if not a.no_prs:
        try:
            prs = open_pr_sources(root)
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as e:
            print(f"열린 PR을 읽지 못했다 — 게이트를 끝내지 못함: {e}", file=sys.stderr)
            return 2
    rows = []
    for c in a.clippings:
        with open(os.path.join(root, c) if not os.path.isabs(c) else c, encoding="utf-8") as fh:
            s = source_of(fh.read())
        rows.append({"clipping": c, "source": s, "raw": local.get(s, []) if s else [],
                     "open_prs": prs.get(s, []) if s else []})
    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for r in rows:
            hits = r["raw"] + r["open_prs"]
            state = "중복 — 기존 노트 갱신 경로" if hits else ("source 없음" if not r["source"] else "신규")
            print(f"{state}: {r['clipping']}")
            for h in hits:
                print(f"  - {h}")
    return 1 if any(r["raw"] or r["open_prs"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
