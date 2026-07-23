---
type: tool
topics:
  - ai-agents
status: stub
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-07-23"
updated: "2026-07-23"
---

# Hermes

## Summary

Hermes는 항상 켜진 코디네이터로 동작하는 AI 에이전트 프레임워크다. 메모리, 도구, 예약 작업, 메시징을 보유하고 로컬 시스템에서 실제 작업(이메일 발송, 스크립트 실행, 파일 확인, cron 관리)을 수행하며, 코딩 같은 특화 작업은 외부 전문가 CLI에 위임한다. [[multi-agent-orchestration|Multi-Agent Orchestration]] 패턴의 오케스트레이터 계층 역할을 맡는다.

## Use Cases

- 사용자 요청을 받아 직접 처리할지 전문가에게 위임할지 판단하는 오케스트레이션
- Telegram 등 인터페이스를 통한 원격 제어 및 도구 조정
- cron/webhook/event 기반 자동화 트리거 실행
- 외부 CLI 전문가 호출·결과 검증·간단한 테스트 실행 후 보고

## Setup Notes

- OpenAI OAuth(ChatGPT 구독)로 실행하면 토큰당 API 과금 없이 사용할 수 있으며, 메인 두뇌로 OpenAI Codex를 붙이는 구성이 소개된다.
- [[claude-code|Claude Code]]를 서브프로세스로 셸 아웃하는 방식(`claude -p "task" --max-turns N`)으로 코딩 작업을 위임한다. 래퍼 없이 직접 서브프로세스 호출이 가능하다.
- Hermes가 관리하는 Node는 `~/.hermes/node/bin/claude`에 바이너리를 두는데 기본 PATH에 없으므로, PATH 추가 또는 `~/.local/bin/`으로 심볼릭 링크가 필요하다.
- 긴 세션은 `claude -p` 대신 tmux 인터랙티브 세션을 Hermes가 모니터링하는 방식이 권장된다 (needs-update: 소스는 이를 제공업체 정책 변경 대응책으로 언급).

## Related Concepts

- [[multi-agent-orchestration|Multi-Agent Orchestration]]
- [[claude-code|Claude Code]] (needs-update: 아직 별도 노트 없음)

## Open Questions

- Hermes 자체의 스킬 시스템이 라우팅 패턴을 학습해 시간이 지날수록 빨라진다는 주장의 실제 메커니즘
- OAuth/구독 인증 경로가 API 과금 경로로 조용히 전환되는 알려진 버그(`claude -p` 헤드리스, 하네스 시그니처)에 대한 안정적 회피책
