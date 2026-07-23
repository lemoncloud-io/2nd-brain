---
name: vault-ingest
description: >
  사용자의 knowledge vault($VAULT_DIR)에 새로 들어온
  Clippings를 Hermes의 현재 LLM(GPT 또는 Claude)이 직접 wiki로 컴파일한다.
  Clippings/ 폴더에 새 파일이 생겼을 때, 또는 예약된 주기로 실행한다.
---

# Vault Ingest (Hermes-native fallback)

이 스킬은 Hermes의 현재 모델이 GPT이든 Claude이든 같은 방식으로 동작하도록
작성된 provider-agnostic vault 작업 지시서다. 별도 coding agent에 위임하지 않고,
가능하면 Hermes가 제공하는 파일 읽기/쓰기 도구로 직접 처리한다.

자동화의 기본 경로는 `vault-ingest-claude`이며, Claude Code가 설치되어 있지 않거나
인증되지 않았거나 실패했을 때 이 스킬을 fallback으로 사용한다. 사용자가 명시적으로
Hermes-native 처리를 요청한 경우에도 이 스킬을 사용한다.

## 언제 사용하는가

- `Clippings/` 폴더에 새 파일이 감지되었을 때 (webhook)
- 예약된 주기 실행 시 (cron — 권장: 6시간 간격)
- 사용자가 "볼트 업데이트해줘" / "클리핑 처리해줘"라고 명시적으로 요청할 때

## 절차

런타임에서는 `~/knowledge`로 조용히 fallback하지 않는다. 사용자가 `VAULT_DIR`를
명시하면 그 값을 우선한다. 명시되지 않았지만 현재 작업 루트가 Obsidian vault 구조
(`VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `templates/`)를 갖고 있으면 현재
작업 루트를 `VAULT_DIR`로 추론한다. 확신할 수 없으면 파일을 수정하기 전에 사용자에게
vault 경로를 확인한다.

1. 작업 시작 전 `$VAULT_DIR/wiki/VAULT_MEMORY.md`와
   `$VAULT_DIR/wiki/INDEX.md`를 읽는다.
2. `$VAULT_DIR/templates/`에서 사용 가능한 템플릿을 확인한다. 새 wiki 문서를 만들 때는
   가능한 경우 아래 템플릿을 우선 사용한다.
   - `concept` → `templates/wiki-concept.md`
   - `tool` → `templates/wiki-tool.md`
   - `model` → `templates/wiki-model.md`
   - `framework` → `templates/wiki-framework.md`
   - `topic` → `templates/topic-page.md`
3. `$VAULT_DIR/Clippings/`에 처리 대기 파일이 있는지 확인한다.
   비어 있으면 아무 파일도 수정하지 않고 "처리할 클리핑 없음"으로 종료한다.
4. 각 클리핑 파일을 읽고 핵심 주장, 도구, 모델, 방법론, 워크플로우를 추출한다.
5. 기존 `wiki/` 문서와 중복되는 개념은 새 파일을 만들지 말고 기존 문서를 갱신한다.
6. 새 개념은 `wiki/<slug>.md`로 만든다. 파일명은 영어 소문자 kebab-case를 사용한다.
7. 모든 wiki 문서는 해당 템플릿 또는 지정된 frontmatter를 포함한다.
8. 관련 wiki 문서에는 `[[wikilink]]`를 추가한다. Obsidian alias는
   `[[note-slug|Alias]]` 형식을 사용하고 pipe 문자 앞에 backslash를 넣지 않는다.
9. `wiki/topics/`, `wiki/INDEX.md`, `wiki/VAULT_MEMORY.md`를 갱신한다.
10. 처리 완료된 클리핑은 원문을 보존한 채 `raw/`로 이동한다. 이미 같은 이름이 있으면
   덮어쓰지 말고 `-1`, `-2` 같은 suffix를 붙인다.
   wiki 문서의 `sources`에는 원문을 `[[...]]` wikilink로 넣지 말고
   `"raw/<source-file-name>.md"` 경로 문자열로 기록한다.
11. 마지막 응답에는 다음만 간단히 보고한다.

- 처리한 클리핑 파일
- 생성한 wiki 문서
- 업데이트한 wiki 문서
- 새 stub 문서
- 갱신한 topic/index/memory 파일

## Wiki frontmatter

```yaml
---
type: concept
topics:
  - knowledge-management
status: draft
sources:
  - "raw/source-file-name.md"
---
```

`sources`는 직접 provenance를 위한 필드다. 실제 wiki 문서가 아닌 raw source는
wikilink로 만들지 않는다.

## GitHub PR 워크플로우

이 fallback 절차는 git/GitHub 작업을 포함하지 않는다 — 파일 처리까지만 담당한다.
브랜치 생성, 커밋 정리, PR 요청(기본 리뷰어 `steve-lemon`)은 git/`gh` CLI를 실행할
수 있는 실행 경로(`vault-ingest-claude.md`)의 책임이다. Hermes가 이 fallback을
실행한 뒤 별도로 git 작업을 하고 싶다면 `vault-ingest-claude.md`의 "GitHub PR
워크플로우" 절차를 그대로 따른다.

## 금지 사항

- `git push`, `git reset --hard`, `git clean`, `rm -rf` 실행 금지
- `raw/` 파일 내용 수정 금지
- 템플릿이 있는데 임의 구조로 새 문서를 만들지 않는다
- 근거 없는 일반 지식으로 wiki를 부풀리지 않는다
- 원문에 없는 최신 정보가 필요하면 `status: needs-update` 또는 TODO로 표시한다
- 동시에 두 번 이상 이 스킬을 병렬 실행하지 않는다 (같은 `_workspace/`를 두 세션이
  동시에 쓰면 충돌한다)
