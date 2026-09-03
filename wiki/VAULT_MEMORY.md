# Vault Memory

Loaded at the start of every vault operation. Keep this file under 8 KB (`wc -c`) — the budget is
bytes, not lines. 현재 상태와 포인터만 둔다: 정책은 `VAULT_RULES.md`, 실행 이력은
`outputs/runs/`의 run-log 노트, 프로젝트 상태는 `projects/<name>/README.md` frontmatter가 진실원이다.

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

정적 사실과 "어디서 유추하나"만 둔다. 최근 실행·볼륨 수치는 여기 적지 않는다 — 2026-09-03 상위 vault 계약 정렬:
`Last Ingest/Lint Pass/Promotion`·`Volume to date` 줄은 매 실행 교체돼 동시 ingest 브랜치마다 충돌했다. 저장소에서 도구로 유추한다:

- Created: 2026-07-08 (vault 제어 파일 초기화 기준)
- Last Sync: 2026-09-03 — knowledge@8480503 (운영 지침 탈카운터 정렬 + 스킬/스크립트 갱신)
  대상: VAULT_RULES § Core Rules·CLAUDE § Development Work·raw-layout 색인 3파일 체제·이 파일; 신규 `medium-digest`·`runs.base`.
- 최근 ingest / promotion / maintenance → `ls outputs/runs/ | tail` (run-log 파일명 `YYYY-MM-DD-<kind>-<author>.md`,
  frontmatter `kind`·`pr`·`processed`·`summary`). `docs/vault-ingest-log.md`는 run-log 도입 전 원장, 동결 — 더 추가하지 않는다.
- 최근 lint → `ls outputs/*-vault-lint*.md | tail -1` (리포트 § Summary에 건수·판정).
- 볼륨(ingest run·clipping·wiki note·topic 수) → `python3 projects/second-brain/config/scripts/vault_volume.py`
  (원장 + run-log fold, 인자 없이 실행하면 한 줄 출력).
- 미검증 주장 큐 → `grep -rln "needs-update" wiki/*.md | grep -v VAULT_MEMORY | wc -l`.
- Canonical lists: wiki 문서 목록 `wiki/INDEX.md`, 프로젝트 인덱스 `projects/README.md`, raw 색인 `docs/raw-index.yml`.

## Open Threads

Vault 수준의 살아있는 액션만, 최대 5개. 닫히면 삭제한다. 프로젝트 단위 next step은 여기 적지 않고
`projects/<name>/README.md`의 `next_action`에 둔다.

- 인제스트 파이프라인이 한 번도 실행되지 않았다 — `Clippings/` 미처리 1건으로 첫 실행을 검증해야 한다.
- 규칙 기계 검사가 여전히 부분적이다: `vault_verify.py`가 memory 캡·raw/archive append-only·frontmatter
  파싱·레인 흔적(run-log/lint 리포트)을 판정하지만, 머신 절대경로와 개인 데이터 가드는 아직 사람이 본다.
