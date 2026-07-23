---
name: github-project-link
description: >
  외부 GitHub repo(org/repo)를 로컬 규약 위치($GITHUB_DIR/<org>/<repo>)에 클론하고,
  vault의 projects/@<org>/<repo>/README.md 추적 노트와 2계층 인덱스를 생성·갱신한다.
  사용자가 "이 repo를 vault에 연결/등록해줘"라고 요청할 때 사용한다.
---

# GitHub Project Link (등록)

외부 GitHub 프로젝트를 vault의 상태·목표 추적 계층에 등록하는 스킬.
규칙의 진실원은 `VAULT_RULES.md` § GitHub-Linked Projects.

## 언제 사용하는가

- 사용자가 `org/repo`를 지정해 vault 연결을 요청할 때
- org 전체에서 등록할 repo를 골라 일괄 등록할 때 (`gh repo list <org>` 발견 경로)

## 경로 해석

- `VAULT_DIR`: 사용자 명시 값 우선. 없으면 현재 작업 루트가 vault 구조
  (`VAULT_RULES.md`, `wiki/`, `raw/`, `outputs/`, `templates/`)를 가질 때만 추론.
  확신할 수 없으면 사용자에게 확인. `~/knowledge`로 조용히 fallback하지 않는다.
- `GITHUB_DIR`: 환경변수 우선. 미설정 시 `~/Documents`. 결과 경로가 존재하지
  않으면 임의 생성하지 말고 사용자에게 확인한다.
- 클론 위치는 항상 `$GITHUB_DIR/<org>/<repo>`.

## 절차

1. `gh auth status`로 인증 확인. `gh`가 없거나 미인증이면 명시적으로 보고하고
   중단한다 (조용한 fallback 금지).
2. 대상 결정: 사용자가 `org/repo`를 줬으면 그대로. org만 줬으면
   `gh repo list <org> --limit 100`으로 목록을 보여주고 등록 대상을 고르게 한다.
3. 이미 `$VAULT_DIR/projects/@<org>/<repo>/README.md`가 있으면 중복 등록하지 말고
   보고한다 (갱신은 `github-project-sync` 소관).
4. `$GITHUB_DIR/<org>/<repo>`에 클론이 없으면
   `gh repo clone <org>/<repo> "$GITHUB_DIR/<org>/<repo>"`로 클론한다.
   버전 라인 등록이면 qualifier 붙은 폴더명(예: `lemon-core-v42`)으로 클론하고
   해당 브랜치를 체크아웃한다 — vault 노트 폴더명도 이 이름을 그대로 따른다.
   클론 여부가 애매하면(예: 폴더는 있는데 git repo가 아님) 사용자에게 확인한다.
5. repo 문서(README, ROADMAP, CHANGELOG, docs/ 상위 문서)를 읽고 `goal` 초안
   (한 문장)과 상태 요약을 작성해 **사용자에게 확인받는다**.
6. `templates/project-readme-github.md`를 사용해
   `$VAULT_DIR/projects/@<org>/<폴더명>/README.md`를 생성한다. 노트 폴더명은
   로컬 클론 폴더명과 동일하게 한다 — 보통 repo명이지만, 버전 라인 클론이면
   `lemon-core-v42`처럼 qualifier가 붙은 이름을 그대로 따른다.
   `repo: <org>/<repo>`, 확인받은 `goal`, `status`, `last_synced`(오늘)를 채운다.
   owner가 팀 org면 `scope: team`, 개인 계정이면 `scope: personal`로 설정한다.
   추적할 메인 라인이 repo 기본 브랜치와 다르면(예: `lemon-core`의 `feat/v4.2`)
   `branch:`에 그 브랜치를 지정한다 — 일시적 작업 브랜치는 지정하지 않는다.
   `outputs/` 폴더는 만들지 않는다.
7. org 인덱스 `$VAULT_DIR/projects/@<org>/README.md`를 갱신한다. 없으면 아래
   형식으로 생성:

   ```markdown
   # @<org>

   GitHub 연결 프로젝트 인덱스. repo 등록·상태 변경 시 이 테이블을 갱신한다.
   규칙: `VAULT_RULES.md` § GitHub-Linked Projects.

   | repo | status | goal |
   | --- | --- | --- |
   | [<repo>](<repo>/README.md) | active | <goal 한 문장> |
   ```

8. org가 처음 등록되는 경우에만 `$VAULT_DIR/projects/README.md` 메인 인덱스에
   org 행을 추가한다: `| [@<org>](@<org>/) | N repos | GitHub 연결 프로젝트 |`
   (N = org 인덱스의 repo 수. 이후 등록 시 N을 갱신).
9. 변경 파일을 검토 후 커밋한다. 공용 vault이므로 push + PR
   (base `master`, 리뷰어 `steve-lemon`)까지 진행하고, 머지는 사용자 승인을 기다린다.

## 금지 사항

- 머신 종속 절대 경로를 노트·인덱스에 기록하지 않는다 (`$GITHUB_DIR` 표기 사용)
- 외부 repo에는 클론 외 어떤 쓰기도 하지 않는다
- 사용자 확인 없이 `goal`을 확정하지 않는다
- `projects/@` 밖의 vault 파일을 수정하지 않는다 (메인 인덱스 org 행 제외)
- `raw/`·`archive/`를 수정하지 않는다

## 트리거 예시

- "lemoncloud-io/some-service를 vault에 연결해줘."
- "lemoncloud-io org에서 관리할 repo들 골라서 등록하자."
