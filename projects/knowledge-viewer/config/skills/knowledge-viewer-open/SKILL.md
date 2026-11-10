---
name: knowledge-viewer-open
description: >
  "뷰어로 보여줘 <경로>"·"<문서> 렌더해서 보여줘"·"볼트 뷰어 열어줘"·"knowledge viewer"·
  "지도로 보여줘 <경로>"·"연결 그래프 보여줘" 같은 요청에
  볼트 읽기 뷰어(projects/knowledge-viewer)를 띄우고 요청한 문서를 브라우저 패널에서 연다.
  서버는 launch.json 항목 knowledge-viewer(8778)로 올리고, 주소는 /v/<path>?agent=claude&src=local#<anchor>.
  "PR #n 보여줘 [경로]"·"PR n 리뷰 모드로 열어줘"면 src=pr:<n> 으로 그 PR 의 볼트를 연다.
  뷰어에 등록된 앱을 열 때는 GET /api/apps 의 title 로 id 를 찾아 앱 화면 /apps/<id> 를 연다.
  원본 문서를 고치지 않는다. private/는 로컬 기본값으로 보이고, 숨기는 것은 사용자가 시킬 때만이다.
viewer:
  id: knowledge-viewer
  order: 30
  title: 볼트 뷰어
  description: 볼트 문서를 렌더해 읽는 이 뷰어(knowledge-viewer). 기본 포트 8778.
  open:
    kind: server
    url: http://127.0.0.1:8778/
    port: 8778
    launch: knowledge-viewer
    ask: 볼트 뷰어 열어줘
origin: lemoncloud-io/knowledge@f68f1d38:projects/knowledge-viewer/config/skills/knowledge-viewer-open/SKILL.md
---

# knowledge-viewer-open (볼트 뷰어 열기)

볼트 문서를 위키링크·역링크·호버 미리보기가 있는 화면으로 **보여 주는** 스킬이다. 앱(서버·SPA)의
구조와 실행 명령은 `projects/knowledge-viewer/README.md` § Current Context가 정본이고, 이 스킬은
띄워서 여는 절차만 갖는다.

## 트리거

- "뷰어로 보여줘 wiki/INDEX.md" · "이 문서 렌더해서 보여줘" · "볼트 뷰어 열어줘" · "knowledge viewer"
- 경로를 말하지 않으면 `wiki/INDEX.md`를 연다. 문서 이름만 말하면 볼트에서 경로를 찾아 연다.
- 앵커가 붙는 말("… 의 '설정' 절")이면 슬러그를 `#` 뒤에 붙인다.
- "지도로 보여줘 wiki/INDEX.md" · "연결 그래프 보여줘" — 그 문서를 중심으로 한 연결 지도(그래프 뷰)를
  연다. 경로를 말하지 않으면 `wiki/INDEX.md`가 중심이다. § 절차 5의 주소에 `&view=graph`를 붙인다
  (§ 주소 계약). 반경·2D·전체 보기를 말하면 `depth`·`mode`·`all` 질의 인자로 옮긴다.
- "PR #n 보여줘 [경로]" · "PR n 리뷰 모드로 열어줘" — PR 리뷰 모드. § 절차 1~4는 같고, 5의 주소만 다르다.
  에이전트 모드는 트리와 오른쪽 열(PR 상세 패널)을 그리지 않으므로 바뀐 파일은 API 로 고른다.
  - (a) 경로를 말했으면 → `http://127.0.0.1:8778/v/<path>?agent=claude&src=pr:<n>#<anchor>` 로 `navigate`.
  - (b) 경로가 없으면 → `GET http://127.0.0.1:8778/api/pr/<n>/changes` 를 읽는다. JSON 의 `files[]` 에서
    `path` 가 `.md` 로 끝나고 `status` 가 `D` 가 아닌 첫 항목을 골라 (a)처럼 연다. 그런 파일이 없으면
    "이 PR 에 바뀐 md 가 없다"고 알리고 끝낸다.
  - (c) 실패(`gh` 미로그인·`origin` 원격 없음·없는 PR) → 본문 자리에 사유가 안내 문구(`p.notice`)로 뜬다.
    `/api/pr/<n>/changes` 는 503 과 `error` 한 줄을 준다. 그 사유를 그대로 사용자에게 전한다.
  - (d) 사람이 PR 상세 패널·트리 배지를 보려면 같은 주소에서 `agent=claude` 를 뺀 주소를 연다.
    패널 머리줄의 닫기(×, `data-action="exit-pr"`)는 같은 문서를 main 소스로 돌려 연다.
