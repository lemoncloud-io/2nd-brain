# 2nd Brain(Knowledge Wiki) Setup Guide

작성일: 2026-07-09
기준 repo: https://github.com/lemoncloud-io/2nd-brain

## 목표

`lemoncloud-io/2nd-brain`를 공용 Obsidian vault로 열고, 문서를 수정한 뒤 GitHub PR로 공유한다.

최종 상태:

```text
~/knowledge       팀 공유 knowledge repo
VAULT_DIR         ~/knowledge
GitHub PR         공유 문서 반영 경로
```

원칙: 공용 wiki repo에는 팀에 공유 가능한 문서만 올린다. 비밀번호, token, 계정 정보, 개인 업무 로그는 commit하지 않는다.

## 1. 준비물 확인

필수:

```bash
git --version
```

선택:

```bash
claude --version
gh --version
```

| 도구 | 용도 | 없어도 되는가 |
| --- | --- | --- |
| Git | clone, branch, commit, push | 아니오 |
| Obsidian | Markdown vault 편집 | 아니오 |
| Claude CLI | clipping 정리, wiki ingest 위임 | 예 |
| GitHub CLI `gh` | 터미널에서 PR 생성 | 예. GitHub 웹으로 대체 가능 |

GitHub 인증 확인:

```bash
gh auth status
```

`gh`가 없으면 나중에 GitHub 웹에서 PR을 만들면 된다.

## 2. Obsidian 설치

Obsidian을 설치한 뒤 아직 vault를 만들지 않아도 된다. 이 가이드에서는 3번에서 clone한 GitHub repo 폴더를 vault로 연다.

## 3. 공용 repo clone과 `VAULT_DIR` 설정

공용 knowledge repo를 별도 폴더에 clone한다.

```bash
git clone https://github.com/lemoncloud-io/2nd-brain.git ~/knowledge
export VAULT_DIR="$HOME/knowledge"
cd "$VAULT_DIR"
```

> `~/knowledge`는 예시 경로일 뿐이다. 핵심은 clone한 폴더를 `VAULT_DIR`로 **명시 지정**하는 것이다. `VAULT_RULES.md`는 어떤 툴도 `~/knowledge`로 조용히 폴백하지 못하게 하므로, 다른 위치에 clone했다면 그 절대경로를 `VAULT_DIR`로 지정하면 된다.

매번 `export`하기 싫으면 shell 설정에 추가한다.

```bash
echo 'export VAULT_DIR="$HOME/knowledge"' >> ~/.zshrc
source ~/.zshrc
```

검증:

```bash
pwd
test -f VAULT_RULES.md && echo "OK: VAULT_RULES.md"
test -d wiki && echo "OK: wiki"
test -d templates && echo "OK: templates"
git remote -v
```

정상 remote:

```text
origin  https://github.com/lemoncloud-io/2nd-brain.git
```

규칙: Obsidian에서 여는 폴더, Claude가 작업하는 폴더, Git repo 루트는 모두 `$VAULT_DIR`와 같아야 한다.

## 4. Obsidian에서 공용 vault 열기

Obsidian을 실행한다.

1. 왼쪽 아래 vault 이름을 클릭한다.
2. `Open another vault` 또는 `Manage vaults`를 연다.
3. `Open folder as vault`를 선택한다.
4. `~/knowledge` 폴더를 선택한다.
5. 파일 목록에 `VAULT_RULES.md`, `wiki/`, `templates/`가 보이는지 확인한다.

## 5. Obsidian 플러그인 설정

`Settings -> Community plugins`에서 `Restricted mode`를 끄고 필요한 플러그인을 설치한다.

| 플러그인 | 용도 | 권장 설정 |
| --- | --- | --- |
| Git | pull, commit, push 보조 | `Pull updates before push` 켜기 |
| Templater | templates 폴더 기반 노트 생성 | template folder를 `templates`로 설정 |
| Dataview | vault 메타데이터 조회 | 기본값으로 시작 |
| Claudian | 클로드 실행 플러그인 | 기본값으로 시작 |

Git 플러그인을 쓰더라도 PR 전에는 터미널에서 한 번 확인한다.

```bash
cd "$VAULT_DIR"
git status --short
```

## 6. 공용 wiki 문서 위치

```text
wiki/
areas/
projects/
outputs/
templates/
```

주요 위치:

| 위치 | 용도 |
| --- | --- |
| `Clippings/` | 새 clipping inbox |
| `raw/` | 처리된 원문. 직접 수정하지 않음 |
| `areas/` | ongoing 책임 영역, daily/idea 문서 |
| `projects/` | 프로젝트별 실행 문서 |
| `outputs/` | Claude/Hermes가 만든 질의 응답, 분석 결과 |
| `templates/` | 문서 템플릿 |
| `wiki/` | 재사용 가능한 개념 문서 |

