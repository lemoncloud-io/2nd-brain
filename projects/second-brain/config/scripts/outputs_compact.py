#!/usr/bin/env python3
"""Compact outputs/ by month: summary note per month, then delete the detailed records.

Run from the vault root. Part of the vault-lint pass (skills/vault-lint.md § outputs 월간 압축,
VAULT_RULES.md § Monthly compaction, 2026-10-12).

    python3 outputs_compact.py plan  [--until YYYY-MM-DD]   # what would be compacted, nothing written
    python3 outputs_compact.py write [--until YYYY-MM-DD]   # create/refresh outputs/monthly/YYYY-MM.md only
    python3 outputs_compact.py apply [--until YYYY-MM-DD]   # write, then `git rm` the eligible records

Eligible records (`--until` defaults to today):
  - run-logs `outputs/runs/YYYY-MM-DD-*.md` dated on or before --until;
  - lint reports `outputs/YYYY-MM-DD-*vault-lint*.md` of months before the --until month, except
    the newest lint report overall (the "latest lint" derivation needs one);
  - query answers are never eligible.

The summary note keeps, for every record of its month, one line: on-disk records as wikilinks,
deleted records as a link to the PR that added them plus the record name and its `summary`.
A refresh keeps the hand-written `## Answer` and every deleted entry already in the note and only
re-renders the rest, so running `write` twice yields the same bytes. Deleted ingest run-logs are
frozen into `compacted_ingest_runs`/`compacted_clippings`/`compacted_first`/`compacted_last`,
which vault_volume.py folds. Raw files that only deleted records mentioned are listed in the note
so the raw index keeps a reference to them (no new orphans).

The judgment work — moving durable knowledge to wiki/ before `apply`, and writing `## Answer` —
is the lint pass's, not this script's. `apply` refuses while a touched note still carries the
Answer placeholder.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

MONTHLY = "outputs/monthly"
RUNS = "outputs/runs"
PLACEHOLDER = "- (작성 필요) 아래 Evidence를 읽고 이 달의 흐름을 3~6줄로 쓴다."
KINDS = ("ingest", "promotion", "maintenance")
KO = {"lint-report": "lint 보고서", "query-output": "질의 답변"}
SCAN_GLOBS = ["wiki/**/*.md", "outputs/**/*.md", "projects/**/*.md", "areas/**/*.md"]
DELETED_RE = re.compile(
    r"^- (?:\[(?P<label>[^\]]+)\]\((?P<url>[^)\s]+)\)|(?P<plain>[^`\[]+?)) `(?P<name>[^`]+)`(?: — (?P<summary>.*))?$")


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def split_fm(text: str) -> tuple[dict, str, str]:
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return {}, "", text
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if mm:
            v = mm.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] == '"':
                v = v[1:-1]
            fm[mm.group(1)] = v
    return fm, m.group(1), m.group(2)


def h1(body: str) -> str:
    m = re.search(r"^# (.+)$", body, re.M)
    return m.group(1).strip() if m else ""


def pr_base() -> str | None:
    url = git("remote", "get-url", "origin", check=False).strip()
    m = re.search(r"github\.com[:/]([^/]+)/([^/\s]+?)(?:\.git)?$", url)
    return f"https://github.com/{m.group(1)}/{m.group(2)}/pull/" if m else None


def find_pr(path: str, fm_pr: str) -> str | None:
    m = re.search(r"(\d+)\s*$", fm_pr or "")
    if m:
        return m.group(1)
    line = git("log", "--diff-filter=A", "--format=%H%x09%s", "-1", "--", path, check=False).strip()
    if not line:
        return None
    sha, _, subject = line.partition("\t")
    m = re.search(r"\(#(\d+)\)\s*$", subject)
    if m:
        return m.group(1)
    if shutil.which("gh") and pr_base():
        repo = pr_base().split("github.com/")[1].rstrip("/").rsplit("/pull", 1)[0]
        try:
            r = subprocess.run(["gh", "api", f"repos/{repo}/commits/{sha}/pulls",
                                "--jq", "[.[]|select(.merged_at!=null)][0].number // empty"],
                               capture_output=True, text=True, timeout=20)
            if r.returncode == 0 and r.stdout.strip().isdigit():
                return r.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    merges = git("log", "--merges", "--ancestry-path", "--format=%s", f"{sha}..HEAD", check=False)
    found = re.findall(r"pull request #(\d+)", merges)
    return found[-1] if found else None


def read_record(path: str) -> dict:
    name = Path(path).stem
    fm, _, body = split_fm(Path(path).read_text(encoding="utf-8"))
    rec = {"path": path, "name": name, "date": name[:10], "month": name[:7], "text": None}
    if path.startswith(RUNS + "/"):
        rec.update(kind="run", rkind=fm.get("kind", "maintenance"), summary=fm.get("summary", "").strip().strip("'"),
                   pr=fm.get("pr", ""), processed=int(fm.get("processed") or 0)
                   if str(fm.get("processed", "")).isdigit() else 0, run_date=fm.get("run_date", name[:10])[:10])
    else:
        t = fm.get("type", "query-output")
        title = h1(body)
        rec.update(kind="report", type=t, pr=fm.get("pr", ""),
                   label=title.replace("Vault Lint Report - ", "lint ") if t == "lint-report" else title)
    return rec


def tracked_records() -> list[dict]:
    paths = [p for p in git("ls-files", "-z", "outputs").split("\0") if p]
    out = []
    for p in paths:
        if not p.endswith(".md") or p.startswith(MONTHLY + "/"):
            continue
        base = Path(p).name
        if not re.match(r"^\d{4}-\d{2}-\d{2}-", base):
            continue
        if Path(p).parent.as_posix() in ("outputs", RUNS):
            out.append(read_record(p))
    return out


def eligible(records: list[dict], until: str) -> list[dict]:
    lints = sorted(r["path"] for r in records if r["kind"] == "report" and "vault-lint" in r["name"])
    newest_lint = lints[-1] if lints else None
    out = []
    for r in records:
        if r["kind"] == "run" and r["date"] <= until:
            out.append(r)
        elif (r["kind"] == "report" and r.get("type") == "lint-report" and "vault-lint" in r["name"]
              and r["month"] < until[:7] and r["path"] != newest_lint):
            out.append(r)
    return out


def parse_note(path: Path) -> dict:
    note = {"answer": None, "created": None, "deleted": {}, "keep_raw": [], "compacted": None}
    if not path.exists():
        return note
    fm, _, body = split_fm(path.read_text(encoding="utf-8"))
    note["created"] = fm.get("created")
    if "compacted_ingest_runs" in fm:
        note["compacted"] = {"runs": int(fm["compacted_ingest_runs"]), "clips": int(fm.get("compacted_clippings", 0)),
                             "first": fm.get("compacted_first"), "last": fm.get("compacted_last")}
    m = re.search(r"^## Answer\n(.*?)(?=^## )", body, re.S | re.M)
    if m:
        lines = [l for l in m.group(1).splitlines() if not l.lstrip().startswith("|")]
        note["answer"] = "\n".join(lines).strip("\n")
    section = None
    for line in body.splitlines():
        if line.startswith("### "):
            section = line[4:]
            continue
        if line.startswith("## "):
            section = None
            continue
        if section and section.startswith("지운 기록만 가리키던 raw"):
            mm = re.match(r'^- "(raw/.+)"$', line)
            if mm:
                note["keep_raw"].append(mm.group(1))
            continue
        mm = DELETED_RE.match(line)
        if mm and section:
            kind = "run" if section.startswith("실행 로그") else "report"
            rkind = section.split("·")[1].split("(")[0].strip() if kind == "run" else None
            rtype = "lint-report" if section.startswith("lint") else "query-output"
            note["deleted"][mm.group("name")] = {"line": line, "kind": kind, "rkind": rkind,
                                                 "type": rtype, "date": mm.group("name")[:10]}
    return note


def render_entry(r: dict, gone: bool, base: str | None, pr: str | None) -> str:
    if r["kind"] == "report":
        if not gone:
            return f"- [[outputs/{r['name']}|{r['label']}]]"
        head = f"[{r['label']}]({base}{pr})" if base and pr else r["label"]
        return f"- {head} `{r['name']}`"
    short = r["date"][5:]
    tail = f" — {r['summary']}" if r["summary"] else ""
    if not gone:
        return f"- [[{RUNS}/{r['name']}|{short}]]" + (f" · PR #{pr}" if pr else "") + tail
    head = f"[{short} · PR #{pr}]({base}{pr})" if base and pr else short
    return f"- {head} `{r['name']}`{tail}"


def raw_mentions(text: str, raws: list[str]) -> set[str]:
    t = nfc(text)
    return {r for r in raws if r in t}


def build_note(month: str, records: list[dict], gone_now: set[str], note: dict, until: str,
               keep_raw: list[str], compacted: dict | None, today: str, base: str | None,
               prs: dict) -> str:
    partial = month == until[:7]
    reps = [r for r in records if r["kind"] == "report"]
    runs = [r for r in records if r["kind"] == "run"]
    on_disk_reports = [r for r in reps if r["path"] not in gone_now]
    entries: dict[str, list[tuple[str, str]]] = {}

    def add(section: str, date: str, line: str) -> None:
        entries.setdefault(section, []).append((date, line))

    for r in reps:
        sec = KO.get(r["type"], "질의 답변")
        add(sec, r["name"], render_entry(r, r["path"] in gone_now, base, prs.get(r["path"])))
    for r in runs:
        add(f"실행 로그 · {r['rkind']}", r["name"], render_entry(r, r["path"] in gone_now, base, prs.get(r["path"])))
    present = {r["name"] for r in records}
    for name, d in note["deleted"].items():
        if name in present:
            continue
        sec = f"실행 로그 · {d['rkind']}" if d["kind"] == "run" else KO.get(d["type"], "질의 답변")
        add(sec, name, d["line"])

    ngone_total = sum(1 for sec in entries.values() for _, l in sec if DELETED_RE.match(l))
    gone_lint = any(DELETED_RE.match(l) for _, l in entries.get("lint 보고서", []))
    gone_run = any(DELETED_RE.match(l) for k, v in entries.items() if k.startswith("실행 로그") for _, l in v)

    L = ["---", "type: query-output", f'created: "{note["created"] or today}"',
         f'question: "{month} 한 달 동안 outputs/ 에 쌓인 보고서와 실행 로그를 한 장으로 보면 무엇이 있었나?"',
         "# Vault Markdown notes use quoted wikilinks; raw paths, URLs, and other files stay strings."]
    if compacted:
        L += [f"compacted_ingest_runs: {compacted['runs']}", f"compacted_clippings: {compacted['clips']}",
              f'compacted_first: "{compacted["first"]}"', f'compacted_last: "{compacted["last"]}"']
    L.append("sources:" if on_disk_reports else "sources: []")
    for r in sorted(on_disk_reports, key=lambda r: r["name"]):
        L.append(f'  - "[[outputs/{r["name"]}|{r["date"]}]]"')
    L += ["---", "", f"# outputs 월간 요약 — {month}" + (f" ({until} 기준, 진행 중)" if partial else ""), "",
          "## Answer", "", note["answer"] or PLACEHOLDER, "", "## Evidence", "", "### 건수", "",
          "| 구분 | 건수 |", "| --- | --- |"]
    order = ["질의 답변", "lint 보고서"] + [f"실행 로그 · {k}" for k in KINDS]
    order += sorted(k for k in entries if k not in order)
    for sec in order:
        if entries.get(sec):
            L.append(f"| {sec} | {len(entries[sec])} |")
    L.append("")
    for sec in order:
        es = entries.get(sec)
        if not es:
            continue
        L += [f"### {sec} ({len(es)})", ""] + [line for _, line in sorted(es)] + [""]
    if keep_raw:
        L += ["### 지운 기록만 가리키던 raw", "",
              "아래 raw는 이 달에 지운 기록만 출처로 가리키고 있었다. 출처 연결이 끊기지 않도록 여기 남긴다(경로는 문자열).", ""]
        L += [f'- "{r}"' for r in sorted(set(keep_raw))] + [""]
    keep = "질의 답변" + ("" if gone_lint else "과 lint 보고서")
    what = ("lint 보고서와 실행 로그는" if gone_lint and gone_run else "실행 로그는" if gone_run else "lint 보고서는")
    L += ["## Notes", ""]
    if ngone_total:
        L.append(f"- {keep}는 원본이 그대로 있고 정본도 원본이다. {what} 지웠으므로 이 노트가 볼트 안의 유일한 기록이다."
                 " 지운 기록마다 그것을 들여온 PR(본문·커밋·리뷰·바뀐 파일)로 링크했다 — 판단 근거와 이력은 PR에서 본다."
                 " 오래 쓸 판정과 함정은 지우기 전에 wiki로 옮겼다.")
    else:
        L.append("- 요약 노트일 뿐이다. 원본은 그대로 있고 정본도 원본이다.")
    L.append("- 실행 로그 한 줄은 원본의 `summary` 그대로다. 생성: `projects/second-brain/config/scripts/outputs_compact.py`.")
    if compacted:
        L.append(f"- 지운 ingest 실행 로그가 세던 몫({compacted['runs']}회 / {compacted['clips']}클리핑)은 frontmatter"
                 " `compacted_*`에 고정했다. `vault_volume.py`가 이 값을 더한다 — 손으로 고치지 않는다.")
    if partial:
        L.append(f"- 이달이 끝나지 않았다. {until}까지의 기록만 들어 있다. 다음 정비 때 같은 스크립트가 이후 항목을 덧붙인다.")
    L += ["", "## Follow-ups", "", "- 다음 정비(vault-lint)에서 `outputs_compact.py`가 이 노트를 갱신한다. `## Answer`는 사람이·lint가 쓴다.", ""]
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mode", choices=["plan", "write", "apply"])
    ap.add_argument("--until", default=dt.date.today().isoformat())
    a = ap.parse_args()
    if not (Path("VAULT_RULES.md").is_file() and Path("outputs").is_dir()):
        print("run from the vault root", file=sys.stderr)
        return 2
    today = dt.date.today().isoformat()
    records = tracked_records()
    elig = eligible(records, a.until)
    gone_now = {r["path"] for r in elig} if a.mode == "apply" else set()
    months = sorted({r["month"] for r in records} | {p.stem for p in Path(MONTHLY).glob("*.md")})
    if a.mode == "plan":
        by = {}
        for r in elig:
            by.setdefault(r["month"], []).append(r)
        for m in months:
            note = parse_note(Path(MONTHLY) / f"{m}.md")
            es = by.get(m, [])
            print(f"{m}: eligible {len(es)} (runs {sum(r['kind']=='run' for r in es)}, lint "
                  f"{sum(r['kind']=='report' for r in es)}), note {'missing' if note['created'] is None else 'present'}"
                  f"{', Answer needed' if not note['answer'] or note['answer'] == PLACEHOLDER else ''}")
        return 0
    if gone_now:
        dry = subprocess.run(["git", "rm", "-n", "-q", "--", *sorted(gone_now)], capture_output=True, text=True)
        if dry.returncode != 0:
            print(f"refusing: git rm would fail, nothing written ({dry.stderr.strip().splitlines()[0]})", file=sys.stderr)
            return 4
    base = pr_base()
    prs = {r["path"]: find_pr(r["path"], r.get("pr", "")) for r in records
           if r["kind"] == "run" or r["path"] in gone_now}
    raws = [nfc(p) for p in git("ls-files", "-z", "raw").split("\0") if p]
    corpus = {}
    for pat in SCAN_GLOBS:
        for p in Path(".").glob(pat):
            if p.as_posix() in gone_now or p.as_posix().startswith(MONTHLY + "/"):
                continue
            try:
                corpus[p.as_posix()] = nfc(p.read_text(encoding="utf-8"))
            except OSError:
                pass
    Path(MONTHLY).mkdir(parents=True, exist_ok=True)
    blocked, written = [], []
    for m in months:
        path = Path(MONTHLY) / f"{m}.md"
        note = parse_note(path)
        recs = [r for r in records if r["month"] == m]
        if not recs and not note["deleted"]:
            continue
        mine = [r for r in recs if r["path"] in gone_now]
        compacted = note["compacted"]
        # A record already listed as deleted in the note was counted when it was deleted.
        new_ingest = [r for r in mine if r["kind"] == "run" and r["rkind"] == "ingest"
                      and r["name"] not in note["deleted"]]
        if new_ingest:
            c = compacted or {"runs": 0, "clips": 0, "first": None, "last": None}
            dates = [d for d in [c["first"], c["last"]] if d] + [r["run_date"] for r in new_ingest]
            compacted = {"runs": c["runs"] + len(new_ingest), "clips": c["clips"] + sum(r["processed"] for r in new_ingest),
                         "first": min(dates), "last": max(dates)}
        keep_raw = list(note["keep_raw"])
        for r in mine:
            text = Path(r["path"]).read_text(encoding="utf-8")
            for raw in raw_mentions(text, raws):
                if not any(raw in t for t in corpus.values()):
                    keep_raw.append(raw)
        if mine and (not note["answer"] or note["answer"] == PLACEHOLDER):
            blocked.append(m)
        text = build_note(m, recs, gone_now, note, a.until, keep_raw, compacted, today, base, prs)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
            written.append(path.as_posix())
    if a.mode == "apply" and blocked:
        print(f"refusing to delete: write ## Answer first in {', '.join(f'{MONTHLY}/{m}.md' for m in blocked)}",
              file=sys.stderr)
        return 3
    print(json.dumps({"written": written, "deleted": sorted(gone_now)}, ensure_ascii=False, indent=1))
    if gone_now:
        git("rm", "-q", "--", *sorted(gone_now))
        names = sorted({Path(p).stem for p in gone_now})
        hits = git("grep", "-l", "-F", *sum((["-e", n] for n in names), []), "--", ".",
                   ":!raw", ":!archive", f":!{MONTHLY}", check=False).split()
        if hits:
            print("living references to review (repoint living docs; leave dated records):", file=sys.stderr)
            for h in hits:
                print(f"  {h}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
