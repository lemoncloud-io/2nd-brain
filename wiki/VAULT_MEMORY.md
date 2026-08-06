# Vault Memory

Loaded at the start of every vault operation. Keep this file under 8 KB (`wc -c`) — the budget is
bytes, not lines. Durable policy only; 실행 이력은 `docs/vault-ingest-log.md`로 보낸다.

## Vault Identity

- Runtime tools must not silently fall back to `~/knowledge`; use explicit `VAULT_DIR` or a verified vault root.

## Operating Defaults

- `Clippings/` is the inbox for new markdown sources.
- Processed source originals move to `raw/` unchanged; `raw/` is append-only.
- Durable query and lint outputs are saved under `outputs/` unless project-scoped.
- Reusable concepts belong in `wiki/`; project execution context belongs in `projects/`.
- Project-specific skills, prompts, generated tools, and automation config live under `projects/<name>/config/` as source-of-truth files; runtime settings are derived from them.
- Execution-generated runtime state/intermediate files under project outputs stay untracked and ignored unless explicitly promoted to retained documentation.
- 개인 실험 데이터는 로컬 전용 (2026-07-24, 공유 팀 vault 원칙): 개인 미디어에 대한 per-item 라벨 정답지·내용 묘사·로컬 샘플 폴더명은 커밋 금지. retained 문서에는 집계 수치만, 데이터 위치는 env/placeholder 표기, 데이터 파일은 프로젝트별 gitignore(합성 `*.example.*`만 추적), 커밋 메시지에도 개인 콘텐츠 묘사 금지. `VAULT_RULES.md` § Core Rules 참조.
- Use matching files in `templates/` before creating new note structures.
- New wiki article body prose is written in Korean; headings, frontmatter, code, and proper nouns stay English (effective 2026-07-09, see `VAULT_RULES.md` § Language Convention). Existing English-body articles convert opportunistically, not in bulk.
- External GitHub repos are tracked as lightweight `projects/@<owner>/<repo>/README.md` notes (identity `org/repo`; local clones at `$GITHUB_DIR/<org>/<repo>`, default `~/Documents`; team orgs and personal accounts share the structure, personal marked `scope: personal`); agents propose sync changes, the user approves final status/goal/next_action, and sync coverage follows each runner's GitHub permissions. See `VAULT_RULES.md` § GitHub-Linked Projects.

## Automation Policy

- Ingest and lint automation should prefer Claude Code when the `claude` CLI is installed and authenticated.
- If Claude Code is unavailable, blocked, or unauthenticated, Hermes must run the Hermes-native fallback workflow instead of failing silently.
- Delegated agents must receive the resolved absolute `VAULT_DIR` and must only read/write below that path.
- Claude-led ingest runs on an `ingest/<date>-<author-slug>` branch (author-slug = GitHub login, or a slugified git user name), commits the result, then automatically pushes and opens a PR (base `master`) without waiting for confirmation; merging the PR still requires explicit user approval. See `projects/second-brain/config/skills/vault-ingest-claude.md`.

## Current State

현재 상태와 포인터만 둔다. 실행 서술은 `docs/vault-ingest-log.md`, 프로젝트 상태는
`projects/<name>/README.md` frontmatter가 진실원이다. 여기에 되풀이하지 않는다.

- Created: 2026-07-08 (vault 제어 파일 초기화 기준)
- Last Lint Pass: 2026-07-31 — 첫 pass, 정책 정합성 감사 (`outputs/2026-07-31-vault-lint.md`), P0 4 / P1 3 / P2 3 / P3 7
- Last Ingest: 2026-08-06 (sungsu509) — 1 clippings → 3 new / 0 updated wiki notes (PR pending)
- Volume to date: 1 ingest run / 1 clippings 처리 — `Clippings/` 미처리 0건, wiki article 3개, topic 2개
- Ingest history: `docs/vault-ingest-log.md` — 실행별 상세, append-only, 세션 시작 시 로드하지 않음
  (repo 문서 승격은 같은 파일 `## Promotions`)
- Verification queue: `grep -rln "^status: needs-update" wiki/*.md` — 2026-07-31 기준 0건
- Canonical lists: wiki 문서 목록 `wiki/INDEX.md`, 프로젝트 인덱스 `projects/README.md`

## Open Threads

Vault 수준의 살아있는 액션만, 최대 5개. 닫히면 삭제한다. 프로젝트 단위 next step은 여기 적지 않고
`projects/<name>/README.md`의 `next_action`에 둔다.

상세와 권고는 `outputs/2026-07-31-vault-lint.md`.

- vault root 판정이 4종으로 분기해 있다 (문서·스킬·스크립트 7곳). `VAULT_RULES.md` 단일 정의로 통합 미완.
- `vault_ingest_once.py` job spec에 브랜치/커밋/PR 단계가 없어 자동 ingest 경로가 PR을 남기지 않는다.
- 세션 상시 로드 22.8 KB, `CLAUDE.md`/`AGENTS.md`/`VAULT_RULES.md` 규칙 3중 복제 — `VAULT_RULES.md`는 캡이 없다.
- 규칙 기계 검사가 없다 (memory 캡, 절대경로, escaped-pipe alias, `sources` 형식, 개인 데이터 가드).
