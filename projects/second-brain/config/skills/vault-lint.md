---
name: vault-lint
description: >
  사용자의 knowledge vault에 대해 Claude Code 우선, Hermes-native fallback으로
  주기적 lint pass를 실행한다 (모순 탐지, 고아 페이지, 누락 아티클, frontmatter 결함 점검).
  예약 실행 전용 — 사용자가 직접 요청하는 경우는 드물다.
---

# Vault Lint (Claude-first with Hermes fallback)

이 스킬은 cron/event 자동화에서 Claude Code를 우선 사용해 vault 품질을 점검하고,
Claude Code가 설치되어 있지 않거나 인증되지 않았거나 실패하면 Hermes의 현재 모델로
같은 lint 절차를 수행하도록 만든 fallback 지시서다.

## 언제 사용하는가

- 예약된 주기 실행 시 (권장: 매주 월요일 오전)
- `wiki/VAULT_MEMORY.md`의 "Last Lint Pass" 날짜가 2주 이상 지났을 때

## 절차

런타임에서는 `~/knowledge`로 조용히 fallback하지 않는다. 사용자가 `VAULT_DIR`를
명시하면 그 값을 우선한다. 명시되지 않았지만 현재 작업 루트가 Obsidian vault 구조
(`VAULT_RULES.md`, `wiki/`, `raw/`, `outputs/`, `templates/`)를 갖고 있으면 현재
작업 루트를 `VAULT_DIR`로 추론한다. 확신할 수 없으면 lint를 실행하기 전에 사용자에게
vault 경로를 확인한다.

## 실행 모드 결정

1. `VAULT_DIR`를 절대경로로 resolve한다.
2. `.locks/vault-lint.lock`으로 동시 실행을 방지한다. 이미 lock이 있으면 실행하지 않고 보고한다.
3. Claude Code 가용성을 확인한다.
   - `command -v claude`가 실패하면 lock을 제거하고 아래 Hermes-native 절차로 fallback한다.
   - `claude --version`이 실패하면 lock을 제거하고 fallback 사유를 보고한 뒤 Hermes-native 절차로 fallback한다.
   - `claude auth status --text`가 실패하면 Claude가 설치되어 있어도 미인증 상태로 보고하고 Hermes-native 절차로 fallback한다.
4. Claude Code가 가능하면 `$ABSOLUTE_VAULT_DIR` 루트에서 아래 Claude lint job spec을 print mode로 실행한다.
5. Claude 실행이 실패하면 자동 재시도를 반복하지 않는다. lock을 제거하고 실패 원인을 보고한 뒤 Hermes-native 절차로 fallback한다.
6. Claude 실행 후에는 결과 파일, `wiki/VAULT_MEMORY.md`, raw/archive 미수정 여부를 Hermes가 검증한다.
7. lock을 제거하고 실행 경로(Claude 또는 Hermes fallback)를 보고한다.

## Claude lint job spec

```text
You are linting an Obsidian markdown knowledge vault.

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
- wiki/TOPIC_MAP.md, if present
- templates/lint-report.md, if present

Task:
- Scan wiki markdown files and topic pages.
- Do not read or edit raw/ file contents.
- Check frontmatter, template drift, stub notes, orphan notes, broken wikilinks, escaped-pipe aliases, raw-file wikilinks in sources, duplicate concepts, contradictions, and overcrowded topic pages.
- Save the report to outputs/YYYY-MM-DD-vault-lint.md using templates/lint-report.md when available.
- Update wiki/VAULT_MEMORY.md with Last Lint Pass and a compact issue summary, keeping it under 200 lines.

Rules:
- Do not edit raw/ or archive/ file contents.
- Do not invent large article bodies during lint.
- Do not run git push, git reset, git clean, rm -rf, or destructive commands.

Final response:
Report current working directory, ABSOLUTE_VAULT_DIR, lint report path, updated memory file, critical issues, stub count, broken link count, and any unresolved issues.
```

Claude CLI 예시:

```bash
ABSOLUTE_VAULT_DIR="$(cd "${VAULT_DIR:-$PWD}" && pwd)"
command -v claude >/dev/null 2>&1 || exit 42
claude --version >/dev/null 2>&1 || exit 42
claude auth status --text >/dev/null 2>&1 || exit 42
cd "$ABSOLUTE_VAULT_DIR" && claude -p "<CLAUDE_LINT_JOB_SPEC with ABSOLUTE_VAULT_DIR=$ABSOLUTE_VAULT_DIR>" --permission-mode acceptEdits --allowedTools "Read,Write,Edit,Bash" --max-turns 20 --output-format json
```

## Hermes-native fallback 절차

1. `$VAULT_DIR/wiki/VAULT_MEMORY.md`,
   `$VAULT_DIR/wiki/INDEX.md`, `$VAULT_DIR/wiki/TOPIC_MAP.md`를 읽는다.
2. `$VAULT_DIR/templates/lint-report.md`가 있으면 읽고 lint report 출력 구조로 사용한다.
3. `wiki/`의 markdown 문서를 스캔한다. `raw/`는 읽거나 수정하지 않는다.
4. 다음 항목을 점검한다.
   - frontmatter 누락 또는 필수 필드 누락
   - 사용 가능한 템플릿과 크게 어긋나는 wiki/query/lint 문서 구조
   - `status: stub` 문서
   - 고아 문서
   - 깨진 wikilink
   - `[[note\|Alias]]`처럼 pipe 문자가 escape된 Obsidian alias
   - `sources`에 raw 파일을 `[[...]]` wikilink로 넣은 경우
   - 중복 개념
   - 서로 모순되는 설명
   - 10개 이상 문서를 가진 과밀 topic page
5. 필요한 경우 빈 stub 문서를 만든다. 단, 추측으로 긴 본문을 작성하지 않는다.
6. lint 결과를 `outputs/YYYY-MM-DD-vault-lint.md`에 저장한다.
7. `wiki/VAULT_MEMORY.md`의 Last Lint Pass와 stub/issue 요약을 갱신한다.
8. 결과 요약(신규 stub 수, 분할 후보 topic, 발견된 모순 수)을 사용자에게 보고한다.
   심각한 모순이 발견되면 즉시 보고하고, 사소한 것(빈 stub 등)은 주간 요약에만
   포함한다.

## 금지 사항

- lint 실행 중 `raw/` 파일은 절대 건드리지 않는다 (append-only)
- 근거 없이 본문을 대량 생성하지 않는다
- `git reset`, `git clean`, `rm -rf` 같은 파괴적 명령을 실행하지 않는다
- Claude 미설치/미인증/실패 시 조용히 종료하지 않는다. lock을 제거하고 Hermes-native fallback 여부를 보고한다
