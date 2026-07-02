---
name: vault-query
description: >
  사용자의 knowledge vault에 쿼리를 던져 wiki 기반 답변을 받는다. 사용자가 vault
  안의 개념·비교·정리를 물어볼 때 이 스킬을 사용한다. (단순 잡담이나 볼트와
  무관한 질문에는 사용하지 않는다.)
---

# Vault Query (Hermess-native)

이 스킬은 Hermess의 현재 모델이 GPT이든 Claude이든 같은 방식으로 wiki 기반
답변을 생성하도록 만든 provider-agnostic 지시서다.

## 언제 사용하는가

- 사용자가 vault에 저장된 개념/도구/모델에 대해 질문할 때
- 여러 wiki 아티클을 종합해야 하는 질문일 때
- 사용자가 "내 vault 기준", "저장된 문서 기준", "wiki 기준", "Obsidian 기준"처럼
  vault 근거를 명시할 때

## 절차

`VAULT_DIR` 기본값은 `~/knowledge`다. 실제 vault가 다른 위치라면 해당 경로를
`VAULT_DIR`로 간주한다. 사용자가 `VAULT_DIR`를 명시하면 그 값을 우선한다.
명시되지 않았지만 현재 작업 루트가 Obsidian vault 구조(`wiki/`, `raw/`,
`outputs/`)를 갖고 있으면 현재 작업 루트를 `VAULT_DIR`로 추론한다. 확신할 수
없으면 답변을 생성하기 전에 사용자에게 vault 경로를 확인한다.

1. 사용자의 질문을 임의로 축약하지 말고 원문 그대로 작업 범위로 유지한다.
2. `$VAULT_DIR/wiki/VAULT_MEMORY.md`와
   `$VAULT_DIR/wiki/INDEX.md`를 먼저 읽는다.
3. 질문과 관련된 `wiki/` 문서, `wiki/topics/` 페이지, 필요 시 최근 `outputs/`를 읽는다.
4. 답변은 vault 안의 근거를 우선한다. vault에 없는 내용은 추론임을 명시한다.
5. `$VAULT_DIR/outputs/`가 없으면 먼저 생성한다.
6. 답변 문서를 `$VAULT_DIR/outputs/YYYY-MM-DD-query-slug.md`에 저장한다.
7. 저장된 파일을 다시 확인한다.
8. 최종 응답에는 핵심 답변과 저장된 output 파일 경로를 함께 알려준다.

## 답변 문서 형식

```markdown
# <Question title>

## Answer

<concise answer in Korean>

## Evidence

- [[related-note-1]]
- [[related-note-2]]

## Notes

- Vault에 없는 내용은 "추론" 또는 "추가 확인 필요"로 표시한다.
```

## 트리거 예시

- "내 vault 기준으로 Hermes와 Obsidian의 역할 차이를 정리해줘."
- "저장된 wiki 문서 기준으로 multi-agent orchestration의 핵심 패턴을 요약해줘."
- "이 vault에 정리된 OpenAI Codex와 Claude Code의 차이를 비교해줘."
- "subscription-vs-api-billing 문서를 근거로 비용 리스크를 정리해줘."
- "ai-agents 토픽에 있는 문서들을 종합해서 다음 액션을 추천해줘."
- "최근 outputs까지 참고해서 이 주제의 결론만 다시 요약해줘."

## 금지 사항

- 질문 내용을 임의로 재해석하거나 요약해서 축약된 프롬프트로 바꾸지 않는다
- 답변을 vault 밖(예: 채팅 로그만)에 남기고 `outputs/`에 저장하지 않는 것은
  금지 — 지식이 누적되지 않기 때문이다
- output markdown 파일을 생성하거나 갱신하기 전에는 작업을 완료하지 않는다
- `raw/` 원문을 수정하지 않는다
- vault에 근거가 없는데 단정적으로 답하지 않는다
