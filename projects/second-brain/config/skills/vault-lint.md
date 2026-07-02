---
name: vault-lint
description: >
  사용자의 knowledge vault에 대해 주기적 lint pass를 실행한다 (모순 탐지,
  고아 페이지, 누락 아티클, frontmatter 결함 점검). 예약 실행 전용 —
  사용자가 직접 요청하는 경우는 드물다.
---

# Vault Lint (Hermess-native)

이 스킬은 Hermess의 현재 모델이 GPT이든 Claude이든 같은 방식으로 vault 품질을
점검하도록 만든 provider-agnostic 지시서다.

## 언제 사용하는가

- 예약된 주기 실행 시 (권장: 매주 월요일 오전)
- `wiki/VAULT_MEMORY.md`의 "Last Lint Pass" 날짜가 2주 이상 지났을 때

## 절차

`VAULT_DIR` 기본값은 `~/knowledge`다. 실제 vault가 다른 위치라면 해당 경로를
`VAULT_DIR`로 간주한다.

1. `$VAULT_DIR/wiki/VAULT_MEMORY.md`,
   `$VAULT_DIR/wiki/INDEX.md`, `$VAULT_DIR/wiki/TOPIC_MAP.md`를 읽는다.
2. `wiki/`의 markdown 문서를 스캔한다. `raw/`는 읽거나 수정하지 않는다.
3. 다음 항목을 점검한다.
   - frontmatter 누락 또는 필수 필드 누락
   - `status: stub` 문서
   - 고아 문서
   - 깨진 wikilink
   - `[[note\|Alias]]`처럼 pipe 문자가 escape된 Obsidian alias
   - `sources`에 raw 파일을 `[[...]]` wikilink로 넣은 경우
   - 중복 개념
   - 서로 모순되는 설명
   - 10개 이상 문서를 가진 과밀 topic page
4. 필요한 경우 빈 stub 문서를 만든다. 단, 추측으로 긴 본문을 작성하지 않는다.
5. lint 결과를 `outputs/YYYY-MM-DD-vault-lint.md`에 저장한다.
6. `wiki/VAULT_MEMORY.md`의 Last Lint Pass와 stub/issue 요약을 갱신한다.
7. 결과 요약(신규 stub 수, 분할 후보 topic, 발견된 모순 수)을 사용자에게 보고한다.
   심각한 모순이 발견되면 즉시 보고하고, 사소한 것(빈 stub 등)은 주간 요약에만
   포함한다.

## 금지 사항

- lint 실행 중 `raw/` 파일은 절대 건드리지 않는다 (append-only)
- 근거 없이 본문을 대량 생성하지 않는다
- `git reset`, `git clean`, `rm -rf` 같은 파괴적 명령을 실행하지 않는다
