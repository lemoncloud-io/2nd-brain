---
type: concept
topics:
  - ai-agents
status: draft
sources:
  - "[[드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code]]"
---

# Multi-Agent Orchestration

하나의 모델이 하나의 채팅 창 안에서 모든 것을 처리하도록 강요하는 대신, 역할을
분담해 여러 에이전트/모델을 협업시키는 패턴. 원 출처는 이를 "싱글 모델 함정
(single-model trap)"이라 부르며, 대부분의 사용자가 여기서 막힌다고 지적한다.

## 핵심 아이디어

- 각 역할에 가장 적합한 도구를 배정한다.
- 오케스트레이터가 작업을 분해하고 전문가에게 위임한 뒤 결과를 검증한다.
- 성능이 낮은 하드웨어에서 로컬 LLM 하나로 전부 처리(예: Ollama)하려는 시도보다
  실용적으로 잘 동작한다.

## 역할 분담 예시

| 역할 | 도구 |
| --- | --- |
| 오케스트레이터 / 자동화 계층 | [[hermes-orchestrator\|Hermes]] |
| 메인 에이전트 두뇌 | [[openai-codex\|OpenAI Codex]] |
| 코딩 전문가 | [[claude-code-cli\|Claude Code]] |
| 실행 환경 | 로컬 머신 |
| 원격 제어 인터페이스 | Telegram |

## 워크플로우

1. 사용자가 오케스트레이터에게 요청한다.
2. 오케스트레이터가 직접 처리할지 전문가에게 위임할지 결정한다.
3. 코딩 전문가가 코드를 작성/검토/수정한다.
4. 오케스트레이터가 결과를 확인하고 테스트를 실행한 뒤 보고한다.

댓글에서 언급된 변형: 오케스트레이터가 충분한 검증 사이클을 거치면 언제/어떻게
작업을 라우팅할지 스킬로 학습해 시간이 갈수록 빨라진다. 일부 사용자는 TDD +
JiT + 수직 슬라이스 원칙과 다중 모델 수렴 패스(계획→구현→검토→QA)를 조합한다.

## 관련 문서

- [[hermes-orchestrator]]
- [[openai-codex]]
- [[claude-code-cli]]
- [[subscription-vs-api-billing]]
