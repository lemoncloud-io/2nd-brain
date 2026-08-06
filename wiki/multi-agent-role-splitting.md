---
type: pattern
topics:
  - ai-agents
status: draft
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-08-06"
updated: "2026-08-06"
---

# Multi-Agent Role Splitting

## Summary

하나의 모델이 하나의 채팅 창에서 모든 일(오케스트레이션·추론·코딩)을 다 하게 만드는 대신, 각 역할에 가장 적합한 모델/도구를 따로 배정하는 패턴. 이른바 "싱글 모델 함정(single model trap)"을 피하는 것이 핵심이다. 예시 스택:

- **[[hermes|Hermes]]**: 항상 켜져 있는 오케스트레이터·자동화 계층
- **OpenAI Codex**: 메인 추론/에이전트 두뇌
- **[[claude-code-headless-mode|Claude Code]]**: 구독 기반 코딩 전문가 (서브프로세스로 위임)
- **로컬 머신**: 실행 환경
- **Telegram**: 원격 제어 인터페이스

## Details

워크플로우는 다음 순서로 진행된다:

1. 사용자가 오케스트레이터(Hermes)에게 원하는 것을 말한다.
2. 오케스트레이터가 직접 처리할지, 코딩 전문 에이전트에 위임할지 결정한다.
3. 코딩 전문 에이전트가 코드를 작성·검토·수정한다.
4. 오케스트레이터가 결과를 확인하고, 간단한 테스트를 실행하고, 시스템에 연결하고 보고한다.

원문 저자는 성능이 낮은 하드웨어에서 로컬 LLM(Ollama) 하나로 모든 역할을 대체하려는 시도가 기술적으로는 동작하지만 에이전트 전체 사용에는 너무 느렸다고 언급한다. 각 역할에 맞는 도구를 쓰는 편이 로컬 단일 모델로 모든 것을 강제하는 것보다 낫다는 것이 핵심 주장이다.

댓글 스레드에서는 이 패턴의 변형도 확인된다: Opus/GPT 두 계열을 병렬로 굴려 한쪽이 수렴 경로를 계획하고 다른 쪽이 최종 합성을 담당하는 방식, 또는 TDD + JIT + 수직 슬라이스 원칙 위에서 "플래너 모델이 다음 청크를 정의 → 구현 모델이 청크를 구현 → 리뷰 모델이 빠르게 검토"를 마일스톤 단위로 반복하고 마지막에 QA 모델이 전체 마일스톤을 검토하는 구조도 언급된다. 이 변형들은 한 커뮤니티 댓글의 단편적 설명으로, 구체적 구현은 원문에 없다 (needs-update).

## Connections

- [[hermes|Hermes]] — 오케스트레이터 역할의 구체 사례
- [[claude-code-headless-mode|Claude Code Headless Mode]] — 코딩 전문가 위임에 쓰이는 구체적 메커니즘

## Open Questions

- Opus/GPT 이중 계열 + TDD/JIT/수직 슬라이스 변형 워크플로우의 구체적 구현 방식 (needs-update, 원문 댓글 기반 단편 정보).
