---
type: tool
topics:
  - ai-agents
status: stub
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-08-28"
updated: "2026-08-28"
---

# Hermes

## Summary

항상 켜져 있는(always-on) 에이전트 오케스트레이터. 메모리, 도구, 예약 작업(cron),
메시징을 보유하고 로컬 머신에서 실제 작업을 수행한다 — 이메일 발송, 스크립트 실행,
파일 확인, Telegram 소통, cron 관리, 작업 조정. 모델 제공자는 프로필로 교체 가능하며,
출처 사례는 ChatGPT Pro OAuth 기반 OpenAI Codex를 메인 모델로 썼다. 이 vault의
자동화 계층이기도 하다 (`VAULT_RULES.md` § Automation Priority).

## Use Cases

- [[orchestrator-specialist-split|Orchestrator-Specialist Split]]의 오케스트레이터 계층 —
  작업을 직접 처리할지 코딩 전문가에게 위임할지 판단하고, 결과를 검증해 보고한다
- 이 vault에서는 ingest·lint 트리거, 동시 실행 lock, Claude 가용성 확인, Claude 실패 시
  native fallback, 결과 검증을 담당한다 (`vault-ingest-claude` 스킬)
- Telegram을 인터페이스로 붙여 원격에서 시스템 전체를 제어

## Setup Notes

- **Claude Code 위임에 래퍼가 필요 없다.** `claude -p "task" --max-turns 10`으로 셸 아웃하면
  Claude Code가 자기 구독 OAuth를 처리한다. Anthropic 쪽에서는 사용자가 터미널에서 직접
  입력한 것과 동일하게 보인다.
- **PATH 함정** — Hermes가 관리하는 Node는 `claude` 바이너리를 `~/.hermes/node/bin/claude`에
  떨어뜨리는데 기본 PATH에 없다. 출처는 bashrc에 추가하고 `~/.local/bin/`으로 심볼릭
  링크해 해결했다.
- **긴 세션은 tmux로** — 헤드리스 `claude -p` 대신 tmux 세션에서 Claude를 대화형으로 띄우고
  Hermes가 모니터링한다. 2026-06-15 구독 정책 변경 이후 출처가 택한 경로다
  ([[orchestrator-specialist-split|§ Open Questions]] 참조).
- **피해야 할 구성** — Hermes를 OpenAI API 키나 Anthropic API에 직접 연결하면 토큰당 과금이
  시작된다. 양쪽 모두 OAuth/구독 인증을 유지해야 정액제로 남는다.

## Related Concepts

- [[orchestrator-specialist-split|Orchestrator-Specialist Split]]
- [[wiki/topics/ai-agents|AI Agents]]

## Open Questions

- 오케스트레이터 모델의 주간 rate limit 소진 대비 백업 제공자 구성 (출처도 미구현)
- 이 vault의 Hermes 연동에서 `vault_ingest_once.py` job spec이 브랜치/커밋/PR 단계를
  갖지 않는 문제 — `wiki/VAULT_MEMORY.md` § Open Threads와 같은 항목
