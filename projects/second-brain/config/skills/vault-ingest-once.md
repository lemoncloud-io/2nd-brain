---
name: vault-ingest-once
description: >
  Claude Code 우선으로 vault Clippings ingest를 한 번 실행하는 원샷 스킬. 세부 규칙은
  vault-ingest-claude.md를 따르고, Claude가 시작 전 단계에서 불가하면 vault-ingest.md로 fallback한다.
origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/skills/vault-ingest-once.md
---

# Vault Ingest Once

수동 실행, cron, webhook에서 공통으로 쓰는 ingest 진입점이다. 세부 정책과 Claude job spec은
`projects/second-brain/config/skills/vault-ingest-claude.md`를 따른다.

## Run

Vault root에서 실행한다.

```bash
python3 projects/second-brain/config/scripts/vault_ingest_once.py
```

## Result handling

- `status: no_work` → 처리할 클리핑 없음. 종료.
- `status: claude_success` → 공유 불변식 훅이 이미 통과한 상태다(`verify` 필드에 그 출력). 나머지 항목을 검증하고 요약.
- exit code `42` 또는 `status: fallback_required` → Claude가 시작 전 단계에서 불가. `projects/second-brain/config/skills/vault-ingest.md`로 Hermes-native fallback.
- `status: locked` → 병렬 실행하지 말고 lock 경로 보고.
- `status: claude_failed_after_start` → 부분 변경 가능성 있음. 자동 fallback 금지; 변경 파일을 먼저 검토.
- `status: verify_failed` → Claude는 끝났지만 검증이 실패했다. `reason: not_on_ingest_branch`는 브랜치 없이 master에 커밋했다는 뜻이고, 그 외에는 공유 불변식 훅의 defect다(`verify_stdout` 참조). 이 시점에는 이미 커밋·PR이 열려 있으므로 성공으로 보고하지 말고 PR에서 결함을 고친다. 자동 재실행 금지.

## Verify after run

`vault-ingest-claude.md`의 검증 기준을 따른다. 최소 확인:

- 공유 불변식(memory 크기, raw·archive append-only, frontmatter 파싱, 레인 흔적 = ingest run-log가 diff에 있음)은
  `vault_ingest_once.py`가 성공 보고 전에 스스로 판정한다 — 스크립트 경로에서는 다시 돌릴 필요가 없다.
  Hermes-native fallback 등 스크립트를 거치지 않은 실행에서는 직접 돌린다:
  `python3 projects/second-brain/config/scripts/vault_verify.py --lane ingest --base "$(git merge-base HEAD master)"`.
  exit 0이 아니면 성공으로 보고하지 않고 출력된 defect를 그대로 전달한다.
- `Clippings/`, `raw/`, `wiki/`, `wiki/INDEX.md`, `wiki/TOPIC_MAP.md`, `wiki/VAULT_MEMORY.md` 상태
- raw source provenance가 `"raw/<file>.md"` 문자열인지
- run-log 노트가 `outputs/runs/`에 생성됐는지 (동결된 `docs/vault-ingest-log.md`는 무수정)
- Claude 결과를 검증 없이 성공 처리하지 않았는지

## Cron prompt seed

```text
Run one vault ingest pass using projects/second-brain/config/skills/vault-ingest-once.md.
Use projects/second-brain/config/scripts/vault_ingest_once.py from the resolved VAULT_DIR.
If it exits 42/fallback_required, run the Hermes-native vault-ingest fallback.
If the vault root is unclear, stop and report the blocker. Do not ask questions during cron.
```
