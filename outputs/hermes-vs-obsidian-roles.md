# Hermes vs Obsidian — 역할 분담

이 볼트(AI Second Brain)에서 두 도구가 어떻게 나뉘는지 정리.

## Obsidian — 저장소 & 뷰어

- 볼트의 마크다운 파일을 열람·탐색하는 UI
- `[[wikilinks]]` 그래프 네비게이션
- 프론트매터(`type`, `status`, `topics`, `sources`) 기반 필터링·검색
- 사람이 직접 노트를 읽고, 브라우징하고, 수동 편집할 때 쓰는 도구

## Hermes — 실행 엔진 & AI 에이전트

- 볼트를 대상으로 자동화된 워크플로우를 실행하는 주체
- 핵심 스킬 세 가지:
  - **vault-ingest** — `Clippings/` 인박스 → `raw/` 원문 보존 + `wiki/` 개념 추출 + `topics/` 색인 + INDEX·MEMORY 갱신
  - **vault-query** — wiki 지식 기반 질의응답, 보존할 답변은 `outputs/`에 저장
  - **vault-lint** — 볼트 품질 점검 + `VAULT_MEMORY.md` 업데이트
- 디렉토리 계약을 강제하는 주체 (`raw/` 수정 금지, 중복 방지, 출처 보존 등)
- 모델 중립 — GPT, Claude, Codex 어느 LLM이든 같은 규칙으로 동작

## 한 줄 요약

| 구분 | Obsidian | Hermes |
| --- | --- | --- |
| 역할 | 사람이 보는 인터페이스 | 볼트를 읽고 쓰고 관리하는 AI 작업자 |
| 조작 방식 | 수동 열람·편집 | 자동 처리 (ingest, query, lint) |
| 공유 계층 | 같은 마크다운 파일시스템 | 같은 마크다운 파일시스템 |
