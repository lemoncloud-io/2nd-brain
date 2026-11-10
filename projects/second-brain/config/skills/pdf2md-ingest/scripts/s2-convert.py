#!/usr/bin/env python3
# /// script
# dependencies = ["pymupdf4llm"]
# ///
"""S2: pymupdf4llm PDF -> MD 변환 랩퍼 (pdf2md-ingest).

usage: uv run s2-convert.py <pdf> <out.md>
(uv가 PEP 723 메타데이터로 pymupdf4llm을 자동 준비한다.
 pymupdf4llm이 이미 설치된 환경이면 python3로 직접 실행해도 된다.)
"""
import sys


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: uv run s2-convert.py <pdf> <out.md>")
    try:
        import pymupdf4llm
    except ImportError:
        sys.exit("pymupdf4llm not available — run with: uv run s2-convert.py <pdf> <out.md>")
    md = pymupdf4llm.to_markdown(sys.argv[1])
    if not md.strip():
        sys.exit("empty conversion result")
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(md)
    print(f"wrote {len(md)} chars -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