- 등록된 앱이 있으면 — "<앱 이름> 열어줘"처럼 뷰어 앱을 말할 때 — 앱 화면 `/apps/<id>` 를 연다. § 절차 1~4는 같고, 5의 주소만 다르다.
  - id 는 `GET http://127.0.0.1:8778/api/apps` 의 `apps[]` 에서 `title` 로 찾는다. 맞는 앱이 없으면 그렇게 알리고 끝낸다.
  - 에이전트가 읽을 때 → `http://127.0.0.1:8778/apps/<id>?agent=claude`. 사람에게 보일 때는 `agent` 를 뺀다(기존 규칙).
  - 화면 상태는 앱 해시다. 뷰어는 해시를 앵커로 읽지 않는다. `ready: false` 면 `reason` 을 그대로 전한다.
  - 볼트가 앱별 여는 말·단독 실행 안내를 자기 스킬로 두었으면(볼트 확장 층 `projects/knowledge-viewer/ext/`) 그 스킬이 이 절차를 쓴다.

## 절차

1. **볼트 루트 확인.** `VAULT_DIR` 또는 현재 작업 디렉터리(`VAULT_RULES.md`·`wiki/`·`projects/`가
   있는 곳). 열 파일이 볼트 안에 있는지 확인한다. 볼트 밖 파일은 열지 않는다.
2. **개인 주소(설정한 사람만).** 볼트에 `projects/local-name-proxy/config/local-name-proxy/render.mjs`가
   없으면 3으로 간다. 있으면 볼트 루트에서 부른다. `--path`에는 5의 `/v/…` 경로를 질의·`#앵커`째 넣는다.
   ```bash
   node projects/local-name-proxy/config/local-name-proxy/render.mjs url --app knowledge-viewer \
     --path '<5의 /v/… 경로 — 질의·#앵커 포함>' --fallback http://127.0.0.1:8778
   ```
   JSON 한 줄 `{"url":"…","via":"name"|"fallback","reason":"…"}`이 나온다. 이 도구는 그 사람의 기계 로컬
   파일만 읽는다. 이름은 사람마다 다르다. 스킬과 커밋하는 문서에는 이름을 적지 않는다.
   - `via`가 `fallback`이면 3으로 간다. 지금 절차 그대로다.
   - `via`가 `name`이면 같은 볼트인지 견준다. 상시 서버는 볼트 루트 하나(그 사람의 메인 체크아웃)만 낸다.
     워크트리 세션은 자기 작업 트리를 봐야 한다(`src=local`은 에이전트가 고친 것이다).
     ```bash
     node projects/knowledge-viewer/config/app/same-vault.ts '<url>'
     ```
     그 서버 `/api/info`의 `rootId`와 이 세션 볼트 루트(`VAULT_DIR`, 정식 경로)의 `rootId`를 견준다.
     `rootId`는 볼트 루트 폴더의 지문이다(경로가 아니다). JSON 한 줄 `{"same":…,"port":…,"reason":"…"}`이 나온다.
     - `same`이 `true`면 `url`로 `navigate`한다. 3·4는 건너뛴다. 그 사람의 상시 서버가 답한다. 5의 `tabs_select`와
       6의 확인은 같다. PR (b)처럼 경로를 API 로 고르면 먼저 `--path /v/`로 출처를 정하고, API 도 그 출처에 묻는다.
     - `same`이 `false`면(다른 폴더, `rootId` 없음, 못 읽음) 이름을 쓰지 않는다. 3부터 그대로 한다.
       `port`가 3의 포트(기본 8778)와 같으면 그 포트는 상시 서버 것이다. 그때는 § 폴백 A처럼 다른 포트 항목으로
       띄운다. 같은 포트로 `preview_start`하면 작업 트리가 아니라 상시 서버의 폴더가 보인다.
