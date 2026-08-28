---
type: run-log
kind: ingest
run_date: "2026-08-28"
author: louis-lemon
summary: "첫 ingest — 클리핑 2건을 wiki 3건(ai-agents 2, knowledge-management 1)으로 컴파일하고 ai-agents 토픽을 신설했다."
pr: 12
processed: 2
new_notes: 3
updated_notes: 0
tags: [ai-agents, knowledge-management]
sources:
  - "raw/Obsidian Web Clipper.md"
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
notes:
  - "[[orchestrator-specialist-split|Orchestrator-Specialist Split]]"
  - "[[hermes-agent|Hermes]]"
  - "[[obsidian-web-clipper|Obsidian Web Clipper]]"
---

# 2026-08-28 Ingest (louis-lemon)

## Summary

이 vault의 첫 ingest 실행. `Clippings/`에 대기 중이던 2건(Obsidian Web Clipper 제품
페이지, r/hermesagent의 멀티 에이전트 구성 사례)을 `raw/`로 옮기고 wiki 문서 3건을
새로 만들었다. 갱신된 기존 wiki 문서는 없다 — 실행 전 `wiki/`에 article이 0개였다.

## Details

**중복 게이트** — 실행 전 `raw/`에 frontmatter를 가진 파일이 0건이라 `source:` URL
중복은 발생할 수 없었다. 두 건 모두 신규 경로로 처리했다.

**파일명 정규화** — 두 파일 모두 이동 전에 이미 규칙을 만족했다: 금지 문자·emoji 없음,
95 bytes / 23 bytes로 120 bytes 이하, 한글 파일명은 NFC (`unicodedata.is_normalized`로
확인). 따라서 이름 변경 없이 `git mv`로 옮겼고 내용은 손대지 않았다.

**노트 설계** — Reddit 원문 1건에서 노트를 둘로 나눴다. 재사용 가능한 추상은
[[orchestrator-specialist-split|Orchestrator-Specialist Split]](`concept`)로, 특정 도구의
운용 지식(PATH 함정, tmux 운용, 구독 인증 경계)은 [[hermes-agent|Hermes]](`tool`)로
분리했다. Hermes는 이 vault 자체의 자동화 계층이라 도구 노트의 값이 크다고 판단했다.
`VAULT_RULES.md`의 `concept` 정의가 "abstract idea, pattern, or architecture"를 포함하므로
`pattern` 타입 대신 템플릿이 존재하는 `concept`을 썼다.

[[obsidian-web-clipper|Obsidian Web Clipper]]는 원문이 1.9 KB 제품 소개 페이지라
`status: stub`으로 남겼다. 350 단어를 채우려 원문에 없는 내용을 덧붙이지 않았다.

**토픽** — `ai-agents`를 root topic으로 신설하고 `wiki/TOPIC_MAP.md` § Root Topics와
`wiki/INDEX.md` § Topics에 등록했다. `knowledge-management` 토픽 페이지에는
Obsidian Web Clipper 링크를 추가했다.

**검증** — `vault_verify.py --lane ingest`로 공유 불변식을 판정했다. 결과는 PR 본문에
기록한다. `docs/raw-index.md`는 스크립트 생성 대상이라 손대지 않았고 (`vault-lint` 레인),
동결된 `docs/vault-ingest-log.md`도 수정하지 않았다.

## Dropped / Issues

- **PR 번호 예측** — 커밋을 3개로 쪼개지 않기 위해 `- Last Ingest:` 라인과 이 노트의
  `pr:` 필드에 다음 PR 번호(#12)를 예측해 적었다. 실제 번호가 다르면 PR 본문에서 정정한다.
- **시간 민감 주장 1건** — Anthropic의 2026-06-15 프로그래매틱 사용 청구 정책 변경은
  원문(2026-05-14 편집) 기준이며 1차 출처 미확인이다.
  [[orchestrator-specialist-split|§ Open Questions]]에 TODO로 표시했다.
- **무관한 미추적 경로** — 작업 트리에 `.playwright-mcp/`가 untracked로 남아 있다.
  이번 ingest와 무관해 스테이징하지 않았다.
