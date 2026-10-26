---
type: project
status: active
goal: "볼트 전체를 읽는 읽기 전용 로컬 뷰어 — md·HTML·React 산출물을 /v/<path> 주소 하나로 열고 Claude 브라우저 패널에서 같은 화면을 본다"
due:
milestones: []
next_action: ""
origin: lemoncloud-io/knowledge@d26ab8bf:projects/knowledge-viewer/
---

# knowledge-viewer

## Purpose

볼트의 md·HTML·React 산출물을 `/v/<볼트 상대경로>` 주소 하나로 읽는 로컬 뷰어다(React + Vite 화면, `node:http` 서버, 기본 포트 8778 · git 소스 8779).
트리·검색·역링크·지도(`?view=graph`)·호버 미리보기·PR 리뷰 모드(`src=pr:<n>`, `gh` 인증 그대로 사용)·오른쪽 패널을 제공한다. 명령을 실행하지 않는 읽기 전용 도구다.

## 구성

- `config/app/` — 서버(`server/`)·공유 모듈(`shared/`)·화면(`src/`)·테스트(`tests/`). `node_modules/`·`dist/` 는 Git 제외라 `npm ci` 와 `npm run build` 로 만든다.
- `config/skills/knowledge-viewer-open/` — "뷰어로 보여줘" 스킬. 등록 레이어 `.claude/skills/knowledge-viewer-open` 상대 심링크.
- `viewers.yml` — 뷰어 모음 패널 등록부. 이 볼트의 생성 파일이다: 등록 레이어 `.claude/skills` 의 스킬 가운데 frontmatter 에 `viewer:` 블록이 있는 것만 담는다. 스킬을 등록·해제하면 `(cd config/app && npm run viewers-build)` 로 다시 만든다.

## 실행

```bash
cd projects/knowledge-viewer/config/app && npm ci && npm run build   # 테스트: npm test
node projects/knowledge-viewer/config/app/start.ts                     # 볼트 루트에서 → http://127.0.0.1:8778/v/wiki/INDEX.md
```

브라우저 패널은 기계 로컬 `.claude/launch.json`(Git 제외)의 `knowledge-viewer` 항목으로 띄운다(스킬 § 절차). 포트가 겹치면 `--port <n> --git-port <n>`.
