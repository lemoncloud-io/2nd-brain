---
type: weekly-report
created: "{{date}}"
period-start: "{{period-start}}"
period-end: "{{period-end}}"
# Vault Markdown notes use quoted wikilinks; raw paths, URLs, and other files stay strings.
sources: []
# origin: lemoncloud-io/knowledge@d035feac:templates/weekly-report.md
---

# 주간 보고서: {{period-start}} ~ {{period-end}}

## Summary

<!-- 주간을 관통하는 축 2~3개를 한 문단으로. -->

**핵심 발견**

<!-- 선택. 3~5개, 각 항목은 `- **한 줄 발견** — 근거 한 줄`. HTML 핵심 발견 카드의 유일한 출처다.
     품질·위험 발견은 HTML 에서 red 로 칠한다(templates/weekly-report.html 팔레트 주석).
     쓰지 않으면 이 「**핵심 발견**」 줄도 지운다 — HTML 은 그 섹션 제목과 카드를 모두 뺀다. -->

## Metrics

<!-- 수치는 git 전수 통계 명령 산출값만. vault 규모 줄을 넣는다면 볼트 루트에서
     `VAULT_DIR="$PWD" python3 projects/second-brain/config/scripts/vault_volume.py` 로 잰다 —
     셸의 VAULT_DIR 이 다른 경로를 가리키면 그곳의 총계가 들어간다.
     일별 커밋은 날짜 오름차순. -->

## Workstreams

<!-- 주제마다 `### n. 제목 (PR k건, 머지일 구간, PR 작성자)` 소절. 머지일 구간은 `MM-DD ~ MM-DD`
     (하루면 날짜 하나), 작성자가 여럿이면 « · » 로 잇는다. HTML 카드 메타 줄이 이 괄호 값을 쓴다.
     항목 본문에 PR 번호와 머지일을 적는다. -->

## New Assets

## Notes

## Follow-ups
