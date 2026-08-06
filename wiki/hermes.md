---
type: tool
topics:
  - ai-agents
status: draft
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-08-06"
updated: "2026-08-06"
---

# Hermes

## Summary

Hermes는 항상 켜져 있는(always-on) AI 에이전트 코디네이터다. 메모리, 도구, 예약 작업(cron), 메시징을 보유하고 실제로 로컬 컴퓨터에서 작업을 수행할 수 있다 — 이메일 발송, 스크립트 실행, 파일 확인, Telegram을 통한 소통, cron 관리 등. 단일 모델이 모든 것을 처리하게 하는 대신, Hermes는 오케스트레이터 역할만 맡고 실제 추론/코딩은 다른 전문 모델에 위임하는 구성에서 중심축이 된다. 이 vault 자체도 Hermes와 Obsidian으로 운영된다 (`VAULT_RULES.md` 참조).

## Use Cases

- 사용자 요청을 받아 직접 처리할지, 코딩 전문 에이전트(예: Claude Code)에 위임할지 판단하는 오케스트레이터.
- 터미널에서 `claude` CLI로 shell-out하여 헤드리스 모드(`claude -p "작업" --max-turns 10`)로 코딩 작업을 위임하고 결과를 검증·보고.
- Telegram을 원격 제어 인터페이스로 사용해 어디서든 시스템에 접근.
- 긴 세션은 tmux 세션에 진입해 Claude를 인터랙티브하게 실행하고 Hermes가 모니터링.

## Setup Notes

- Hermes가 관리하는 Node 배포는 `claude` 바이너리를 `~/.hermes/node/bin/claude`에 두는데 기본 PATH에 없다. bashrc에 추가하거나 `~/.local/bin/`으로 심볼릭 링크해야 Hermes가 찾을 수 있다.
- Hermes를 OpenAI API 키나 Anthropic API에 직접 연결하면 토큰당 과금이 시작된다. OAuth/구독 인증을 유지하는 한 정액제로 동작한다. 자세한 과금 경계는 [[claude-code-headless-mode|Claude Code Headless Mode]] 참고.

## Related Concepts

- [[multi-agent-role-splitting|Multi-Agent Role Splitting]]
- [[claude-code-headless-mode|Claude Code Headless Mode]]

## Open Questions

- Hermes의 스킬 시스템이 Hermes-Claude Code 검증 사이클을 반복하며 라우팅 패턴을 학습한다는 커뮤니티 언급이 있으나, 구체적 메커니즘은 원문에 없다 (needs-update).
