#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
"""d1-extract.py 회귀 테스트. 픽스처를 pandoc으로 즉석 생성하므로 외부 파일이 없다.

usage: uv run test-d1-extract.py
- D1(.docx): 표·헤딩·이미지 계수, 제목 추출, media 상대경로화, 절대경로 미유출
- D2(.doc): .doc 픽스처는 macOS textutil로 만든다 — 그래서 macOS에서만 돈다.
  D2a/D2c(구조 보존)면 헤딩·표 유지, D2b면 구조 손실 신호(headings=0)와 경고 출력
- 인자 파싱: 잘못된 플래그 형식 거부
- 순수 함수: relativize_media(양 구분자)·leaked_absolute·count_images·visible_chars
"""
import base64
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "d1-extract.py"
PY = sys.executable

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

FIXTURE_MD = """---
title: 설비 점검 절차서
---

# 1. 점검 주기

- 매일 09:00
- 매월 첫째 주

# 2. 점검 항목

| 항목 | 기준치 | 담당 |
|---|---|---|
| 냉각수 온도 | 18.5 ℃ | 공무팀 |
| 펌프 압력 | 3.2 bar | 공무팀 |

# 3. 도면

![배관 도면](pipe.png)

설비코드 CLG-A3-07 기준.
"""

failures: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)


def run_script(*args: str) -> tuple[int, str, str]:
    p = subprocess.run([PY, str(SCRIPT), *args], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def stats(stdout: str) -> dict[str, str]:
    lines = [l for l in stdout.splitlines() if l.startswith("stats ")]
    if not lines:
        sys.exit("no stats line in output — script probably failed; see FAIL lines above")
    line = lines[-1]
    # title= 은 마지막 키이고 공백을 포함할 수 있다 — 앞 5개 키만 공백으로 자른다
    return dict(kv.split("=", 1) for kv in line[len("stats "):].split(" ", 5))


def unit_tests() -> None:
    """플랫폼 무관 순수 함수 검사 — Windows 구분자 형태를 macOS에서도 검증한다."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("d1", SCRIPT)
    d1 = importlib.util.module_from_spec(spec); spec.loader.exec_module(d1)

    win = Path("C:\\Users\\홍길동\\scratch")
    md = "![a](C:\\Users\\홍길동\\scratch\\media\\r1.png) ![b](C:/Users/홍길동/scratch/media/r2.png)"
    out = d1.relativize_media(md, win)
    check(out == "![a](media/r1.png) ![b](media/r2.png)", f"relativize handles both separators (got {out})")
    check(not d1.leaked_absolute(out, win), "no leak after relativize")
    check(d1.leaked_absolute("![x](C:\\foo\\a.png)", None), "detects Windows absolute link")
    check(d1.leaked_absolute("![x](/private/tmp/a.png)", None), "detects posix absolute link")
    check(d1.leaked_absolute("![x](file:///tmp/a.png)", None), "detects file: URI link")
    check(not d1.leaked_absolute("본문에 D:\\백업 폴더 이야기. ![x](media/a.png)", None),
          "prose mentioning a drive path is not a leak")
    check(d1.count_images("![a](x) <img src='y'>") == 2, "count_images: md + raw img")
    check(d1.visible_chars("<span>가 나</span> 다") == 3, "visible_chars strips tags and spaces")


def main() -> None:
    unit_tests()
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "pipe.png").write_bytes(PNG_1PX)
        (work / "fixture.md").write_text(FIXTURE_MD, encoding="utf-8")
        docx = work / "fixture.docx"
        subprocess.run(
            ["pandoc", "-f", "markdown", "-t", "docx", str(work / "fixture.md"),
             "-o", str(docx), f"--resource-path={work}"],
            check=True,
        )

        # ── D1 ──────────────────────────────────────────
        out = work / "d1.md"
        media = work / "m1"
        rc, so, se = run_script(str(docx), str(out), f"--media-dir={media}")
        check(rc == 0, "D1 exits 0")
        s = stats(so)
        check(s["path"] == "D1", "D1 path")
        check(s["tables"] == "1", f"D1 tables=1 (got {s['tables']})")
        check(s["headings"] == "3", f"D1 headings=3 (got {s['headings']})")
        check(s["images"] == "1", f"D1 images=1 (got {s['images']})")
        check(s["title"] == "설비 점검 절차서", f"D1 title (got {s['title']})")
        check(int(s["chars"]) > 50, "D1 chars counted")
        md = out.read_text(encoding="utf-8")
        check("media/" in md and str(media) not in md, "D1 media path relativized, no absolute leak")
        check("<img" not in md and "<span" not in md, "D1 no raw html")
        check("CLG-A3-07" in md and "℃" in md, "D1 proper nouns and units intact")
        check(any((media / "media").glob("*")), "D1 media files extracted under DIR/media/")

        # ── 플래그 파싱 ────────────────────────────────
        rc, _, se = run_script(str(docx), str(work / "x.md"), "--media-dir", str(media))
        check(rc != 0, "space-separated --media-dir rejected")
        rc, _, se = run_script(str(docx), str(work / "x.md"), "--bogus=1")
        check(rc != 0 and "unknown flag" in se, "unknown flag rejected")

        # ── D2b (macOS textutil 있을 때만) ───────────────
        if shutil.which("textutil"):
            doc = work / "legacy.doc"
            subprocess.run(["textutil", "-convert", "doc", str(docx), "-output", str(doc)], check=True)
            out2 = work / "d2.md"
            rc, so, se = run_script(str(doc), str(out2), f"--media-dir={work / 'm2'}")
            check(rc == 0, "D2 exits 0")
            s2 = stats(so)
            check(s2["path"] in ("D2a", "D2b", "D2c"), f"D2 path (got {s2['path']})")
            if s2["path"] in ("D2a", "D2c"):
                check(s2["headings"] == "3", f"{s2['path']} keeps headings (got {s2['headings']})")
                check(s2["tables"] == "1", f"{s2['path']} keeps table")
            if s2["path"] == "D2b":
                check(s2["headings"] == "0", "D2b headings=0 (structure-loss signal)")
                check("warning: D2b" in se, "D2b warning emitted on stderr")
                md2 = out2.read_text(encoding="utf-8")
                check("<span" not in md2, "D2b no span residue")
                check("냉각수 온도" in md2, "D2b content intact")
        else:
            print("skip D2b (no textutil)")

    print()
    if failures:
        sys.exit(f"{len(failures)} failure(s): " + "; ".join(failures))
    print("all passed")


if __name__ == "__main__":
    main()
