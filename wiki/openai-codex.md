---
type: concept
topics:
  - ai-agents
status: draft
sources:
  - "[[드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code]]"
---

# OpenAI Codex (Main Agent Brain)

[[multi-agent-orchestration]] 설정에서 메인 Hermes 두뇌 역할을 맡는 모델.
일반적인 앞뒤 조정과 도구 사용 등 오케스트레이터 측면을 잘 처리한다.

## 인증

- ChatGPT Pro($20) 구독을 통해 OpenAI OAuth로 [[hermes-orchestrator|Hermes]]를
  실행하면 API 키 없이 토큰당 요금 없이 사용 가능하다.
- 많이 쓰면 속도 제한이 걸리지만 추가 요금은 없다. 자세한 내용은
  [[subscription-vs-api-billing]] 참고.

## 알려진 이슈 (원문 댓글 기준)

- API 키를 설정하지 않은 ChatGPT/Codex 인증 흐름에서 `'NoneType' object is not
  iterable` 오류로 멈추는 사례 보고 → 대개 Hermes 버그이며 업데이트로 해결.

## 관련 문서

- [[multi-agent-orchestration]]
- [[hermes-orchestrator]]
- [[subscription-vs-api-billing]]