3. **launch.json 항목.** `.claude/launch.json`은 기계 로컬(gitignored)이다. `knowledge-viewer`
   항목이 없으면 추가한다.
   ```json
   { "name": "knowledge-viewer", "runtimeExecutable": "node",
     "runtimeArgs": ["projects/knowledge-viewer/config/app/start.ts"], "port": 8778 }
   ```
4. **서버 올리기.** `preview_start {name: "knowledge-viewer"}`. 이미 떠 있으면 재사용된다.
   시작할 때 볼트 전체를 색인하므로(이 볼트에서 약 14초) 서버가 주소를 찍기까지 시간이 걸린다.
   `http://127.0.0.1:8778/api/tree?dir=` 가 200을 줄 때까지 기다린다(최대 60초, 1~2초 간격 폴링).
5. **열기.** `navigate` →
   `http://127.0.0.1:8778/v/<path>?agent=claude&src=local#<anchor>` (앵커가 없으면 `#…` 생략).
   **`src=local` 을 명시한다.** 화면은 `src` 가 없으면 `main`(origin/master)을 보이는데, 이 스킬은
   에이전트가 고친 작업 트리를 보여야 한다. PR 리뷰 모드면 `src=pr:<n>` 이다(§ 트리거).
   **`localhost`가 아니라 `127.0.0.1`로 연다.** 화면과 `/api`는 `127.0.0.1`에서만 열리고,
   `localhost` 요청은 `/`·`/v/*`가 302로 넘어가며 `/api`는 404다. 이어서 `tabs_select`로 탭을
   앞으로 가져온다. 패널이 숨김 상태면 "패널 표시를 켜 달라"고 한 줄 덧붙인다.
6. **확인.** `read_console_messages onlyErrors`가 비어 있고 본문이 보이면 끝이다. 사용자에게
   주소 한 줄을 알린다. 문서 안 요소는 `data-vault-path` 속성으로 집을 수 있다.

## 주소 계약

| 열 대상 | 주소 | 비고 |
| --- | --- | --- |
| md 문서 | `/v/<path>#<slug>` | 슬러그는 제목의 github-slugger 값 |
| html 산출물 | `/v/<path>#<안쪽 라우트>` | 에이전트 모드에서는 원본 주소로 자동으로 건너뛴다. `local`은 `localhost:8778/raw/<path>#…`, `src=main`·`src=pr:<n>`은 git 포트 `localhost:8779/raw/@main/<path>#…`·`localhost:8779/raw/@pr/<n>/<path>#…` |
| 프로젝트 뷰어(viewer.yml) | `/v/<project>/config/viewer.yml#/p/<페이지>/<항목>` | 통합 보기 — 셸 화면을 iframe 없이 이 화면 안에 그린다(빌드 불필요). 해시는 셸 라우트(`#/glossary/<용어>`·`#/docs`·`#/search/<질의>`), `#L12`는 원문. 사람 모드만이고 에이전트 모드는 원문이다 |
| 폴더 | `/v/<dir>/README.md` | 폴더 색인이 없으면 트리에서 연다 |
| 홈 | `/` 또는 `/v/` | `wiki/INDEX.md` |
| 연결 지도(3D) | `/v/<path>?view=graph` | 그 문서가 중심. 질의 인자 `depth=1\|2\|3`(반경), `mode=2d\|3d`, `all=1`(볼트 전체) |
| 연결 지도(텍스트 목록) | `/v/<path>?agent=claude&src=local&view=graph` | 같은 데이터의 목록. 항목에 `data-vault-path`가 붙는다. 지도 데이터는 소스와 무관하게 작업 트리 색인이고, `src`는 항목 링크가 싣는다 |
| 소스 | `?src=local\|main\|pr:<n>` | 화면 기본은 `main`. 이 스킬은 `local`, PR 리뷰는 `pr:<n>`. html 원본은 `/raw/@main/<path>`·`/raw/@pr/<n>/<path>` 접두(`local` 은 접두 없음) |
| 질의 순서 | `?agent=claude&src=…&view=graph&depth=…&mode=…&all=1` | 기본값(`src=main`·`view=doc`·`depth=2`·`mode=3d`)은 쓰지 않는다 |
| 앱 화면 | `/apps/<id>?agent=claude#<앱 해시>` | 가운데 열 전체가 앱이다. 등록된 앱과 그 id 는 `GET /api/apps` 가 준다. 해시는 앱 것이다. 앱 API 는 `/api/apps/<id>/…`(토큰 필요) — 스킬이 직접 부르지 않는다. 목록은 `GET /api/apps` |

