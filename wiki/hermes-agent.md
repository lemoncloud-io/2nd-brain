---
type: tool
topics:
  - ai-agents
status: stub
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
related:
  - "[[wiki/orchestrator-specialist-agent-split|오케스트레이터-전문가 에이전트 분리]]"
created: "2026-10-19"
updated: "2026-10-19"
---

# Hermes Agent

## Summary

Hermes Agent는 항상 켜 두고 쓰는 개인용 에이전트 오케스트레이터다. 메모리·도구·예약 작업(cron)·메시징을 갖고 있어 셸 명령,
파일 확인, 메일 발송, 스크립트 실행을 컴퓨터에서 직접 수행하고, Telegram 같은 메신저로 원격 지시를 받는다. 모델 제공자는
바꿔 끼울 수 있다 — 원문 사례는 OpenAI Codex를 구독 인증으로 연결해 주 모델로 쓴다.

## Use Cases

- 다른 에이전트에게 일을 넘기고 결과를 확인하는 조정자 — 코딩은 Claude Code CLI를 서브프로세스로 호출해 맡긴다
  ([[wiki/orchestrator-specialist-agent-split|오케스트레이터-전문가 에이전트 분리]]).
- 예약 작업과 메신저 인터페이스를 묶은 개인 자동화.
- 이 볼트에서는 지식 컴파일을 Claude Code에 위임하고, Claude Code를 쓸 수 없을 때 직접 처리하는 실행자다
  (`VAULT_RULES.md` § Automation Priority).

## Setup Notes

- Hermes가 관리하는 Node가 설치한 `claude` 바이너리는 기본 `PATH`에 없을 수 있다 — 셸 설정에 경로를 추가하거나
  `~/.local/bin/`에 링크를 건다(원문 작성자 경험).
- 주 모델이 속도 제한에 걸리면 도구 호출 부담 때문에 대화형 사용보다 주간 한도를 빨리 소진할 수 있다(댓글 주장, 미검증).

## Related Concepts

- [[wiki/orchestrator-specialist-agent-split|오케스트레이터-전문가 에이전트 분리]]

## Open Questions

- 공식 문서 기준의 설치·제공자 설정 절차 — 이 노트는 사용자 경험담 하나만 근거로 한다.
- 다중 프로필·에이전트 간 통신 구성(댓글 언급)의 실제 지원 범위.
