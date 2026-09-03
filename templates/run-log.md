---
type: run-log
kind: ingest            # ingest | promotion | maintenance
run_date: "{{date}}"
author:                 # 작업자 slug (gh login)
summary: ""             # 한 줄 요약, 200 bytes 이하 — runs.base 표와 검색 결과에 그대로 노출
pr:                     # PR 번호 (숫자만)
processed: 0            # 처리한 클리핑/문서/대상 수
new_notes: 0            # 신규 wiki 노트 수
updated_notes: 0        # 갱신 wiki 노트 수
tags: []                # 주제 태그 — 새 태그보다 기존 태그 재사용 우선
# sources: 처리한 원문 — raw 경로·URL은 문자열, vault 노트는 quoted wikilink
sources: []
# notes: 산출/갱신한 wiki 노트 — quoted wikilinks ("[[slug|Alias]]")
notes: []
# origin: lemoncloud-io/knowledge@2bebda4:templates/run-log.md
---

# {{title}}

## Summary

<!-- summary 한 줄의 확장 — 무엇을 처리했고 무엇이 나왔나. -->

## Details

<!-- 배치 판정, 노트 설계 근거, 검증 내용. 상세는 본문에 자유롭게 —
     frontmatter summary만 200 bytes 예산을 지킨다. -->

## Dropped / Issues

<!-- 탈락 대상과 사유, 남은 needs-update, 후속. 없으면 "없음". -->