- `?agent=claude`는 에이전트 모드다. 검색 상자가 숨고 `data-vault-path`가 붙으며, iframe 안은
  읽을 수 없으므로 html은 원본 주소(`/raw/`)로 연다.
- html은 사람 모드에서 샌드박스 iframe(`allow-scripts allow-same-origin allow-popups`)으로 열린다.
  iframe 출처는 `localhost`이고 `/raw/`만 받는다. git 소스(`main`·`pr:<n>`)의 html은 git 포트
  (기본 주 포트 + 1 = 8779) 출처에서 열린다. 그 출처는 `/raw/@main/…`·`/raw/@pr/<n>/…`만 낸다.
- 경로의 공백·한글은 `encodeURI`로 인코딩한다.
- 연결 지도는 3D 라이브러리를 늦게 불러온다. 에이전트가 위치를 집어야 하면 `agent=claude`로
  연다(캔버스 대신 텍스트 목록이 나온다). 사람에게 보여 줄 때는 `agent=claude`를 뺀다.

## 폴백

- **A. 8778 포트가 다른 프로세스에 잡혀 있다** — `knowledge-viewer-2` 항목을 `--port 8780`으로
  등록한다. 기존 프로세스는 죽이지 않는다. git 소스 출처 포트는 8781이 된다. 8779(git 포트)만
  잡혀 있어도 서버는 시작하지 않는다. 그때는 `--git-port <빈 포트>`를 더한다.
  ```json
  { "name": "knowledge-viewer-2", "runtimeExecutable": "node",
    "runtimeArgs": ["projects/knowledge-viewer/config/app/start.ts", "--port", "8780"], "port": 8780 }
  ```
  이때 주소의 포트도 8780으로 바꾼다. (8770은 macOS `sharingd`가 쓰므로 기본값으로 쓰지 않는다.)
- **B. `node_modules`나 `dist`가 없다** — 첫 실행에서 `start.ts`가 의존성을 설치하고 빌드한다.
  평소보다 오래 걸린다고 사용자에게 한 줄 알린다. 설치에 실패하면 출력의 오류를 그대로 전한다.
- **C. 브라우저 패널 도구가 없다** — 서버를 터미널로 띄우는 명령
  (`node projects/knowledge-viewer/config/app/start.ts`)과 주소 `http://127.0.0.1:8778/v/<path>`를
  알려 주고 끝낸다.
- **D. 문서가 안 열린다(404)** — 서버가 `--hide-private`(또는 `KNOWLEDGE_VIEWER_HIDE_PRIVATE=1`)로
  떠 있으면 `private/` 아래가 숨겨진다. 사용자가 원하면 그 플래그 없는 항목으로 다시 띄운다. 시키지 않았으면 이유만 알린다.

## 하지 않는 것

- 원본 md를 수정하지 않는다. 뷰어는 읽기 전용이다.
- `private/`를 임의로 숨기지 않는다. 로컬 기본값은 표시이고(사용자 결정 2026-10-23), 숨김(`--hide-private`)은 사용자가 시킬 때만이다.
- Artifact로 게시하지 않는다. 볼트 문서는 내부 자료이고 이 뷰어는 로컬 전용이다.
- 기존 서버 프로세스를 죽이지 않는다. 포트 충돌은 § 폴백 A로 푼다.
