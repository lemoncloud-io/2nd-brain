---
type: project
status: active
goal: "PR 의 코드·설계·문서 변경을 의사결정 관점에서 리뷰하는 절차 스킬"
due:
milestones: []
next_action: ""
managed: vault-sync
origin: lemoncloud-io/knowledge@f68f1d38:projects/github/
---

# github

## Purpose

PR 을 리뷰하는 절차 스킬을 둔다. 핵심 질문은 "지시 없이 무엇을 결정했고, 그 결정이 요구·근거·권한에 맞는가"다.
정책·기본값·범위를 바꾼 결정을 근거와 대조하고, 여러 지표·필요한 다이어그램·독립 AI 교차 검증으로 평가한다. 단순 목록 조회나 이미 합의한 문구 교정에는 쓰지 않는다.

## 구성

- `config/skills/github-review/` — PR 리뷰 스킬. 본문 [SKILL.md](config/skills/github-review/SKILL.md), 점검 목록 [review-checklist.md](config/skills/github-review/references/review-checklist.md). 등록 레이어 `.claude/skills/github-review` 상대 심링크.

## Sync Notes

- `config/` 아래 파일은 출처 스탬프(`origin:`)가 있는 사본이다. 손으로 고치지 않는다. 바꿀 것이 있으면 볼트 운영자에게 요청한다.
