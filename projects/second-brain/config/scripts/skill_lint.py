#!/usr/bin/env python3
"""Lint SKILL.md files against the vault's skill authoring contract.

Contract: `docs/agent-skills-registration.md` § 7 (SKILL.md 검증 항목). Stdlib only.

    python3 projects/second-brain/config/scripts/skill_lint.py <SKILL.md | 폴더>...
    python3 projects/second-brain/config/scripts/skill_lint.py --changed --base "$(git merge-base HEAD origin/master)"
    python3 projects/second-brain/config/scripts/skill_lint.py --all [--json]

Errors (exit 1):
  E1 frontmatter `name`·`description` 존재, `name` 형식(≤64자, 소문자·숫자·하이픈) = 폴더명,
     `description` ≤ 1024자.
  E2 SKILL.md 500줄 이하.
  E3 SKILL.md의 상대 링크(Markdown 링크·`references/…` 경로)가 실제 파일로 풀린다.
Warnings (exit 0):
  W1 100줄 초과 SKILL.md는 첫 100줄 안에 트리거 절과 금지·경계 절 제목을 둔다(키워드 휴리스틱).
  W2 스킬 폴더 안의 참조 md가 100줄을 넘으면 첫 100줄 안에 목차를 둔다.

--changed: base 이후 바뀐(추가·수정·이름 변경·미추적) SKILL.md, 또는 바뀐 md를 폴더 안에
가진 스킬만 검사한다. --all: `git ls-files`의 SKILL.md 전부(raw/·archive/ 제외).
Exit codes: 0 오류 없음, 1 오류 있음, 2 실행 불가(git 실패·잘못된 인자).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

# 계약 수치 — 표준 스펙(name·description)과 볼트 계약(500줄·100줄)
NAME_MAX = 64
DESCRIPTION_MAX = 1024
BODY_MAX_LINES = 500
HEAD_LINES = 100
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_FILE = "SKILL.md"
SKIP_PREFIXES = ("raw/", "archive/")  # append-only 영역은 고칠 수 없으니 검사하지 않는다

# 절 제목 휴리스틱 키워드 — 소문자로 비교한다
TRIGGER_KEYWORDS = ("트리거", "언제", "사용 시점", "when to use", "when to invoke", "trigger",
                    "use when", "invocation")
BOUNDARY_KEYWORDS = ("하지 않는", "금지", "경계", "범위 밖", "제외", "boundaries", "boundary",
                     "out of scope", "not for", "do not", "don't", "never", "guardrail", "hard rule",
                     "하드 룰")
TOC_KEYWORDS = ("목차", "차례", "contents", "table of contents", "toc")

FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
MDLINK_RE = re.compile(r"!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
REFPATH_RE = re.compile(r"(?<![\w./-])references/[^\s`'\")\]]*")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
ANCHOR_ITEM_RE = re.compile(r"^\s*[-*+]\s+\[[^\]]+\]\(#[^)]+\)")
PLACEHOLDER_RE = re.compile(r"[<>{}*$]")
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def _strip_fences(lines: list[str]) -> list[tuple[int, str]]:
    """코드 펜스 밖의 (줄 번호, 내용)만 돌려준다."""
    out, fence = [], None
    for n, line in enumerate(lines, 1):
        m = FENCE_RE.match(line)
        # 펜스 여닫기 줄은 버리고 상태만 바꾼다
        if m:
            if fence is None:
                fence = m.group(1)
            elif m.group(1) == fence:
                fence = None
            continue
        if fence is None:
            out.append((n, line))
    return out


def parse_frontmatter(lines: list[str]) -> tuple[dict[str, str], int] | None:
    """맨 위 `---` 블록의 최상위 키 → 값(블록 스칼라는 접어서)과 닫는 줄 번호. 없으면 None."""
    if not lines or lines[0].strip() != "---":
        return None
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None
    fields: dict[str, str] = {}
    key, parts, block = None, [], ""
    # 키 하나가 끝날 때 값을 확정한다
    def flush():
        if key is None:
            return
        joiner = "\n" if block.startswith("|") else " "
        value = joiner.join(p.strip() for p in parts if p.strip()).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        fields[key] = value
    # 최상위 키 줄과 그 아래 들여쓴 이어짐 줄을 모은다
    for raw in lines[1:end]:
        m = re.match(r"^([A-Za-z_][\w-]*):(?:\s+(.*))?\s*$", raw)
        if m and not raw[:1].isspace():
            flush()
            key, rest = m.group(1), (m.group(2) or "").strip()
            block = rest if re.match(r"^[|>][+-]?\d*$", rest) else ""
            parts = [] if block else [rest]
        elif key is not None and (raw[:1].isspace() or not raw.strip()):
            parts.append(raw)
    flush()
    return fields, end + 1


def _headings(lines: list[str], limit: int) -> list[str]:
    """첫 limit 줄 안, 펜스 밖의 절 제목(소문자)."""
    return [m.group(1).lower() for n, line in _strip_fences(lines[:limit])
            if (m := HEADING_RE.match(line))]


def _has_keyword(headings: list[str], keywords: tuple[str, ...]) -> bool:
    """제목 가운데 하나라도 키워드를 담으면 참."""
    return any(k in h for h in headings for k in keywords)


def _link_targets(lines: list[str]) -> list[tuple[int, str]]:
    """펜스 밖 상대 링크 대상(줄 번호, 경로): Markdown 링크와 `references/…` 경로."""
    out = []
    for n, line in _strip_fences(lines):
        # Markdown 링크는 인라인 코드 안의 예시를 빼고 본다
        for m in MDLINK_RE.finditer(INLINE_CODE_RE.sub("", line)):
            target = m.group(1)
            if target.startswith(("#", "/")) or SCHEME_RE.match(target):
                continue
            out.append((n, unquote(target.split("#", 1)[0].split("?", 1)[0])))
        # references/ 경로는 백틱 안에 적히는 일이 많아 인라인 코드도 본다
        for m in REFPATH_RE.finditer(line):
            out.append((n, m.group(0).split("#", 1)[0].rstrip(".,;:")))
    # 같은 줄의 같은 대상은 한 번만, 자리 표시자는 뺀다
    seen, uniq = set(), []
    for n, t in out:
        if t and not PLACEHOLDER_RE.search(t) and (n, t) not in seen:
            seen.add((n, t))
            uniq.append((n, t))
    return uniq


def has_toc(lines: list[str]) -> bool:
    """첫 100줄 안에 목차 제목이나 앵커 링크 목록(2개 이상)이 있으면 참."""
    if _has_keyword(_headings(lines, HEAD_LINES), TOC_KEYWORDS):
        return True
    anchors = sum(1 for _, line in _strip_fences(lines[:HEAD_LINES]) if ANCHOR_ITEM_RE.match(line))
    return anchors >= 2


def lint_skill(skill_md: Path, root: Path | None = None) -> dict:
    """SKILL.md 하나를 검사해 {path, errors, warnings}를 돌려준다."""
    shown = str(skill_md.relative_to(root)) if root and skill_md.is_relative_to(root) else str(skill_md)
    result = {"path": shown, "errors": [], "warnings": []}
    errors, warnings = result["errors"], result["warnings"]
    try:
        lines = skill_md.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        errors.append(f"E0 읽을 수 없다: {exc}")
        return result
    folder = skill_md.parent

    # E1 frontmatter 계약
    fm = parse_frontmatter(lines)
    if fm is None:
        errors.append("E1 frontmatter(--- 블록)가 없다")
    else:
        fields, _ = fm
        name, desc = fields.get("name", ""), fields.get("description", "")
        if not name:
            errors.append("E1 frontmatter `name`이 없다")
        else:
            if len(name) > NAME_MAX or not NAME_RE.match(name):
                errors.append(f"E1 `name: {name}` 형식 위반(≤{NAME_MAX}자, 소문자·숫자·하이픈, 연속·양끝 하이픈 금지)")
            if name != folder.name:
                errors.append(f"E1 `name: {name}`이 폴더명 `{folder.name}`과 다르다")
        if not desc:
            errors.append("E1 frontmatter `description`이 없다")
        elif len(desc) > DESCRIPTION_MAX:
            errors.append(f"E1 `description`이 {len(desc)}자다(최대 {DESCRIPTION_MAX}자)")

    # E2 줄 수 상한
    if len(lines) > BODY_MAX_LINES:
        errors.append(f"E2 SKILL.md가 {len(lines)}줄이다(최대 {BODY_MAX_LINES}줄, 상세는 references/로)")

    # E3 상대 링크 해석 — 스킬 폴더(실제 위치) 기준
    base = folder.resolve()
    refs: list[Path] = []
    for n, target in _link_targets(lines):
        path = (base / target).resolve()
        if not path.exists():
            errors.append(f"E3 {SKILL_FILE}:{n} 링크 `{target}`이 파일로 풀리지 않는다")
        elif path.is_file() and path.suffix == ".md" and path.is_relative_to(base) and path not in refs:
            refs.append(path)

    # W1 첫 100줄의 트리거·경계 절
    if len(lines) > HEAD_LINES:
        heads = _headings(lines, HEAD_LINES)
        if not _has_keyword(heads, TRIGGER_KEYWORDS):
            warnings.append(f"W1 {len(lines)}줄인데 첫 {HEAD_LINES}줄 안에 트리거 절 제목(언제·트리거·When to use)이 없다")
        if not _has_keyword(heads, BOUNDARY_KEYWORDS):
            warnings.append(f"W1 {len(lines)}줄인데 첫 {HEAD_LINES}줄 안에 금지·경계 절 제목(하지 않는 것·금지·경계·Boundaries)이 없다")

    # W2 스킬 폴더 안 참조 md의 목차
    for ref in refs:
        try:
            ref_lines = ref.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        if len(ref_lines) > HEAD_LINES and not has_toc(ref_lines):
            rel = ref.relative_to(base)
            warnings.append(f"W2 참조 `{rel}`이 {len(ref_lines)}줄인데 첫 {HEAD_LINES}줄 안에 목차가 없다")
    return result


def _git(root: Path, *args: str) -> list[str]:
    """git 명령을 돌려 출력 줄을 돌려준다. 실패하면 RuntimeError."""
    # encoding="utf-8": Windows 기본 코드 페이지에서 git 출력(한글 경로)이 깨지지 않게 한다(이 폴더 git 호출 공통).
    proc = subprocess.run(["git", "-C", str(root), "-c", "core.quotepath=off", *args],
                          capture_output=True, text=True, encoding="utf-8", timeout=120)
    if proc.returncode != 0:
        head = proc.stderr.strip().splitlines()
        raise RuntimeError(head[0] if head else f"git {args[0]} failed")
    return [line for line in proc.stdout.splitlines() if line.strip()]


def _skill_of(root: Path, rel: str) -> Path | None:
    """파일이 속한 스킬의 SKILL.md(가장 가까운 상위 폴더) — 없으면 None."""
    path = root / rel
    for folder in [path.parent, *path.parent.parents]:
        if folder == root or not folder.is_relative_to(root):
            break
        if (folder / SKILL_FILE).is_file():
            return folder / SKILL_FILE
    return None


def changed_skills(root: Path, base: str) -> list[Path]:
    """base 이후 바뀐 SKILL.md와, 바뀐 md를 폴더 안에 가진 스킬의 SKILL.md."""
    changed = _git(root, "diff", "--name-only", "--diff-filter=AMR", base, "--", "*.md")
    changed += _git(root, "ls-files", "--others", "--exclude-standard", "--", "*.md")
    out: set[Path] = set()
    # 바뀐 md마다 소속 스킬을 찾는다
    for rel in changed:
        if rel.startswith(SKIP_PREFIXES):
            continue
        skill = _skill_of(root, rel)
        if skill is not None:
            out.add(skill)
    return sorted(out)


def all_skills(root: Path) -> list[Path]:
    """추적된 SKILL.md 전부(raw/·archive/ 제외)."""
    tracked = _git(root, "ls-files", "--", f"*{SKILL_FILE}", SKILL_FILE)
    return sorted(root / p for p in tracked
                  if Path(p).name == SKILL_FILE and not p.startswith(SKIP_PREFIXES))


def expand(paths: list[str]) -> list[Path]:
    """인자 경로를 SKILL.md 목록으로 — 폴더면 그 아래 SKILL.md를 모두 찾는다."""
    out: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            out += sorted(p.rglob(SKILL_FILE))
        elif p.is_file():
            out.append(p)
        else:
            raise FileNotFoundError(raw)
    return out


def lint_many(skills: list[Path], root: Path | None = None) -> list[dict]:
    """여러 SKILL.md를 검사한 결과 목록."""
    return [lint_skill(s.resolve() if root is None else s, root) for s in skills]


def main(argv: list[str] | None = None) -> int:
    """명령행 진입점 — 결과를 사람용 또는 JSON으로 출력한다."""
    parser = argparse.ArgumentParser(description="Lint SKILL.md files (docs/agent-skills-registration.md § 7).")
    parser.add_argument("paths", nargs="*", help="SKILL.md 또는 스킬 폴더")
    parser.add_argument("--changed", action="store_true", help="--base 이후 바뀐 스킬만")
    parser.add_argument("--base", default="HEAD", help="--changed의 기준 ref (기본 HEAD)")
    parser.add_argument("--all", action="store_true", help="추적된 SKILL.md 전부")
    parser.add_argument("--root", default=".", help="저장소 루트 (기본 현재 폴더의 git 루트)")
    parser.add_argument("--json", action="store_true", help="JSON 출력")
    args = parser.parse_args(argv)
    if not (args.paths or args.changed or args.all):
        parser.error("경로, --changed, --all 가운데 하나가 필요하다")

    # 대상 SKILL.md 목록을 모은다
    try:
        root = Path(_git(Path(args.root), "rev-parse", "--show-toplevel")[0]).resolve()
        skills: list[Path] = []
        if args.all:
            skills += all_skills(root)
        if args.changed:
            skills += changed_skills(root, args.base)
        skills += [p.resolve() for p in expand(args.paths)]
    except (RuntimeError, FileNotFoundError, OSError, subprocess.SubprocessError) as exc:
        print(f"skill_lint: 실행할 수 없다: {exc}", file=sys.stderr)
        return 2
    skills = sorted(set(skills))
    results = lint_many(skills, root)
    n_err = sum(len(r["errors"]) for r in results)
    n_warn = sum(len(r["warnings"]) for r in results)

    # 출력 — JSON 또는 파일별 목록
    if args.json:
        print(json.dumps({"skills": len(results), "errors": n_err, "warnings": n_warn,
                          "files": [r for r in results if r["errors"] or r["warnings"]]},
                         ensure_ascii=False, indent=2))
    else:
        for r in results:
            if not (r["errors"] or r["warnings"]):
                continue
            print(r["path"])
            for e in r["errors"]:
                print(f"  ERROR {e}")
            for w in r["warnings"]:
                print(f"  WARN  {w}")
        print(f"skill_lint: {len(results)} skill(s), {n_err} error(s), {n_warn} warning(s)")
    return 1 if n_err else 0


if __name__ == "__main__":
    raise SystemExit(main())
