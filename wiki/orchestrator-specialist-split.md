---
type: concept
topics:
  - ai-agents
status: draft
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-08-28"
updated: "2026-08-28"
---

# Orchestrator-Specialist Split

## Summary

하나의 모델에 모든 역할을 몰아넣는 대신, **조정(orchestration)과 전문 실행(specialist)을
서로 다른 에이전트에 분리**하는 멀티 에이전트 구성 패턴. 각 계층이 자기 구독·인증 경계를
그대로 유지한 채 CLI 서브프로세스로 연결되므로, 모델을 하나의 "메인 두뇌" 슬롯에 억지로
끼우지 않아도 된다. 출처는 실제 개인 운용 사례 보고(r/hermesagent, 2026-05)다.

## Details

**계층 구성** — 출처가 제시한 5계층:

| 계층 | 담당 | 사례의 구현 |
| --- | --- | --- |
| 오케스트레이터 | 메모리, 도구 호출, 예약 작업, 메시징, 작업 위임 | Hermes |
| 메인 에이전트 모델 | 일반적인 왕복 조정과 도구 사용 | OpenAI Codex (ChatGPT Pro OAuth) |
| 코딩 전문가 | 한정된 코딩 작업의 작성·검토·수정 | Claude Code (Claude Max 구독) |
| 실행 환경 | 파일·cron·이메일·shell·Home Assistant | 로컬 머신 |
| 인터페이스 | 원격 제어 | Telegram |

**작업 흐름** — ① 사용자가 오케스트레이터에 요청 → ② 오케스트레이터가 직접 처리할지
코딩 전문가에게 위임할지 판단 → ③ 전문가가 코드 작업 수행 → ④ 오케스트레이터가 결과
확인·간단한 테스트 실행·시스템 연결 후 보고.

**연결은 래퍼가 아니라 서브프로세스다.** 출처의 구현은 별도 어댑터 없이
`claude -p "task" --max-turns 10`으로 셸 아웃한다. Claude Code가 자기 OAuth를 스스로
처리하므로 오케스트레이터는 Anthropic API를 직접 건드리지 않는다. 이 vault의
`vault-ingest-claude` 스킬이 Hermes에서 Claude Code를 호출하는 방식과 같은 구조다.

**로컬 LLM 대안은 기각됐다.** 출처는 Ollama 로컬 실행을 시도했고 "기술적으로는 작동하지만
전체 에이전트 사용에는 너무 느리다"고 보고했다. 저사양 하드웨어에서 작은 로컬 모델로
전 계층을 대체하려는 시도보다 역할별 최적 도구 조합이 낫다는 것이 핵심 주장이다.

## Connections

- [[hermes-agent|Hermes]] — 이 패턴의 오케스트레이터 계층 구현
- [[obsidian-web-clipper|Obsidian Web Clipper]] — 같은 분리 원칙이 지식 파이프라인에도
  적용된다: 수집(clipper)과 컴파일(에이전트)을 다른 계층이 맡는다
- [[wiki/topics/ai-agents|AI Agents]]

## Open Questions

- **구독 경계가 이동 중이다 (needs-update, 2026-05-14 기준 원문 편집).** Anthropic이
  2026-06-15부터 `claude -p`와 Agent SDK 사용을 Claude 구독 풀에서 분리하고 티어별 월간
  크레딧(Pro $20 / Max 5x $100 / Max 20x $200, 이월 없음)으로 API 요금 청구한다고
  발표했다. 터미널 대화형 Claude Code는 구독에 남는다. 출처는 대화형 tmux 세션으로
  재작업 중이라고 밝혔다. **TODO: 2026-06-15 이후 실제 청구 동작을 1차 출처로 재확인할 것.**
- **조용한 API 라우팅 탈출구 2건** (출처 보고, 미검증):
  ① `ANTHROPIC_API_KEY`가 없는데도 `claude -p` 헤드리스가 구독 대신 API 요금으로
  전환되는 버그, ② 페이로드에 남은 하네스 시그니처(예: 커밋 메시지의 `HERMES.md`)가
  제3자 하네스 사용으로 분류돼 API 과금된 사례. 점검 방법으로 `claude /status`,
  결제 대시보드의 예상치 못한 API 사용량 확인, 프로젝트 파일의 하네스 문자열 스캔을 든다.
- 오케스트레이터 모델의 rate limit 소진 시 백업 모델(OpenRouter 경유 DeepSeek·Gemini
  Flash 등)로의 자동 failover는 출처에서도 미구현 — 수동 전환 단계에 머물러 있다.
