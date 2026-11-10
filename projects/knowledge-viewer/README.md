---
type: project
status: active
goal: "볼트 전체를 읽는 읽기 전용 로컬 뷰어 — md·HTML·React 산출물을 /v/<path> 주소 하나로 열고 Claude 브라우저 패널에서 같은 화면을 본다"
due:
milestones: []
next_action: ""
origin: lemoncloud-io/knowledge@121d6640:projects/knowledge-viewer/
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

## 직접 구성하기

이 볼트를 받은 사람이 뷰어를 한 번 띄워 보고, 로그인 때 늘 뜨는 서비스로 올리고, `http://<이름>.local` 로 여는 순서다(macOS).
명령의 정본은 [로컬 이름 프록시의 셋업 절차 문서](../local-nginx-proxy/config/skills/local-nginx-proxy/references/vault-viewer.md)다. 여기에는 이 볼트의 값과 읽는 순서만 둔다. 아래 `§ ①` 같은 표기는 그 문서의 절이다.

**상시 서비스와 이름 등록은 요청이 있을 때만, 수동으로 한다.** 에이전트는 이 볼트의 뷰어를 상시 서비스(LaunchAgent)나 nginx 이름으로 스스로 등록하지 않는다. 볼트 사용자가 요청했을 때만 아래 순서를 안내한다. 등록 — plist 설치, `services.json` 수정, `apply.sh` — 은 사람이 직접 한다. 설치와 한 번 띄워 보기는 요청 없이 해도 된다.

### 이 볼트의 값

| 변수 | 값 | 비고 |
| --- | --- | --- |
| `PORT` | `8778` | 위 § 실행의 기본 포트. git 소스 포트는 그다음 `8779` 다 |
| `NAME` | `doki.local` | 기본 이름이다. 다른 이름으로 바꿔도 된다(소문자 한 단어 + `.local`) |
| `LABEL` | `local.knowledge-viewer.serve` | 상시 서비스(LaunchAgent) 라벨 |
| `LOG` | `~/.local/state/knowledge-viewer/serve.log` | 상시 서비스 로그 |

한 기기에 볼트가 여럿이면 포트·이름·라벨·로그를 볼트마다 달리한다 — 셋업 절차 문서의 "한 기기에 볼트가 여럿일 때" 절을 따른다.

### 순서

1. **설치.** 볼트 루트에서 `npm --prefix projects/project-viewer/config/shell ci` 와 `npm --prefix projects/knowledge-viewer/config/app ci`. § ① 뷰어 앱 설치.
2. **한 번 띄워 보기.** 위 § 실행의 블록으로 빌드하고 띄운다. `http://127.0.0.1:8778/v/wiki/INDEX.md` 가 열리면 된다. 확인했으면 끈다 — 다음 단계의 서비스가 같은 포트를 쓴다.
3. **상시 서비스.** § ② 상시 서비스의 sh 블록에서 첫 네 줄을 위 표의 값으로 두고, 이 볼트의 주 체크아웃 루트에서 돌린다. 서비스는 로그인 때 뜨고, 뜰 때 볼트 전체를 색인한다(수십 초).
4. **이름.** `~/.config/local-nginx-proxy/services.json` 의 `services` 에 아래 한 줄을 넣고 생성기를 돌린다(§ ③ 이름 추가와 적용). 이어서 § ④ 점검.
   ```json
   {"name":"doki","port":8778,"app":"knowledge-viewer","title":"doki 볼트 뷰어","open":"/"}
   ```
   `name` 은 `NAME` 의 첫 단어, `port` 는 `PORT` 다. `app` 이 `knowledge-viewer` 여야 `knowledge-viewer-open` 스킬이 이 이름을 찾는다.
   적용 단계(`sudo sh ~/.local/state/local-nginx-proxy/apply.sh`)는 sudo 가 든다. **사람이 직접 읽고 돌린다.** 에이전트는 sudo 를 돌리지 않는다.
5. **갱신.** 볼트를 최신으로 맞춘 뒤 서비스를 다시 띄운다(§ ⑤ 갱신).
6. **문제 해결.** 502 · 403 · 이름이 안 풀림 · 포트 사용 중은 § ⑦ 문제 해결의 표.

- 확장 층(`ext/`)이 없는 이 볼트에서는 상시 서비스도 앱 없이 뜬다. 그래서 § ⑥ AI 키 파일은 필요 없다.
- 상시 서비스가 `8778` 을 잡고 있으면 작업 중의 개발 서버는 `--port <n> --git-port <n>` 으로 다른 포트에 띄운다.
- 이름으로 연 주소의 꼴(문서 · 앱 · PR 보기)은 [유닛 README](config/README.md) § 이름으로 열기.
