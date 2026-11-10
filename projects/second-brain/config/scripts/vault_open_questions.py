#!/usr/bin/env python3
"""Open-question queue — the `## Open Questions` bullets of wiki notes, as one list.

Every wiki note ends with `## Open Questions`. Bullets are written at ingest and rarely leave
(2026-10-27: 864 bullets, 90% of the creation-time ones unchanged). The note section stays the
one ledger; this tool only derives a queue from it, so nothing it prints is committed as a hub
(VAULT_RULES § Live tallies). Plan and measurements:
`projects/second-brain/outputs/2026-10-27-vault-cockpit-adoption-plan.md`.

    python3 vault_open_questions.py summary                  # `라벨: N` lines (lint report)
    python3 vault_open_questions.py list  [--kind A,B]       # every question, oldest note first
    python3 vault_open_questions.py batch [--kind A,B] [--limit 50]   # cleanup-round worklist
    python3 vault_open_questions.py ask   [--kind C] [--limit 10]     # owner question batch
    python3 vault_open_questions.py stale [--months 6]       # dated org-record questions past the cut
    python3 vault_open_questions.py diff  --base REF [--log FILE]     # closed/new since REF
    (every form takes --root DIR, --today YYYY-MM-DD and --json)

Scope is the vault-root `wiki/*.md` minus INDEX, VAULT_MEMORY and TOPIC_MAP (topic pages carry no
section). A question is a top-level bullet of the section; indented lines and nested bullets
belong to it. Its id is `<note slug>#<8 hex of sha1 of the whitespace-normalised text>` — a
reworded bullet is a new question, which `diff` shows as one closed and one new.

Kinds say who can close a question. They come from wording rules, not judgment — `summary` is a
triage aid, and `ask`/`batch` output is read by a person before anything is sent or edited:

    A  source recheck   official docs, release notes, needs-update      → agent
    B  measurement      untested here, reproduce, measure               → agent
    C  value decision   team/owner decision, adopt or not, contract     → owner
    D  org record       dated channel record, repo follow-up, 미결/미정  → team, stale candidate
    E  open research    none of the above                               → keep or stale

`diff --log FILE` exits 1 when a question closed since REF is not named (by id) in FILE — the
cleanup round's run-log must account for every bullet it removed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys

SKIP = {"INDEX.md", "VAULT_MEMORY.md", "TOPIC_MAP.md"}
SECTION = re.compile(r"^## Open Questions\s*$")
NEXT_H2 = re.compile(r"^## ")
BULLET = re.compile(r"^ ?[-*] +(.*)$")
FENCE = re.compile(r"^\s*(```|~~~)")
DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
CREATED = re.compile(r'^created:\s*"?(\d{4}-\d{2}-\d{2})', re.M)

KINDS = {
    "A": "출처 재확인",
    "B": "실측",
    "C": "값 판단",
    "D": "조직 기록",
    "E": "열린 연구",
}
RULES = [  # first match wins
    ("D", re.compile(r"\(#[\w가-힣.\-]+,\s*\d{4}-\d{2}-\d{2}"
                     r"|\(\d{4}-\d{2}-\d{2}\)[^.]*?(미정|미확정|미결|여부)"
                     r"|(미결|미확정)(로 남|\s*$|\s*—)"
                     r"|레포에서 확인|백엔드 레포|구현값 확인|(구현|완료|반영)되었는지|후속 처리 여부")),
    ("C", re.compile(r"팀 결정|사용자 결정|소유자|오너|결정된 바 없|결정하지 않|정하지 않았|정해지지 않"
                     r"|채택할지|도입할지|(쓸|둘|묶을|넓힐|뺄|허용할)지|계약 개정|개정 사안|명문화할 후보")),
    ("B", re.compile(r"미시험|미측정|실측|측정하지|측정되지|재현|실험|시험하지|대조하지 않았"
                     r"|이 (vault|볼트)(의|에서|에)")),
    ("A", re.compile(r"needs-update|공식|문서로 확인|확인 필요|확인이 필요|확인해야|확인하지 못|재확인"
                     r"|릴리스|README|낡았|출처", re.I)),
]


def kind_of(text: str) -> str:
    for k, rx in RULES:
        if rx.search(text):
            return k
    return "E"


def norm(text: str) -> str:
    return " ".join(text.split())


def qid(slug: str, text: str) -> str:
    return f"{slug}#{hashlib.sha1(norm(text).encode('utf-8')).hexdigest()[:8]}"


def parse(text: str) -> list[tuple[int, str]]:
    """(line number, bullet text) for every top-level bullet of `## Open Questions`."""
    out: list[list] = []
    inside = fence = False
    for n, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            fence = not fence
        if fence:
            continue
        if SECTION.match(line):
            inside = True
            continue
        if inside and NEXT_H2.match(line):
            inside = False
        if not inside:
            continue
        m = BULLET.match(line)
        if m:
            out.append([n, m.group(1).strip()])
        elif out and line.startswith("  ") and line.strip():
            out[-1][1] += " " + line.strip()
    return [(n, t) for n, t in out]


def items_from(files: dict[str, str]) -> list[dict]:
    items = []
    for path in sorted(files):
        text = files[path]
        slug = os.path.basename(path)[:-3]
        cm = CREATED.search(text)
        for line, body in parse(text):
            dates = ["-".join(m.groups()) for m in DATE.finditer(body)]
            items.append({
                "id": qid(slug, body),
                "note": path,
                "line": line,
                "kind": kind_of(body),
                "needs_update": "needs-update" in body.lower(),
                "note_created": cm.group(1) if cm else "",
                "latest_date": max(dates) if dates else "",
                "text": body,
            })
    return items


def worktree_files(root: str) -> dict[str, str]:
    wiki = os.path.join(root, "wiki")
    out = {}
    for f in sorted(os.listdir(wiki)):
        if f.endswith(".md") and f not in SKIP and os.path.isfile(os.path.join(wiki, f)):
            with open(os.path.join(wiki, f), encoding="utf-8") as fh:
                out[f"wiki/{f}"] = fh.read()
    return out


def git_files(root: str, ref: str) -> dict[str, str]:
    names = subprocess.run(["git", "ls-tree", "--name-only", ref, "wiki/"], cwd=root,
                           capture_output=True, text=True, encoding="utf-8", check=True).stdout.split("\n")
    out = {}
    for p in names:
        if p.endswith(".md") and p.count("/") == 1 and os.path.basename(p) not in SKIP:
            out[p] = subprocess.run(["git", "show", f"{ref}:{p}"], cwd=root, capture_output=True,
                                    text=True, encoding="utf-8", check=True).stdout
    return out


def months_before(day: dt.date, months: int) -> dt.date:
    y, m = divmod(day.month - 1 - months, 12)
    return dt.date(day.year + y, m + 1, min(day.day, 28))


def pick(items, kinds, limit):
    sel = [i for i in items if i["kind"] in kinds]
    sel.sort(key=lambda i: (i["note_created"] or "9999", i["note"], i["line"]))
    return sel[:limit] if limit else sel


def md_list(items, heading=None, slot=None):
    lines = [heading, ""] if heading else []
    note = None
    for i in items:
        if i["note"] != note:
            note = i["note"]
            lines += ([""] if lines and lines[-1] else []) + [f"### `{note}`", ""]
        lines.append(f"- `{i['id']}` [{i['kind']} {KINDS[i['kind']]}] {i['text']}")
        if slot:
            lines.append(f"  - {slot}")
    return "\n".join(lines).strip() + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["summary", "list", "batch", "ask", "stale", "diff"])
    ap.add_argument("--root", default=".")
    ap.add_argument("--kind", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--months", type=int, default=6)
    ap.add_argument("--today", default="")
    ap.add_argument("--base", default="")
    ap.add_argument("--log", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    items = items_from(worktree_files(root))
    kinds = set(a.kind.replace(" ", "").split(",")) - {""}

    if a.cmd == "summary":
        notes = {i["note"] for i in items}
        cut = months_before(today, a.months).isoformat()
        stale = [i for i in items if i["kind"] == "D" and i["latest_date"] and i["latest_date"] < cut]
        rows = [("열린 질문이 있는 노트", len(notes)), ("열린 질문", len(items)),
                ("needs-update 표시", sum(i["needs_update"] for i in items))]
        rows += [(f"유형 {k} {v}", sum(i["kind"] == k for i in items)) for k, v in KINDS.items()]
        rows.append((f"stale 후보 (D, {a.months}개월 경과)", len(stale)))
        if a.json:
            print(json.dumps(dict(rows), ensure_ascii=False, indent=2))
        else:
            print("\n".join(f"{k}: {v}" for k, v in rows))
        return 0

    if a.cmd == "list":
        sel = pick(items, kinds or set(KINDS), a.limit)
        print(json.dumps(sel, ensure_ascii=False, indent=2) if a.json else md_list(sel), end="" if not a.json else "\n")
        return 0

    if a.cmd == "batch":
        sel = pick(items, kinds or {"A", "B"}, a.limit or 50)
        if a.json:
            print(json.dumps(sel, ensure_ascii=False, indent=2))
        else:
            print(md_list(sel, f"# 정리 회차 작업 목록 — {len(sel)}개 ({today})",
                          "판정: 해소 / stale 제안 / 유지 — 근거:"), end="")
        return 0

    if a.cmd == "ask":
        sel = pick(items, kinds or {"C"}, a.limit or 10)
        if a.json:
            print(json.dumps(sel, ensure_ascii=False, indent=2))
        else:
            print(md_list(sel, f"# 소유자 질문 묶음 — {len(sel)}개 ({today})",
                          "권고 기본값: — 근거: — 소유자 답:"), end="")
        return 0

    if a.cmd == "stale":
        cut = months_before(today, a.months).isoformat()
        sel = [i for i in pick(items, kinds or {"D"}, 0) if i["latest_date"] and i["latest_date"] < cut]
        sel = sel[:a.limit] if a.limit else sel
        if a.json:
            print(json.dumps(sel, ensure_ascii=False, indent=2))
        else:
            print(md_list(sel, f"# stale 제안 후보 — 기록 날짜가 {cut} 이전 ({len(sel)}개)",
                          "판정(소유자): 닫기 / 유지"), end="")
        return 0

    # diff
    if not a.base:
        ap.error("diff needs --base REF")
    old = {i["id"]: i for i in items_from(git_files(root, a.base))}
    new = {i["id"]: i for i in items}
    closed = [old[k] for k in old if k not in new]
    opened = [new[k] for k in new if k not in old]
    missing = []
    if a.log:
        with open(os.path.join(root, a.log), encoding="utf-8") as fh:
            log = fh.read()
        missing = [i for i in closed if i["id"] not in log]
    if a.json:
        print(json.dumps({"closed": closed, "new": opened, "unlogged": missing}, ensure_ascii=False, indent=2))
    else:
        print(f"기준 {a.base}: 닫힘 {len(closed)} · 새로 생김 {len(opened)} · 순변화 {len(opened) - len(closed):+d}")
        for i in closed:
            mark = " (run-log에 없음)" if i in missing else ""
            print(f"- 닫힘 `{i['id']}`{mark} {i['text'][:120]}")
        for i in opened:
            print(f"+ 새로 `{i['id']}` {i['text'][:120]}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
