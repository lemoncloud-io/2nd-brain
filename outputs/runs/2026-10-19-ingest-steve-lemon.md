---
type: run-log
kind: ingest
run_date: "2026-10-19"
author: steve-lemon
summary: "클리핑 1건(Hermes·Codex·Claude Code 역할 분리 사례) ingest — 신규 wiki 2건, topic ai-agents 신설"
pr:
processed: 1
new_notes: 2
updated_notes: 0
tags:
  - ai-agents
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
notes:
  - "[[wiki/orchestrator-specialist-agent-split|오케스트레이터-전문가 에이전트 분리]]"
  - "[[wiki/hermes-agent|Hermes Agent]]"
---

# Ingest 2026-10-19

## Summary

`Clippings/`의 미처리 클리핑 1건(Reddit 게시글: Hermes Agent를 오케스트레이터로, OpenAI Codex를 주 모델로, Claude Code를
코딩 전문가로 나눈 개인 설정)을 처리했다. 원문은 `raw/`로 무수정 이동했고, 패턴 노트 1건과 도구 노트 1건을 새로 만들었다.

## Details

- **중복 게이트**: `raw/`가 비어 있어 같은 `source:` URL이 없었다 — 신규 노트로 처리.
- **파일명 정규화**: 원래 이름이 95바이트·NFC이고 금지 문자·smart punctuation·emoji가 없어 이름 변경 없이 이동했다.
- **노트 설계**: 원문의 핵심은 "모델 하나에 모든 역할을 맡기지 않는다"는 구성 패턴이라 `type: pattern` 노트
  [[wiki/orchestrator-specialist-agent-split|오케스트레이터-전문가 에이전트 분리]]에 담았다. 이 볼트 자동화가 기대는 Hermes는
  wiki 노트가 없었으므로 [[wiki/hermes-agent|Hermes Agent]]를 `stub`으로 만들었다 — 근거가 사용자 경험담 하나뿐이다.
  Claude Code·OpenAI Codex는 별도 노트를 만들지 않고 패턴 노트 안에서만 다뤘다.
- **topic**: 기존 topic(`aws-serverless` 등)에 맞지 않아 [[wiki/topics/ai-agents|AI Agents]]를 새로 만들고 `wiki/INDEX.md`·
  `wiki/TOPIC_MAP.md`에 올렸다.
- **제외한 내용**: 댓글 작성자 이름, 개인 요금제 지출 세부, 모델 버전 추측 등 일회성 잡담은 옮기지 않았다.
- **raw 색인**: ingest 레인은 `docs/raw-index.*`를 재생성하지 않는다 — 다음 lint 패스가 갱신한다.

## Dropped / Issues

- 과금 관련 주장(2026-06-15 프로그래밍 호출 분리, 헤드리스 모드 과금 버그, 하네스 문자열 분류)은 원문·댓글 주장으로만 기록했다
  — 공식 확인 전까지 패턴 노트 `## Open Questions`에 남긴다.
- `Clippings/`가 비면 git이 폴더를 추적하지 않아 새 클론에서 볼트 루트 추론 조건(`Clippings/` 존재)이 깨지므로
  `Clippings/.gitkeep`을 두었다.
