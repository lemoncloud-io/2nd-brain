# Vault Memory

Loaded at the start of every vault operation. Keep this file under 8 KB (`wc -c`) — the budget is
bytes, not lines. 현재 상태와 포인터만 둔다: 정책은 `VAULT_RULES.md`, 실행 이력은
`docs/vault-ingest-log.md`, 프로젝트 상태는 `projects/<name>/README.md` frontmatter가 진실원이다.

## Policy Pointers

정책 본문을 여기 복사하지 않는다. 2026-08-07 attention-budget 감사에서 § Operating Defaults
11항목·§ Automation Policy 4항목이 `VAULT_RULES.md` 사본이었음이 확인돼 포인터로 대체했다.

- 디렉터리 역할·append-only 경계 → `VAULT_RULES.md` § Directory Contract, `docs/raw-layout.md`
- 노트/출력 규칙, 개인 실험 데이터 금지, 배포 값(team-settings.yaml) 분리,
  `VAULT_MEMORY.md` 자체 계약 → `VAULT_RULES.md` § Core Rules
- frontmatter enum·provenance·topic 규칙 → `VAULT_RULES.md` § Note Contracts + `templates/`
- Claude Code 우선 / Hermes fallback, 위임 시 절대경로 → `VAULT_RULES.md` § Automation Priority
- ingest 브랜치·PR 워크플로 → `VAULT_RULES.md` § Workflows + `vault-ingest-claude.md`
- GitHub 연결 프로젝트 → `VAULT_RULES.md` § GitHub-Linked Projects → `docs/github-linked-projects.md`
- 세션 읽기 순서, `VAULT_DIR` 해석 → `CLAUDE.md`

## Current State

- Created: 2026-07-08 (vault 제어 파일 초기화 기준)
- Last Sync: 2026-08-14 — 운영 vault의 지침 계층을 이식 (VAULT_RULES 재구조화, CLAUDE/AGENTS
  재작성, `docs/raw-layout.md`·`docs/github-linked-projects.md` 신설, team-settings.yaml 도입)
- Last Lint Pass: 2026-07-31 — 첫 pass, 정책 정합성 감사, P0 4 / P1 3 / P2 3 / P3 7 (리포트 미보존)
- Last Ingest: 2026-08-28 (louis-lemon) — 2 clippings → 3 new / 0 updated wiki notes (PR #12)
- Volume to date: 1 ingest run / 2 clippings 처리 — `Clippings/` 미처리 0건, wiki article 3개, topic 2개
- Ingest history: `docs/vault-ingest-log.md` — 실행별 상세, append-only, 세션 시작 시 로드하지 않음
- Verification queue: `grep -rln "^status: needs-update" wiki/*.md` — 2026-08-28 기준 0건
- Canonical lists: wiki 문서 목록 `wiki/INDEX.md`, 프로젝트 인덱스 `projects/README.md`

## Open Threads

Vault 수준의 살아있는 액션만, 최대 5개. 닫히면 삭제한다. 프로젝트 단위 next step은 여기 적지 않고
`projects/<name>/README.md`의 `next_action`에 둔다.

- `vault_ingest_once.py` job spec에 브랜치/커밋/PR 단계가 없어 자동 ingest 경로가 PR을 남기지 않는다.
- 규칙 기계 검사가 부분적이다: `vault-lint`가 memory 캡·wikilink 형식·raw 색인은 검사하지만,
  머신 절대경로와 개인 데이터 가드는 아직 사람이 본다.
