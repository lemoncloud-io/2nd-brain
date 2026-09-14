---
type: lint-report
created: "2026-08-28"
scope: vault
---

# Vault Lint Report - 2026-08-28

## Summary

직전 pass(2026-07-31) 이후 4주 만의 두 번째 pass. 그 사이 vault-sync 3회
(`@01f358b`·`@45f6b0f`·`@e5a3687`)로 스킬 계층이 크게 바뀌었고, 이번 pass의
발견은 대부분 그 변화가 계약 문서·인덱스에 아직 반영되지 않은 드리프트다.

- 점검 대상: `raw/`·`archive/`를 제외한 tracked Markdown 56개 (`wiki/` 전문, 그 외 frontmatter)
- 발견: **P1 1건 / P2 3건 / P3 1건** (총 5건). P0 없음
- 공유 불변식(`vault_verify.py --lane none`): **PASS** — memory 크기, `- Last …:` 마커,
  `raw/`·`archive/` append-only
- `docs/raw-index.md` 재생성 완료: 루트 파일 0, 오펀 0, source URL 중복 0
- 이 vault는 아직 부트스트랩 상태다 — wiki article 0개, `raw/` 0건, 인제스트 실행 0회.
  콘텐츠 계열 검사(고아 문서, 중복 개념, 모순, 과밀 topic)는 대상이 없어 전부 공집합이다.

## Issues

### P1

**1. `ollama-local-models.md`에 frontmatter가 없다**
`projects/second-brain/config/skills/ollama-local-models.md`는 15개 스킬 중 유일하게
frontmatter 블록 자체가 없다 (`name`·`description`·`origin` 전부 결손). 나머지 14개는
모두 갖추고 있다. `docs/agent-skills-registration.md` § SKILL.md 스펙에서 `name`과
`description`은 필수 필드이므로, 이 스킬은 Agent Skills 표준에 미달하고 Claude Code의
스킬 발견에도 잡히지 않는다. `origin` 부재로 upstream 추적도 끊긴다.

### P2

**2. `VAULT_RULES.md`가 동결된 원장을 여전히 run-log 목적지로 규정한다**
§ Core Rules는 "Per-run narrative is appended to `docs/vault-ingest-log.md`"라고 적고
있으나, `@45f6b0f` sync 이후 실제 계약은 `outputs/runs/<date>-ingest-<slug>.md` 노트
생성이고 `docs/vault-ingest-log.md`는 동결이다 (`vault-ingest-claude.md` job spec,
`vault-ingest-once.md`, `vault-promote.md`가 일관되게 그렇게 규정). **권위 있는 계약
문서가 스킬과 모순되는 상태**다. 이 파일은 production vault에서 동기화되므로 수정은
upstream이 정본이다.

**3. `wiki/VAULT_MEMORY.md`의 실행 이력 포인터가 같은 드리프트를 반복한다**
머리말("실행 이력은 `docs/vault-ingest-log.md`")과 § Current State의
`Ingest history:` 줄이 모두 동결된 원장을 가리킨다. 2번과 같은 원인이며, 이쪽은
vault 로컬 상태 파일이라 이 저장소에서 바로 고칠 수 있다. 이번 pass에서는 lint 계약상
`Last Lint Pass:`와 `Verification queue`만 손대므로 수정하지 않고 올린다.

**4. GitHub 연결 프로젝트의 동기화 상태가 36일 낡았다**
`projects/@lemoncloud-io/2nd-brain/README.md`의 `last_synced: 2026-07-23`, `next_action`은
이미 끝난 "링크 워크플로우 검증"을 가리킨다. 그 사이 PR #6–#13이 merge되며 스킬 6종 추가,
`vault_verify.py` 도입, 온보딩 스크립트 신설이 있었다. `status`·`goal`·`next_action`
변경은 사용자 승인 사안(`docs/github-linked-projects.md`)이므로 리포트에만 올린다.

### P3

**5. topic page가 wiki article 대신 인덱스를 링크한다**
`wiki/topics/knowledge-management.md`의 `## Related Notes`가 `[[wiki/INDEX|Wiki Index]]`
하나만 담고 있다. 계약(`VAULT_RULES.md` § Note Contracts)상 topic body는 관련 wiki
article 목록이다. article이 0개인 현재로서는 자리표시자로 기능하므로, 첫 인제스트가
article을 만들 때 교체하면 된다.

## Stub Notes

없음. `wiki/`에 개념 문서가 아직 0개이며, `status: stub`·`status: draft` 노트도 0건이다.
stub 경계(draft인데 본문 1,200자 미만 / stub인데 그 이상인데 결손 사유 없음) 위반 없음.

## Broken Links

없음. `wiki/` 내 wikilink는 2개이며 모두 해석된다.

- `[[wiki/INDEX|Wiki Index]]` → `wiki/INDEX.md` ✓
- `[[wiki/topics/knowledge-management|Knowledge Management]]` → `wiki/topics/knowledge-management.md` ✓

escaped-pipe alias(`[[note\|Alias]]`) 0건, `sources`에 raw 파일을 wikilink로 넣은 사례 0건.
`VAULT_RULES.md`·`CLAUDE.md`·`templates/`·`projects/*/config/skills/`의 wikilink는 문법
예시이므로 해석 대상에서 제외했다.

## Topic Split Candidates

없음. topic page 1개(`knowledge-management`), 링크된 article 0개로 분할 임계(10개)와 무관하다.

## Recommended Fixes

| # | 조치 | 소관 |
| --- | --- | --- |
| 1 | `ollama-local-models.md`에 `name`·`description`·`origin` frontmatter 추가 | 이 저장소에서 수정 가능 — 단, upstream에도 같은 결손이 있으면 그쪽이 정본 |
| 2 | `VAULT_RULES.md` § Core Rules의 run-log 목적지를 `outputs/runs/`로 정정 | upstream 수정 후 sync |
| 3 | `wiki/VAULT_MEMORY.md`의 실행 이력 포인터 2곳을 `outputs/runs/`로 정정 | 이 저장소, 별도 커밋 (lint 계약 밖) |
| 4 | `github-project-sync`로 `last_synced`·`next_action` 갱신 제안 → 사용자 승인 | 사용자 승인 사안 |
| 5 | 첫 인제스트 시 topic page의 `## Related Notes`를 실제 article로 교체 | 인제스트 워크플로우가 자연 해소 |

## Clean Checks

아래 항목은 위반 0건으로 통과했다.

- 노트 계열 frontmatter 존재·필수 필드 (제어 문서·시스템 문서는 대상 외)
- 스킬 `name`이 부모 디렉터리명과 일치 (폴더형 스킬 3종)
- 크로스 플랫폼 파일명: 금지 문자·제어 문자·끝 점/공백·예약어(CON/PRN/AUX/NUL/COM/LPT)·
  대소문자 경로 충돌
- 머신 절대경로(`/Users/…`, `/home/…`) 유입
- `raw/` 오펀 파일, source URL 중복
- `.claude/skills/` 심링크 3개 해석 (`pdf2md-ingest`·`hwp2md-ingest`·`doc2md-ingest`)
