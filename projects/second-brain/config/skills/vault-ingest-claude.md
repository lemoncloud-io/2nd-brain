---
name: vault-ingest-claude
description: >
  사용자의 knowledge vault($VAULT_DIR)의 Clippings 처리를 Claude CLI/Claude Code에
  우선 위임한다. Hermes는 트리거, 동시 실행 방지, Claude 가용성 확인, Hermes-native
  fallback, 결과 검증, 요약 보고를 담당한다.
---

# Vault Ingest Claude (Hermes -> Claude)

이 스킬은 split/hybrid 구성용이며, cron/event 자동화의 기본 ingest 진입점이다.

- Hermes: 트리거, `VAULT_DIR` 확인, Clippings 존재 확인, lock, Claude 가용성 확인, Claude 호출, fallback, 결과 검증, 보고
- Claude: 원문 읽기, 개념 추출, wiki 작성, templates 적용, raw 이동, index/topic/memory 갱신, git 브랜치/커밋 정리, 사용자 확인 후 PR 요청 (자세한 내용은 "GitHub PR 워크플로우" 참고)

Claude Code가 설치되어 있지 않거나 인증되지 않았으면 실패로 끝내지 말고 `vault-ingest` Hermes-native 절차로 fallback한다.

## 언제 사용하는가

- 사용자가 "클리핑 처리해줘"라고 요청했고 ingest 품질을 Claude에 우선 맡기고 싶을 때
- 긴 원문, 복잡한 개념 분해, 다수 wiki 문서 생성이 필요한 경우
- Hermes의 현재 모델은 GPT/Codex이지만, 자료 컴파일은 Claude Code가 더 적합하다고 판단될 때
- cron/webhook/event에서 ingest를 자동 실행할 때

## 절차

런타임에서는 `~/knowledge`로 조용히 fallback하지 않는다.

`VAULT_DIR` 결정 순서:

1. 사용자가 `VAULT_DIR`를 명시하면 그 값을 우선한다.
2. 명시되지 않았고 현재 작업 루트가 Obsidian vault 구조(`VAULT_RULES.md`, `wiki/`,
   `raw/`, `Clippings/`, `templates/`)를 갖고 있으면 현재 작업 루트를 `VAULT_DIR`로
   간주한다.
3. 확신할 수 없으면 Claude를 호출하지 말고 사용자에게 vault 경로를 확인한다.

Claude 호출 전 `VAULT_DIR`는 반드시 절대경로로 resolve한다. 예를 들어 테스트 vault가
`~/sandbox`라면 `ABSOLUTE_VAULT_DIR`는 `/.../sandbox`여야 한다. `~/knowledge`는
설치 예시일 뿐이며, `ABSOLUTE_VAULT_DIR`가 실제로 그 경로일 때만 사용한다.

1. `$VAULT_DIR/Clippings/`에 처리 대기 파일이 있는지 확인한다.
   비어 있으면 Claude를 호출하지 않고 "처리할 클리핑 없음"으로 종료한다.
2. `$VAULT_DIR/.locks/`가 없으면 생성하고, `$VAULT_DIR/.locks/vault-ingest.lock`으로
   동시 실행을 방지한다. 이미 lock이 있으면 실행하지 말고 사용자에게 보고한다.
3. Claude Code 가용성을 확인한다.
   - `command -v claude`가 실패하면 lock을 제거하고 `vault-ingest` Hermes-native 절차로 fallback한다.
   - `claude --version`이 실패하면 lock을 제거하고 fallback 사유를 보고한 뒤 `vault-ingest`로 fallback한다.
   - `claude auth status --text`가 실패하면 Claude가 설치되어 있어도 미인증 상태로 보고하고 `vault-ingest`로 fallback한다.
