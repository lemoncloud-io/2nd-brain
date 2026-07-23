---
name: github-project-sync
description: >
  vault의 projects/@<org>/<repo> 추적 노트들을 외부 GitHub repo의 현재 상태와
  대조해 변화를 감지하고 변경안을 제안한다. status/goal/next_action의 최종 반영은
  사용자 승인 후에만 수행한다. "상태 동기화해줘" 요청 시 사용한다.
---

# GitHub Project Sync (동기화)

등록된 GitHub 연결 프로젝트의 상태를 감지·제안하는 스킬. 외부 repo에는 읽기 전용.
규칙의 진실원은 `VAULT_RULES.md` § GitHub-Linked Projects.

## 언제 사용하는가

- 사용자가 전체 또는 특정 org/repo의 상태 동기화를 요청할 때
- 정기 점검(수동 트리거)으로 `projects/@` 계층의 신선도를 확인할 때

## 경로 해석

`github-project-link` 스킬과 동일: `VAULT_DIR`는 명시 값 우선·구조 확인 추론·
불확실 시 질문, `GITHUB_DIR`는 환경변수 우선·미설정 시 `~/Documents`.

## 절차

1. 대상 수집: 지정이 없으면 `$VAULT_DIR/projects/@*/*/README.md` 전체.
   org 또는 org/repo 지정 시 해당 범위만.
2. 각 repo에 대해 정보 수집 (**읽기 전용**):
   - 노트에 `branch:`가 지정되어 있으면 기본 브랜치 대신 그 브랜치 기준으로
     문서·활동을 읽는다 (로컬: 해당 브랜치, API: `?ref=<branch>`).
   - 로컬 클론은 노트 폴더명 그대로 `$GITHUB_DIR/<org>/<노트 폴더명>`에 있다
     (vault 폴더명 = 클론 폴더명 계약). 있으면 `git -C <clone> fetch --quiet` 후
     대상 브랜치의 README/ROADMAP/CHANGELOG, `git log --since` 최근 활동을 읽는다.
     repo 정체는 폴더명이 아니라 frontmatter `repo:`를 쓴다.
     fetch가 실패하면(비대화형 환경의 자격증명 부재 등) 로컬 상태는 읽되 최신성은
     `gh api repos/<org>/<repo>`(`pushed_at`)로 보완하고, 리포트에 사유를 남긴다.
   - 없으면: `gh api repos/<org>/<repo>`(기본 정보·pushed_at),
     `gh api repos/<org>/<repo>/readme`(문서), `gh release list` 등 API로 조회한다.
     클론을 새로 만들지 않는다.
   - `gh` 미인증/부재 시 명시적으로 보고하고 중단. 접근 권한이 없는 repo는
     건너뛰고 리포트에 사유를 기록한다.
3. vault 노트의 frontmatter(`status/goal/next_action/milestones/last_synced`)와
   본문을 대조해 변화를 감지한다. 감지 대상 예:
   - repo 문서의 목표·로드맵 변경 → `goal`/`milestones` 갱신 후보
   - 장기간(예: 90일+) 활동 없음 → `status: paused` 후보
   - 아카이브/삭제/이전된 repo → 보고만 하고 `status` 판단은 사용자에게
4. 변경 제안 리포트를 아래 형식으로 사용자에게 제시한다. 파일로 남길 경우
   일회성 산출물이므로 untracked 규칙을 적용한다 (커밋하지 않음).

   ```markdown
   # GitHub Project Sync Report — YYYY-MM-DD

   ## <org>/<repo>

   - 감지: <무엇이 달라졌는지 한 줄씩>
   - 제안: <frontmatter 필드별 현재값 → 제안값>
   - 근거: <repo 문서/활동 근거>
   ```

5. **사용자 승인 후에만** 각 노트의 frontmatter/본문(`## Sync Notes`)을 갱신하고
   `last_synced`를 오늘 날짜로 기록한다. 승인되지 않은 항목은 반영하지 않는다.
6. `status` 변경이 승인된 repo는 org 인덱스(`projects/@<org>/README.md`) 테이블도
   갱신한다. `status: done`이면 폴더를 `archive/projects/@<org>/<repo>/`로 이동하고
   org 인덱스와 메인 인덱스의 repo 수(N)를 갱신한다.
7. 변경 파일을 커밋한다. 공용 vault이므로 push + PR
   (base `master`, 리뷰어 `steve-lemon`)까지 진행하고, 머지는 사용자 승인을 기다린다.

## 금지 사항

- 외부 repo에 어떤 쓰기도 하지 않는다 (fetch는 로컬 클론 갱신이므로 허용)
- 사용자 승인 없이 `status`/`goal`/`next_action`을 갱신하지 않는다
- `last_synced`만 바꾸고 감지 결과를 보고하지 않는 빈 동기화를 하지 않는다
- 접근 실패를 조용히 넘기지 않는다 — 리포트에 사유를 남긴다
- 동기화 리포트 파일을 vault에 커밋하지 않는다 (일회성 산출물)

## 트리거 예시

- "외부 프로젝트 상태 전부 동기화해줘."
- "@lemoncloud-io 쪽만 상태 확인해줘."
- "lemoncloud-io/some-service 최근 활동 반영해줘."