문서를 만들기 전에 `VAULT_RULES.md`와 `templates/`를 확인한다.

## 7. 샘플 clipping 처리 테스트

Obsidian Web Clipper를 Chrome에 설치한다.

```text
https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf?hl=ko
```

Web Clipper 설정:

1. Chrome 오른쪽 위에서 Obsidian Web Clipper 아이콘을 연다.
2. 저장 대상 vault를 `~/knowledge`로 선택한다.
3. 저장 폴더를 `Clippings/`로 설정한다.
4. 파일 형식은 Markdown 기본값을 사용한다.

샘플 기사:

```text
https://www.dailydoseofds.com/p/hermes-agent-masterclass/
```

테스트 절차:

1. Chrome에서 샘플 기사를 연다.
2. Obsidian Web Clipper로 저장한다.
3. Obsidian에서 `Clippings/` 폴더에 `.md` 파일이 생겼는지 확인한다.
4. 터미널에서 공용 vault 루트로 이동한다.

Claude는 반드시 공용 vault 루트에서 실행한다.

```bash
cd "$VAULT_DIR"
find Clippings -maxdepth 1 -type f
claude
```

처음 요청:

```text
지침을 읽고 이 vault 기준으로 작업해줘.
```

성공 기준:

- `Clippings/`에 있던 처리 대상이 `raw/`로 이동한다.
- 필요한 `wiki/`, `outputs/`, `areas/` 문서가 생성되거나 수정된다.
- Claude 응답이나 세션 로그에 처리한 파일 목록이 남는다.

## 8. Obsidian에서 문서 수정 테스트

예시는 이 문서를 수정해서 PR로 올리는 흐름이다.

```bash
cd "$VAULT_DIR"
git checkout master
git pull --rebase origin master
git checkout -b docs/knowledge-wiki-setup-guide
```

Obsidian에서 아래 파일을 연다.

```text
docs/knowledge-wiki-setup-guide.md
```

작게 수정한 뒤 터미널에서 확인한다.

```bash
DOC_PATH="docs/knowledge-wiki-setup-guide.md"
git status --short
git diff -- "$DOC_PATH"
```

의도하지 않은 파일이 보이면 commit하지 않는다.

## 9. GitHub PR 올리기

의도한 파일만 stage한다.

```bash
git add "$DOC_PATH"
git diff --cached
```

커밋한다.

```bash
git commit -m "docs: update knowledge wiki setup guide"
```

작업 branch를 push한다.

```bash
git push -u origin docs/knowledge-wiki-setup-guide
```

GitHub CLI가 있으면 PR을 만든다.

```bash
gh pr create \
  --base master \
  --head docs/knowledge-wiki-setup-guide \
  --title "docs: update knowledge wiki setup guide" \
  --body "Updates the shared knowledge wiki setup guide."
```

GitHub CLI가 없으면 웹에서 만든다.

1. https://github.com/lemoncloud-io/2nd-brain 를 연다.
2. `Compare & pull request`를 누른다.
3. base가 `master`, compare가 `docs/knowledge-wiki-setup-guide`인지 확인한다.
4. 제목과 설명을 적고 PR을 생성한다.

리뷰 후 수정이 필요하면 같은 branch에서 다시 수정하고 push한다.

```bash
git status --short
git add "$DOC_PATH"
git commit -m "docs: refine knowledge wiki setup guide"
git push
```

## 10. PR 전 체크리스트

```bash
git status --short
git diff --cached
```

확인할 것:

- 의도한 공용 wiki 문서만 stage되어 있다.
- 비밀번호, token, `.env`, 계정 정보가 없다.
- Obsidian 로컬 설정 `.obsidian/`이 없다.
- Claude/Hermes 로컬 설정이나 로그가 없다.
- 문서에는 개인 머신 절대경로 대신 `$VAULT_DIR` 또는 `~/knowledge`를 쓴다.
- `master`에 직접 push하지 않고 branch에서 PR을 만든다.

## 빠른 점검 명령

```bash
export VAULT_DIR="$HOME/knowledge"
cd "$VAULT_DIR"
pwd
test -f VAULT_RULES.md && echo "OK: VAULT_RULES.md"
git remote -v
git status --short
```

## 문제 상황

| 증상 | 확인 |
| --- | --- |
| Obsidian에서 파일이 안 보임 | `~/knowledge` 폴더를 vault로 열었는지 확인 |
| Claude가 다른 폴더를 수정함 | `cd "$VAULT_DIR"` 후 Claude를 다시 실행 |
| push 권한 오류 | GitHub 계정 권한과 `gh auth status` 확인 |
| conflict 발생 | `git status` 결과를 공유하고 혼자 강제 push하지 않기 |
| 의도하지 않은 파일이 stage됨 | `git restore --staged <file>`로 stage 해제 |
