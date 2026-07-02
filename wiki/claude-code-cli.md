---
type: concept
topics:
  - ai-agents
status: draft
sources:
  - "[[드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code]]"
---

# Claude Code (Coding Specialist)

집중된 코딩 작업자로 사용되는 CLI. [[multi-agent-orchestration]] 설정에서
[[hermes-orchestrator|Hermes]]가 터미널로 호출하는 코딩 전문가다.

## 위임 패턴

- Hermes가 `claude -p "task" --max-turns 10` 형태로 서브프로세스 호출.
- Claude Code가 자체 OAuth로 Claude Max 구독을 인증하므로 Anthropic API 크레딧을
  소모하지 않는다. Anthropic 입장에서는 사용자가 터미널에서 직접 명령을 입력하는
  것과 동일하게 보인다.
- 제3자 오케스트레이터와 함께 쓸 수 없다는 오해가 있으나, CLI 서브프로세스 실행은
  허용된다. 금지되는 것은 Claude 구독을 API로 직접 호출하는 모델 제공자로 쓰는 것.

## 청구 주의점

`claude -p` 프로그래밍 방식 사용에는 만료일과 버그가 있다. 반드시
[[subscription-vs-api-billing]]를 확인할 것.

## 관련 문서

- [[multi-agent-orchestration]]
- [[hermes-orchestrator]]
- [[subscription-vs-api-billing]]
