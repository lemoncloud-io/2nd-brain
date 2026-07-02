---
type: concept
topics:
  - ai-agents
status: draft
sources:
  - "[[드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code]]"
---

# Hermes (Orchestrator)

항상 켜져 있는 코디네이터 에이전트. [[multi-agent-orchestration]] 패턴에서
오케스트레이터 및 자동화 계층 역할을 맡는다.

## 보유 기능

- 메모리, 도구, 예약 작업(cron), 메시징
- 실제 컴퓨터 작업 수행: 이메일 전송, 스크립트 실행, 파일 확인, Telegram 소통,
  cron 관리, 작업 조정
- 터미널에서 [[claude-code-cli|Claude Code]]를 서브프로세스로 호출하고 결과를
  읽어 검증

## 위임 방식

Hermes는 래퍼 없이 `claude` CLI로 직접 셸 아웃한다:

```
claude -p "여기에 작업" --max-turns 10
```

Claude Code가 자체 OAuth로 Max 구독을 인증하므로 Hermes는 Anthropic API를
직접 건드리지 않는다. 자세한 청구 주의점은 [[subscription-vs-api-billing]] 참고.

## 설치 주의점

- Hermes 관리 Node는 `~/.hermes/node/bin/claude`에 바이너리를 두는데 기본
  PATH에 없다. bashrc에 추가하거나 `~/.local/bin/`으로 심볼릭 링크해 두면 깔끔히
  찾는다.
- 긴 세션은 tmux로 Claude를 인터랙티브 실행하고 Hermes가 모니터링한다.

## 관련 문서

- [[multi-agent-orchestration]]
- [[claude-code-cli]]
- [[openai-codex]]
