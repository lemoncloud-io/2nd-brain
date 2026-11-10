#!/usr/bin/env python3
# /// script
# dependencies = ["hwp-hwpx-parser"]
# ///
"""H1: hwp-hwpx-parser HWP/HWPX -> MD 직행 추출 랩퍼 (hwp2md-ingest).

usage: uv run h1-extract.py <file.hwp|file.hwpx> <out.md>
(uv가 PEP 723 메타데이터로 hwp-hwpx-parser를 자동 준비한다. 순수 Python —
 한컴오피스·JVM 불필요. 이미 설치된 환경이면 python3로 직접 실행해도 된다.)

stdout 마지막 줄에 판정용 통계를 출력한다:
  stats chars=<본문 문자수> tables=<표 수> images=<이미지 수> encrypted=<bool>
"""
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: uv run h1-extract.py <file.hwp|file.hwpx> <out.md>")
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if src.suffix.lower() not in (".hwp", ".hwpx"):
        sys.exit(f"unsupported extension: {src.suffix} (expected .hwp or .hwpx)")
    try:
        from hwp_hwpx_parser import Reader
    except ImportError:
        sys.exit("hwp-hwpx-parser not available — run with: uv run h1-extract.py <file> <out.md>")

    reader = Reader(str(src))
    try:
        if reader.is_encrypted:
            sys.exit("encrypted document — H1 불가 (암호 해제 후 재시도)")
        md = reader.extract_text()
        tables = reader.get_tables() or []
        images = reader.get_images() or []
    finally:
        reader.close()

    if not md.strip():
        sys.exit("empty conversion result")
    out.write_text(md, encoding="utf-8")
    chars = len("".join(md.split()))
    print(f"wrote {len(md)} chars -> {out}")
    print(f"stats chars={chars} tables={len(tables)} images={len(images)} encrypted=False")


if __name__ == "__main__":
    main()
