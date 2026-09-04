---
type: project
status: active
goal: "Prepare and operate this sandbox as the initial environment for a future real knowledge vault."
due:
milestones:
  - name: "Initialize required vault control files"
    due: 2026-07-08
    done: true
  - name: "Clarify Hermes/Claude automation workflows"
    due: 2026-07-08
    done: true
  - name: "Sync the operating rule layer from the production vault"
    due: 2026-08-14
    done: true
next_action: "Run the first clipping ingest and verify raw/wiki/index/memory/ingest-log updates."
---

# second-brain

## Status

Active. This project maintains the vault structure, operating rules, and automation workflows.

## Purpose

Use the resolved `$VAULT_DIR` (the cloned vault root) as the setup and testing environment for a future production knowledge folder.

## Current Context

- The vault root is resolved by `CLAUDE.md` § Vault Root; `VAULT_RULES.md` is the contract layer.
- Ingest and lint should prefer Claude Code when available, with Hermes-native fallback when Claude is unavailable.
- Deployment values (mail recipients, default reviewer, vault display name, trigger phrase) live in
  `config/team-settings.yaml`; skills reference them by key. Replace them after cloning.
- The first pending ingest source is currently in `Clippings/`.

## Related Wiki

- [[wiki/INDEX|Wiki Index]]
- [[wiki/topics/knowledge-management|Knowledge Management]]

## Log

- 2026-07-08: Initialized required control files and clarified Claude-first automation policy.
- 2026-07-29: 실행 이력을 `wiki/VAULT_MEMORY.md`에서 `docs/vault-ingest-log.md`로 분리 —
  memory는 8 KB 예산의 상태·포인터 문서로 고정하고, `Last Ingest:` 한 줄만 교체한다.
- 2026-08-07: attention-budget 재배치 — `VAULT_RULES.md`의 § Wiki Frontmatter·§ Work Layer
  Frontmatter·§ Topic Pages·§ Templates를 § Note Contracts로 통합, § Session Start·
  § Vault Root Resolution은 `CLAUDE.md`로 이관, GitHub 계약은 `docs/github-linked-projects.md`로
  분리. `AGENTS.md`는 `CLAUDE.md` 포인터로 축소해 규칙 3중 복제를 제거.
- 2026-08-11: `private/` 개인 스크래치 공간 도입 — `.gitignore`에 `private/` 추가(git
  비추적), `templates/private-note.md` 신설, `config/skills/private-note.md` 스킬 추가
  (`private/YYYY-MM-DD.md` 생성·이어쓰기). `areas/daily/`(팀 공유)와 별개이며 내용을
  팀 공유 경로로 승격하려면 사용자 명시 확인이 필요.
- 2026-08-12: `areas/weekly/` 주간 보고서 레인 신설 — `templates/weekly-report.{md,html}`
  템플릿, `config/skills/vault-weekly-report.md` 스킬(git 전수 통계 집계 절차) 추가.
  md가 진실원, 같은 이름 `.html` 뷰를 나란히 저장.
- 2026-08-12: `config/team-settings.yaml` 신설 — 팀 스킬은 범용 절차, 조직·개인 배포
  값(수신자·리뷰어·vault 표시명·트리거 문구)은 이 파일에서 키로 참조 (VAULT_RULES
  Core Rules 등록). ingest·github-project 스킬의 리뷰어 하드코딩도 `github.default_reviewer`
  참조로 전환.
- 2026-08-14: `raw/` 계약 정밀화 — `docs/raw-layout.md` 신설(레인 구분, append-only 정의,
  파일명 정규화, ingest 게이트), `config/scripts/generate_raw_index.py`로 `docs/raw-index.md`를
  생성하고 `vault-lint`가 재생성·검사하도록 편입.
- 2026-08-14: 운영 vault(`knowledge`)의 지침 계층을 이 템플릿으로 이식. 조직 고유 값은
  `config/team-settings.yaml`의 플레이스홀더로 중립화했으므로 clone 후 교체가 필요하다.
- 2026-09-04: 볼트 루트 devops baseline 배포 — `package.json`(Node 24+ `engines` + 공용
  툴체인 7종: typescript·@types/node·tsx·vitest·zod·@modelcontextprotocol/sdk·jsdom)과
  `.nvmrc`(24)를 볼트 루트에 둔다. 도구를 만들 때의 공통 환경이며 조직 고유 규약은 담지
  않는다 — 공개 표준과 공개 npm 패키지만 쓴다. `npm install` 산출물은 커밋 대상이 아니라
  `.gitignore`에 `/node_modules/`를 함께 추가했다. lockfile은 배포하지 않는다(caret 범위).
  origin: lemoncloud-io/knowledge@6d5882e:projects/second-brain/config/devops/ — 원본 유닛의 README가 배포 대상 파일의
  정본 표를 갖는다 (README 자체는 배포하지 않는다).

## Outputs

Project-specific outputs should be saved in `projects/second-brain/outputs/` when needed.
