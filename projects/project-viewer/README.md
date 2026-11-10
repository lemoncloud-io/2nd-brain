---
type: project
status: active
goal: "viewer.yml 하나로 프로젝트의 설계·진행을 리뷰하는 읽기 전용 뷰어(단일 HTML)를 빌드하는 공용 셸"
due:
milestones: []
next_action: ""
managed: vault-sync
origin: lemoncloud-io/knowledge@121d6640:projects/project-viewer/
---

# project-viewer

## Purpose

프로젝트가 `viewer.yml` 하나만 쓰면 설계·진행을 사람이 리뷰할 읽기 전용 뷰어(단일 HTML)를 빌드하는 공용 셸이다. 프로젝트는 React 코드를 쓰지 않는다.
해설은 근거로 건 원본 문장·표 칸에서 오고, 상태는 원장에서만 읽는다. 볼트 뷰어(`projects/knowledge-viewer`)는 이 셸로 `viewer.yml` 을 통합 보기로 그린다.

## 구성

- `config/shell/` — 셸. 모델·검사(`model/`), 원본 주입(`loader/`), 화면(`src/`), 시험(`tests/`), 명령 진입점 `cli.ts`(`check`·`build`·`dev`). 명령과 구조는 [셸 README](config/shell/README.md). `node_modules/` 는 Git 제외라 `npm ci` 로 만든다.
- `config/README.md` — 유닛 README. 실행·시험 명령표와 § 확장 지점(프로젝트별 `viewer.yml` 의 자리·키, 블록 어휘, 환경 변수)이 있다. 이 볼트의 프로젝트에 뷰어를 붙일 때는 그 절부터 읽는다.
- `config/skills/project-viewer-build/` — 뷰어를 만드는 절차 스킬. 등록 레이어 `.claude/skills/project-viewer-build` 상대 심링크.
- `config/skills/project-viewer-open/` — 빌드된 뷰어를 브라우저 패널에 여는 스킬. 등록 레이어 `.claude/skills/project-viewer-open` 상대 심링크.

```bash
(cd projects/project-viewer/config/shell && npm ci)                    # 셸 의존성
node projects/project-viewer/config/shell/cli.ts check projects/<name>  # 볼트 루트에서 — viewer.yml 검사
node projects/project-viewer/config/shell/cli.ts build projects/<name>  # 검사 통과 뒤 단일 HTML 빌드
```

## Sync Notes

- `config/` 아래 파일은 출처 스탬프(`origin:`)가 있는 사본이다. 손으로 고치지 않는다. 바꿀 것이 있으면 볼트 운영자에게 요청한다.
- 코드·json·lock 파일에는 스탬프가 없다. 이 README 의 `origin` 이 그 파일들의 기준 커밋이다.
- 볼트 뷰어(`projects/knowledge-viewer`)의 빌드와 시험이 이 셸을 읽는다. 둘은 함께 둔다.
- 2026-11-11: 유닛 README(`config/README.md`)가 새로 왔고 `project-viewer-build` 스킬이 정비됐다. 셸 자신의 예시 스펙이던 `config/viewer.yml` 은 공통 코드가 아니어서 유닛에서 빠졌고, 이 볼트에서도 지웠다(근거 문서가 없어 빌드할 수 없었다).
