# projects/

프로젝트별 실행 문서·산출물 모음. 개념은 `wiki/`에, 실행 맥락만 여기에.

> **규칙:** 프로젝트를 추가·변경·완료할 때마다 아래 인덱스를 반드시 업데이트한다.

## 인덱스

| 프로젝트 | 상태 | 목적 |
|---------|------|------|
| [second-brain](second-brain/) | active | 이 vault의 구조·워크플로우 지속 개선 (3-루프 가동) |
| [@lemoncloud-io](@lemoncloud-io/) | 1 repos | GitHub 연결 프로젝트 |

> 상태·마감·다음 행동의 진실원은 각 프로젝트 README의 frontmatter다. 루트 `projects.base` 대시보드에서 집계된다. 완료(`done`) 프로젝트는 `archive/projects/`로 이동한다.

## 외부 GitHub 프로젝트 (@org/repo)

GitHub 연결 프로젝트는 `@` prefix 폴더(`projects/@<org>/<repo>/`)로 추적한다.

- 메인 인덱스(위 테이블)에는 **org당 한 줄**만 추가한다.
  예: `| [@lemoncloud-io](@lemoncloud-io/) | N repos | GitHub 연결 프로젝트 |`
- repo별 목록·상태는 `projects/@<org>/README.md` org 인덱스가 담당한다.
- 개인 계정 소유 repo도 같은 구조를 쓰되 frontmatter `scope: personal`로 구분한다.
  공유를 원하면 메인 인덱스 행에 "(개인)"을 표기하고 공개 가능한 메타데이터만
  기록한다. 로컬 전용으로 두려면 `projects/@<owner>/`를 gitignore에 걸고
  메인 인덱스에는 올리지 않는다 (org 인덱스가 유일한 인덱스가 된다).
- 등록은 `github-project-link`, 상태 동기화는 `github-project-sync` 스킬 사용
  (`projects/second-brain/config/skills/`). 규칙 상세는 `VAULT_RULES.md`
  § GitHub-Linked Projects.

### 연결 방법 예제

에이전트(Claude/Hermes)에게 요청하면 `github-project-link` 스킬이 처리한다:

> "lemoncloud-io/lemon-model을 vault에 연결해줘."

1. `$GITHUB_DIR/<org>/<repo>`에 클론한다 (없으면. `GITHUB_DIR` 미설정 시 `~/Documents`)
2. repo 문서(README 등)를 읽어 goal 초안을 잡고 사용자 확인을 받는다
3. `projects/@<org>/<repo>/README.md` 노트와 org 인덱스를 생성한다
4. 팀 org면 메인 인덱스에 org 행을 추가하고 브랜치+PR로 올린다

개인 repo를 로컬 전용으로 연결하려면:

> "steve-lemon/taxonomy를 vault에 연결해주고, 개인용으로 gitignore 걸어줘."

→ 같은 절차에 더해 `projects/@<owner>/`를 gitignore에 등록하고 메인 인덱스에는 올리지 않는다.

등록된 프로젝트의 상태 갱신은:

> "외부 프로젝트 상태 동기화해줘." (전체) / "@lemoncloud-io 쪽만 상태 확인해줘." (범위 지정)

→ `github-project-sync`가 변화를 감지해 제안하고, 승인한 항목만 반영된다.

## 프로젝트 추가 방법

```text
projects/<name>/
  README.md     ← 목적, 상태, 관련 wiki 링크
  outputs/      ← 이 프로젝트 전용 산출물
```

1. `projects/<name>/README.md` 작성 (목적·상태·관련 wiki 링크 포함)
2. `projects/<name>/outputs/` 생성
3. **이 파일(projects/README.md) 인덱스 테이블 업데이트**
