---
type: concept
topics:
  - ai-agents
status: needs-update
sources:
  - "[[드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code]]"
---

# Subscription vs API Billing

[[multi-agent-orchestration]] 설정의 핵심 비용 절감 원리: 토큰당 과금되는 API
대신 정액제 구독(OAuth) 인증을 유지하면 추가 요금이 발생하지 않는다.

## 정액제 유지 방법

- **ChatGPT Pro($20)**: OpenAI OAuth로 [[hermes-orchestrator|Hermes]] 실행.
  API 키 없음, 토큰당 요금 없음. 많이 쓰면 속도 제한만 걸린다.
- **Claude Max($100)**: [[claude-code-cli|Claude Code]]가 자체 OAuth로 인증.
  API 비용 없음.
- 피해야 할 것: Hermes를 OpenAI API 키나 Anthropic API에 직접 연결하는 것.
- API 키를 굳이 추가한다면 제공업체 결제 대시보드에서 월 최대 사용 금액을 먼저
  설정하는 것이 싼 보험이다.

## 청구 이스케이프 해치 (주의)

원문 저자가 지적한 두 가지 조용한 API 라우팅 경로:

1. **`-p` 헤드리스 버그**: `ANTHROPIC_API_KEY`가 없어도 `claude -p` 헤드리스
   모드가 Max 구독 대신 API 요금으로 자동 전환되는 알려진 버그.
2. **하네스 시그니처**: 페이로드/커밋 메시지에 `Hermes`/`HERMES.md` 같은 제3자
   하네스 시그니처가 있으면 Anthropic 백엔드 분류기가 제3자 하네스 사용으로
   플래그해 API 요금을 청구한 documented case가 있다(약 $200).

### 점검 방법

- `claude /status` 실행
- `echo $ANTHROPIC_API_KEY` 확인
- platform.claude.com에서 예상치 못한 API 사용량 확인
- 프로젝트 파일에 "Hermes" 문자열이 있는지 스캔

## 정책 변경 타임라인 (needs-update)

- **2026-06-15부터**: Anthropic이 `claude -p` 및 Agent SDK 사용을 Claude 구독
  풀에서 분리. 각 티어는 별도 월별 크레딧(Pro $20, Max 5x $100, Max 20x $200)을
  받으며 이월 불가. 터미널의 대화형 Claude Code는 구독에 유지되지만, 프로그래밍
  방식(-p, SDK, GitHub Actions, 타사 하네스)은 새 크레딧 풀로 이동.
- 원문 저자는 만료일 이후를 대비해 대화형 tmux 세션 사용으로 재작업 중.

> [!TODO] 2026-06-15 이후 실제 청구 동작 및 tmux 회피책의 유효성을 원문 후속
> 게시물로 확인 필요.

## 관련 문서

- [[multi-agent-orchestration]]
- [[hermes-orchestrator]]
- [[claude-code-cli]]
- [[openai-codex]]