4. resolve된 `$ABSOLUTE_VAULT_DIR` 루트에서 Claude CLI print mode를 호출한다.
5. Claude에는 아래 job spec을 그대로 전달한다.
6. Claude 실행이 실패하면 자동 재시도를 반복하지 않는다. lock을 제거하고 실패 원인을 보고한 뒤 Hermes-native `vault-ingest` fallback을 실행한다.
7. Claude 실행이 끝나면 다음을 검증한다.
   - Claude가 보고한 작업 경로가 `$ABSOLUTE_VAULT_DIR`와 일치하는지
   - 생성/수정/이동된 모든 파일 경로가 `$ABSOLUTE_VAULT_DIR` 아래인지
   - `Clippings/`가 비었는지
   - 처리 원문이 `raw/`로 이동했는지
   - 새/수정 wiki 문서가 `templates/` 구조와 frontmatter를 따르는지
   - `sources`가 `"raw/<source-file-name>.md"` 형식인지
   - Obsidian alias가 `[[note-slug|Alias]]` 형식인지
   - `wiki/INDEX.md`, `wiki/topics/`, `wiki/VAULT_MEMORY.md`가 갱신됐는지
8. lock을 제거한다.
9. 사용자에게 실행 경로(Claude 또는 Hermes fallback), 처리 파일, 생성/수정 문서, 검증 결과, 남은 이슈를 요약한다.

## GitHub PR 워크플로우

Claude가 ingest를 수행할 때는 파일만 고치는 것이 아니라 결과를 리뷰 가능한 PR로 남긴다. 단계는 다음과 같다.

1. **준비 (브랜치 + 시작 커밋)**
   - 시작 전 `git status`로 작업 트리가 깨끗한지 확인한다. 이번 ingest와 관련 없는 미커밋 변경이 있으면 처리를 시작하지 말고 사용자에게 보고한다.
   - 이 vault는 여러 사람이 공용으로 쓰므로, 누가 만든 브랜치인지 브랜치 이름만 보고 알 수 있어야 한다. 작업자 slug를 구한다: `gh api user --jq .login`을 우선 쓰고, 실패하면 `git config user.name`을 소문자·공백을 하이픈으로 바꾼 slug로 대체하고, 그마저도 없으면 `whoami`를 쓴다.
   - `master`를 기준으로 `ingest/<YYYY-MM-DD>-<작업자-slug>` 형식의 브랜치를 만든다(예: `ingest/2026-07-09-steve-lemon`). 같은 사람이 같은 날 여러 번 실행하면 `-2`, `-3` 접미사를 뒤에 붙인다(예: `ingest/2026-07-09-steve-lemon-2`).
   - `Clippings/`에 아직 커밋되지 않은 파일이 있으면, 이번에 처리할 파일들만 정리해 별도의 시작 커밋으로 남긴다(예: `chore: stage N clippings for ingest`). 이미 커밋되어 있으면 이 하위 단계는 건너뛰고 그 사실을 최종 보고에 남긴다.
2. **ingest 처리**: 아래 "Claude job spec"에 따라 실제 컨텐츠 변환을 수행한다(원문에서 개념 추출, wiki 작성/갱신, `raw/` 이동, `wiki/INDEX.md`·`wiki/topics/`·`wiki/VAULT_MEMORY.md` 갱신). 이 단계 자체에서는 커밋하지 않는다.
3. **결과 커밋**: 처리로 변경된 파일만 스테이징해 하나의 커밋으로 남긴다. 커밋 메시지는 처리한 클리핑 수와 새/갱신 wiki 문서를 요약한다(예: `feat: ingest 3 clippings into wiki (ai-agents, knowledge-management)`). 시작 커밋(선택)과 결과 커밋(필수) 두 개로 정리하고, 중간에 커밋을 더 쪼개지 않는다.
4. **PR 오픈**: 결과 커밋 뒤 확인을 기다리지 않고 바로 브랜치를 push하고 `gh pr create`로 PR을 연다. base는 `master`, 기본 리뷰어는 `steve-lemon`이다(`gh pr create --base master --reviewer steve-lemon ...`). PR 본문에는 처리한 클리핑, wiki 변경 요약, 남은 needs-update/open question을 적는다.
5. **완료 보고**: 처리한 클리핑, 생성/갱신 문서, topic/index/memory 갱신, 남은 needs-update/open question, 그리고 열린 PR 링크를 사용자에게 요약해서 보고한다. 이 단계는 사후 보고이며 진행 여부를 묻지 않는다.

### git/PR 관련 금지 사항

