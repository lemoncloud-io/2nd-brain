---
type: project
status: active
goal: "볼트 전체를 읽는 읽기 전용 로컬 뷰어 — md·HTML·React 산출물을 /v/<path> 주소 하나로 열고 Claude 브라우저 패널에서 같은 화면을 본다"
due:
milestones: []
next_action: ""
origin: lemoncloud-io/knowledge@f68f1d38:projects/knowledge-viewer/
---

# knowledge-viewer

## Purpose

볼트의 md·HTML·React 산출물을 `/v/<볼트 상대경로>` 주소 하나로 읽는 로컬 뷰어다(React + Vite 화면, `node:http` 서버, 기본 포트 8778 · git 소스 8779).
트리·검색·역링크·지도(`?view=graph`)·호버 미리보기·PR 리뷰 모드(`src=pr:<n>`, `gh` 인증 그대로 사용)·오른쪽 패널을 제공한다. 명령을 실행하지 않는 읽기 전용 도구다.

## 구성

- `config/` — 코어. 실행·시험 명령과 확장 계약은 [유닛 README](config/README.md)(§ 확장 지점)에 있다.
- `config/app/` — 서버(`server/`)·공유 모듈(`shared/`)·화면(`src/`)·테스트(`tests/`). `node_modules/`·`dist/` 는 Git 제외라 `npm ci` 와 `npm run build` 로 만든다.
- 리뷰 뷰어 셸 [project-viewer](../project-viewer/README.md)(`projects/project-viewer/config/`)가 함께 있어야 한다. 빌드와 시험이 셸 파일을 읽는다.
- 확장 층(`ext/`)은 이 볼트에 없다. 그래서 앱 없이 뜬다(앱 메뉴 없음, `GET /api/apps` → 빈 목록). 앱·가운데 열 화면을 붙이려면 `ext/` 를 만든다 — 붙일 자리는 유닛 README § 확장 지점.
- `config/skills/knowledge-viewer-open/` — "뷰어로 보여줘" 스킬. 등록 레이어 `.claude/skills/knowledge-viewer-open` 상대 심링크.
- `config/skills/knowledge-viewer-app-build/` — 새 도구 화면을 뷰어 앱으로 짓는 절차 스킬. 등록 레이어 `.claude/skills/knowledge-viewer-app-build` 상대 심링크.
- `viewers.yml` — 뷰어 모음 패널 등록부. 이 볼트의 생성 파일이다: 등록 레이어 `.claude/skills` 의 스킬 가운데 frontmatter 에 `viewer:` 블록이 있는 것만 담는다. 스킬을 등록·해제하면 `(cd config/app && npm run viewers-build)` 로 다시 만든다.

## 실행

```bash
(cd projects/project-viewer/config/shell && npm ci)                  # 셸 먼저
cd projects/knowledge-viewer/config/app && npm ci && npm run build   # 테스트: npm test · 타입: npm run typecheck
node projects/knowledge-viewer/config/app/start.ts                     # 볼트 루트에서 → http://127.0.0.1:8778/v/wiki/INDEX.md
```

브라우저 패널은 기계 로컬 `.claude/launch.json`(Git 제외)의 `knowledge-viewer` 항목으로 띄운다(스킬 § 절차). 포트가 겹치면 `--port <n> --git-port <n>`.
