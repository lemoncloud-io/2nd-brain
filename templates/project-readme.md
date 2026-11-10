---
type: project
status: active
# review: 검토 관문 — 사용자 검토가 끝나기 전에 머지됐으면 pending, 통과하면 confirmed. 키가 없으면 confirmed.
#   pending이면 review_since(머지일) · review_gate(무엇이 되면 걷는가, 한 줄 300 bytes) 필수, review_ref는 기준 문서.
#   next_action 첫 항목 = 관문 통과 행위 · 계약: docs/project-review.md
# review: pending
# review_since: "YYYY-MM-DD"
# review_gate: ""
# review_ref: ""
goal: ""
due:
# milestones: 체크포인트마다 한 항목. 이름은 라벨만 — 300 bytes 이하 · 근거는 본문
#   `## Milestone Notes`나 outputs/ 리포트로 · 계약: docs/project-milestones.md
milestones: []
# next_action: 다음 행위가 한 건이면 문자열, 두 건 이상이면 한 줄에 한 건씩 목록으로.
#   항목 300 bytes 이하 · 순서가 우선순위 · 계약: docs/project-next-action.md
next_action: ""
# related: 다른 프로젝트와의 관계 — 뒤에 생긴 쪽만 적는다. 낱말: follows · depends_on · shares · split_from
#   예: "[[projects/<slug>/README|이름]] — follows" · 계약: docs/project-lifecycle.md
related: []
# origin: lemoncloud-io/knowledge@f68f1d38:templates/project-readme.md
---

# {{title}}

## Status

<!-- 상태 서술. 가리키는 목록·폴더의 개수(N건·N개)는 적지 않는다 — 항목이 늘 때마다 이 줄을 고치게 되고
     (같은 줄을 고치는 PR끼리 충돌), 안 고치면 거짓이 된다. 수는 그 목록을 가진 문서나 날짜 박힌 실측에
     둔다. 수가 필요하면 vault_tally.py나 프로젝트의 --tally 명령으로 센다 · 계약: VAULT_RULES.md § Live tallies -->

## Purpose

## Done When

<!-- 이 프로젝트가 끝났다고 말할 수 있는 상태 — 판정 가능한 문장 몇 줄. 열 때 쓴다.
     새 능력이 붙어 이 조건을 고쳐야 한다면 새 프로젝트다 — 계약: docs/project-lifecycle.md -->

## Current Context

## Checklist

<!-- 선택 절. 체크리스트를 쓰면 처음부터 다섯 요소를 갖춘다 — 계약: docs/project-checklist.md
     ① 핵심 질문 한 문장  ② 마일스톤마다 **목적**·**목표**
     ③ 항목: `- [ ] **P0** <행위구>` + 다음 줄 `  - 왜: <핵심 한 구절>` (짧게, 근거는 본문으로)
     ④ 등급 범례(P0 최소 검증·필수 / P1 권장 / P2 선택, 개수 포함) + P0만으로 이어지는 최소 경로
     ⑤ 조건부 승격은 "왜:" 줄 끝에 "(조건) 시 P0" -->

## Related Wiki

## Log

## Outputs

<!-- 위키·최종 보고서 같은 상위 산출물만 적는다. 날짜 붙은 outputs/ 문서는 outputs/README.md의
     폴더 색인(`## Document Map` 절 + `docmap: folder` 표식)이 받는다 — PR마다 여기에 줄을 더하지
     않는다(같은 자리에 줄을 더하는 PR끼리 충돌한다). 그 README가 아직 없으면 첫 산출물을 낼 때
     projects/<name>/outputs/README.md 에 표식을 넣어 만들고 여기서 한 줄로 가리킨다(색인 README가
     INDEX에서 닿아야 유효하다) · 계약: VAULT_RULES.md § Reachability -->
