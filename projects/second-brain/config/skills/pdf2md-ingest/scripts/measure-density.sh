#!/usr/bin/env bash
# 페이지별 텍스트 레이어 밀도(공백 제거 문자수) 측정 — pdf2md-ingest 라우팅 입력
# usage: measure-density.sh <pdf>
# 기준: 300자 미만 = image-dominant (변환 전략 벤치마크의 페이지 밀도 실측에서 정한 경계)
set -euo pipefail

PDF="${1:?usage: measure-density.sh <pdf>}"
[ -f "$PDF" ] || { echo "not found: $PDF" >&2; exit 1; }

PAGES=$(pdfinfo "$PDF" | awk '/^Pages:/{print $2}')
[ -n "$PAGES" ] || { echo "pdfinfo failed" >&2; exit 1; }

echo "pages: $PAGES"
LOW=0
for p in $(seq 1 "$PAGES"); do
  N=$(pdftotext -f "$p" -l "$p" "$PDF" - 2>/dev/null | tr -d '[:space:]' | wc -c | tr -d ' ')
  FLAG=""
  if [ "$N" -lt 300 ]; then FLAG=" image-dominant"; LOW=$((LOW+1)); fi
  echo "p$p: $N$FLAG"
done
echo "image-dominant: $LOW/$PAGES"
