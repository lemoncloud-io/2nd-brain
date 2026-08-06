---
type: tool
topics:
  - ai-agents
status: needs-update
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-08-06"
updated: "2026-08-06"
---

# Claude Code Headless Mode

## Summary

`claude -p "작업 내용" --max-turns 10` 형태로 Claude Code CLI를 서브프로세스로 shell-out하여 헤드리스(비대화형)로 실행하는 방식. 별도 래퍼 없이 다른 터미널 명령어처럼 호출한다. Claude Code는 사용자의 Claude 구독(Max 등)에 대해 자체 OAuth로 인증하므로, [[hermes|Hermes]] 같은 오케스트레이터가 Anthropic API를 직접 건드리지 않고도 코딩 작업을 위임할 수 있다. Anthropic 입장에서는 사용자가 터미널에서 직접 `claude -p`를 입력한 것과 동일하게 보인다.

## Use Cases

- 오케스트레이터(Hermes 등)가 제한된 코딩 작업을 Claude Code에 위임하고 결과를 읽어 확인·보고.
- 더 긴 세션은 tmux에 진입해 Claude Code를 인터랙티브하게 실행하고 오케스트레이터가 모니터링.

## Setup Notes

- 할 수 없는 것: Claude 구독을 API 모델 제공자로 직접 호출하는 것 (오케스트레이터가 Anthropic API에 직접 붙는 방식).
- 할 수 있는 것: `claude` CLI를 서브프로세스로 실행하는 것 — 구독 인증이 유지된다.
- **billing 변경 (needs-update, 2026-05-14 편집분 기준)**: Anthropic이 2026-06-15부터 `claude -p` 및 Agent SDK 프로그래매틱 사용(-p, SDK, GitHub Actions, 서드파티 하네스)을 구독 풀에서 분리해 별도 월별 API 크레딧(Pro $20 / Max 5x $100 / Max 20x $200, 이월 없음)으로 청구한다고 발표했다. 터미널 인터랙티브 사용은 구독에 남는다. 실제 활성 경로는 `claude /status`와 `echo $ANTHROPIC_API_KEY`로 확인 가능하다고 언급된다.
- **알려진 버그 (needs-update)**: `ANTHROPIC_API_KEY`가 없어도 `claude -p` 헤드리스 모드가 일부 사용자에게 Max 구독 대신 API 요금으로 자동 전환되는 사례가 보고됨.
- **커뮤니티 보고 사례 (needs-update, 원문 댓글 기반)**: 커밋 메시지 등 페이로드에 서드파티 하네스 시그니처(예: "Hermes" 문자열)가 포함되면 Anthropic 백엔드 분류기가 이를 감지해 API 요금으로 청구한 사례가 보고됨 (금액 미상, 출처 불명확).
- PATH 설정: Hermes가 관리하는 Node 배포에서 `claude` 바이너리가 기본 PATH 밖에 위치할 수 있다 (`~/.hermes/node/bin/claude`).

## Related Concepts

- [[hermes|Hermes]]
- [[multi-agent-role-splitting|Multi-Agent Role Splitting]]

## Open Questions

- 2026-06-15 billing 분리 발표 이후 실제 적용 상태와 세부 요율은 원문 시점(2026-05 편집) 기준 정보이므로 최신 공식 문서로 재확인 필요 (needs-update).
- 하네스 시그니처 감지로 인한 API 과금 사례는 커뮤니티 댓글 기반 단편 정보로 공식 확인 없음 (needs-update).