- 브랜치 push와 PR 오픈(`gh pr create`)은 확인 없이 자동으로 진행한다. 단, PR을 merge하는 것은 별도의 명시적 사용자 승인 없이는 하지 않는다.
- `master`/`main`에 직접 push하거나 PR을 자동으로 merge하지 않는다.
- `git push --force`, `git reset --hard`, `git clean`, `rm -rf` 등 파괴적 명령을 쓰지 않는다.
- 커밋을 --no-verify로 hook을 건너뛰거나 서명을 생략하지 않는다.

## Claude job spec

```text
You are processing an Obsidian markdown knowledge vault.

ABSOLUTE_VAULT_DIR: <resolved absolute vault path>

Before editing:
- Confirm that the current working directory is ABSOLUTE_VAULT_DIR.
- If the current working directory is not ABSOLUTE_VAULT_DIR, stop and report the mismatch.
- Only read or write files under ABSOLUTE_VAULT_DIR.
- Do not use ~/knowledge unless ABSOLUTE_VAULT_DIR is exactly the resolved ~/knowledge path.

Read first:
- VAULT_RULES.md
- CLAUDE.md, if present
- wiki/VAULT_MEMORY.md
- wiki/INDEX.md
- templates/
- projects/second-brain/config/skills/vault-ingest.md

Task:
Process every markdown file in Clippings/.
Move processed originals to raw/ without changing their content.
Create or update wiki notes using matching templates in templates/.
Prefer updating existing wiki notes over creating duplicate notes.
Update wiki/topics/, wiki/INDEX.md, and wiki/VAULT_MEMORY.md.

Rules:
- Do not edit raw file contents.
- Record raw source provenance as "raw/<source-file-name>.md", not as a raw-file wikilink.
- Use Obsidian aliases as [[note-slug|Alias]], not [[note-slug\|Alias]].
- Mark unsupported or time-sensitive claims as needs-update or TODO.
- Follow the GitHub PR workflow above: create an `ingest/<date>-<author-slug>` branch
  from `master` (author-slug from `gh api user --jq .login`, falling back to a
  slugified `git config user.name`, then `whoami` — this vault is a shared team space,
  so the branch name must show who ran the ingest), commit the processed result, then
  push the branch and open a PR automatically (base master, reviewer steve-lemon)
  without waiting for confirmation.
- Do not push to master/main, force-push, git reset --hard, git clean, rm -rf, or run
  other destructive commands. Do not merge the PR yourself.

Final response:
Report the current working directory, ABSOLUTE_VAULT_DIR, the author-slug used, the branch created, processed
clipping files, created wiki notes, updated wiki notes, new stubs, topic/index/memory
updates, any unresolved issues, and the PR URL that was opened (reviewer: steve-lemon).
```

## Claude CLI 호출 예시

실제 환경에서 `claude`가 PATH에 없다면 절대경로를 사용한다.

```bash
ABSOLUTE_VAULT_DIR="$(cd "${VAULT_DIR:-$PWD}" && pwd)"
command -v claude >/dev/null 2>&1 || exit 42
claude --version >/dev/null 2>&1 || exit 42
claude auth status --text >/dev/null 2>&1 || exit 42
AUTHOR_SLUG="$(gh api user --jq .login 2>/dev/null || git config user.name | tr '[:upper:] ' '[:lower:]-' || whoami)"
cd "$ABSOLUTE_VAULT_DIR" && claude -p "<CLAUDE_JOB_SPEC with ABSOLUTE_VAULT_DIR=$ABSOLUTE_VAULT_DIR, AUTHOR_SLUG=$AUTHOR_SLUG>" --permission-mode acceptEdits --allowedTools "Read,Write,Edit,Bash" --max-turns 20 --output-format json
```

## 금지 사항

- `Clippings/`가 비어 있는데 Claude를 호출하지 않는다
- lock이 있는데 병렬 실행하지 않는다
- Claude 실행 실패 시 자동 재시도를 반복하지 않는다
- Claude 미설치/미인증/실패 시 조용히 종료하지 않는다. lock을 제거하고 Hermes-native fallback 여부를 보고한다
- Hermes가 Claude 결과 검증 없이 성공으로 보고하지 않는다
