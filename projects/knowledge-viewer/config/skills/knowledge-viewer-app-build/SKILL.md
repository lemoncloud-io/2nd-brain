---
name: knowledge-viewer-app-build
description: >
  볼트에 새 웹 도구 화면(대시보드·검수 화면·입력을 받는 도구·실시간 목록 — 예: 비용 대시보드, 이슈 데스크, 검증 워크벤치)을
  만들거나 기존 html+js 화면을 다시 짤 때 쓴다. 기본값은 React + Vite + TypeScript 이고, 처음부터 볼트 뷰어(projects/knowledge-viewer)의
  앱 플러그인(/apps/<id>)으로 등록되게 설계한다 — 단독 실행과 뷰어 통합이 같은 코드다(오너 지시 2026-11-05).
  "<도구> 화면 만들어줘"·"대시보드 새로 짜줘"·"이 html 도구를 react 로"·"뷰어 앱으로 넣어줘"·"플러그인으로 등록해줘"에 트리거.
  원본 문서를 읽기 전용으로 보여 주는 리뷰 뷰어(viewer.yml)는 project-viewer-build, 뷰어를 띄워 여는 일은 knowledge-viewer-open 이다.
origin: lemoncloud-io/knowledge@f68f1d38:projects/knowledge-viewer/config/skills/knowledge-viewer-app-build/SKILL.md
---

# knowledge-viewer-app-build (뷰어 앱 만들기)

볼트 안의 **웹 도구 화면**은 React + Vite + TypeScript 로 짓고, 처음부터 볼트 뷰어의 **앱 플러그인**으로 등록되게 만든다.
단독 실행(자기 포트)과 뷰어 통합(`/apps/<id>`)이 같은 코드를 쓴다. 계약 정본은
[유닛 README § 확장 지점](../../README.md#확장-지점)이다 — 앱은 코어를 고치지 않고 볼트 확장 층(`projects/knowledge-viewer/ext/`)에 등록한다.
이 스킬은 그 계약을 **새 도구를 만들 때 밟는 순서**로 편 것이다.

## 언제 쓰는가 · 쓰지 않는가

- 쓴다: 입력을 받거나 실행을 시키는 화면, 실시간 목록, 외부 API(AWS·GitHub·AI)를 부르는 도구, 기존 html + 바닐라 js 화면의 재작성.
- 쓰지 않는다: 원본 md 를 읽기 전용으로 보여 주는 리뷰 뷰어 → `project-viewer-build`(viewer.yml + 공용 셸). 단일 html 산출물(archify 그림 등) → 그대로 둔다.
- 왜 플러그인인가: 볼트 산출물 html 은 뷰어가 격리 출처의 iframe 으로만 그린다(뷰어의 격리 모델). 자산이 따로 있는 html 은 개인 이름
  호스트 + 데스크톱 패널에서 본문만 뜨고, 에이전트 모드는 iframe 안을 읽지 못한다. 1차 코드인 도구 화면은 iframe 이 아니라 앱으로 직접 그린다.

## 기본 구조 — `projects/<name>/config/<app>/`

```
server/   핸들러 팩토리 + 단독 진입점 (.mts 또는 .ts, Node 24, 의존성 최소)
src/      React 화면 — App.tsx(루트 컴포넌트) · embed.tsx(뷰어가 import 하는 입구) · host.ts(요청 함수) · styles.css
tests/    node:test — 서버 계약 · 화면 순수 함수 · (가능하면) 렌더 스모크
vite.config.ts  단독 빌드(base './', 상대 자산) · package.json(+ lockfile) · README.md
```

- **서버는 팩토리 하나.** `create<App>({ vaultRoot, token?, basePath?, storeDir|dataDir, securityHeaders?, allowedHost?, assets?, runMode, env, log }) → { handler, close(), … }`.
  단독 진입점(`server/index.mts`)은 이 팩토리에 listen 과 정적 서빙을 얹는다. 뷰어는 팩토리만 부른다(`securityHeaders: false`,
  `allowedHost: () => true`, `assets: null`, `runMode: 'embedded'` — Host·헤더·정적 서빙은 뷰어 몫). 예: `createDemo`(`projects/demo/config/app/server/index.ts`).
- **`basePath` 를 스스로 뗀다.** 뷰어는 `/api/apps/<id>/*` 를 그대로 넘기고, 앱이 `basePath` 를 뗀 뒤 `/api/<앱 경로>` 로 본다. 클라이언트는
  `<basePath>/api/<앱 경로>` 로 부른다. 단독에서는 `basePath` 가 `''` 이다.
- **쓰는 곳은 `<볼트>/tmp/<프로젝트>/<앱>/` 뿐.** 그 밖이면 뷰어가 등록을 거부한다(`ready: false`). 캐시·실행 기록·잠금(`lock.json`)이 여기다.
  단독과 통합이 같은 폴더를 쓰면 잠금으로 동시 실행을 막는다. 단독이 다른 경로를 써 온 앱(예: 홈 캐시)은 통합 모드에서만 `storeDir` 로 옮긴다.
- **토큰은 meta 에서만.** 뷰어가 `/apps/<id>` 응답의 `<meta name="kv-app-token">` 에 그 앱의 토큰을 심는다. 화면은 거기서 읽어 **모든** 요청(GET 포함)에
  `X-Workbench-Token` 을 싣는다. `localStorage` 에 두지 않는다. 단독에서는 앱 자체 발급(예: bootstrap)을 유지해도 된다 — `host.ts` 가 모드를 가른다.
- **POST 는 `/api/apps/<id>/*` 로만.** 조건 셋 — 앱 출처 Host(127.0.0.1·개인 이름), `Origin` = `http://<Host>`, 토큰. 그 밖은 405/403 이다.
- **CSP 아래에서 돈다.** 앱 페이지 CSP 는 `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; …`.
  인라인 `<script>`·외부 폰트·외부 CDN·외부 이미지 주소는 안 된다. 파일 내려받기·아바타는 blob URL 로 그린다.
- **비보안 출처를 전제한다.** 개인 이름 호스트(`http://<이름>`)는 secure context 가 아니다. `crypto.randomUUID`·`navigator.clipboard` 류는 폴백을 둔다
  (앱 안의 작은 함수로). SSE 는 `EventSource` 가 토큰 헤더를 못 실으므로 fetch 스트림으로(통합 모드).
- **CSS 는 앱 루트 아래.** 루트 요소에 `.app-<id>` 를 달고, 테마·상태 data 속성은 `:root` 가 아니라 그 루트에 쓴다(뷰어의 `scope-css` 가 `:root/html/body` 를 루트로 바꾼다).
  전역 reset·`body` 스타일에 기대지 않는다. 단독 빌드는 플러그인 없이 전역 그대로다.
- **자산 경로는 상대(`./`).** Vite `base: './'`. 단독 서버의 정적 루트가 바뀌어도, 뷰어 `/raw/…` 에서 열어도 붙는다.
- **React 는 뷰어와 한 벌.** `react`·`react-dom` 은 뷰어가 `resolve.dedupe` 로 맞춘다. 앱 폴더 `node_modules` 를 쓰고 심링크는 쓰지 않는다.
- **AI·클라우드 자격 증명.** 앱은 `ctx.env`(= 프로세스 env)에서 자기 변수를 읽는다. 없으면 mock 또는 `ready: false` + 사유. 키 값은 로그·화면·문서에 내지 않는다.
  분석 도구(PostHog·GA 등)·원격 호출을 새로 더하지 않는다.
- **코드엔 함수·블록마다 1줄 주석.** 서브에이전트에 맡길 때도 브리프에 적는다.

## 절차

1. **분기.** 읽기 전용 리뷰 뷰어면 `project-viewer-build` 로 간다. 아니면 계속. 기존 html+js 화면이면 요소 id·상태·API 계약을 먼저 적어 둔다(화면 계약).
2. **sdlc 준비물.** 그 프로젝트의 `sdlc/` 에 변경 폴더(가벼운 길이면 intent·spec·verify 만). spec 에 "단독 + 뷰어 앱" 을 P0 로 둔다.
3. **앱 폴더.** 위 구조대로 만든다. 서버 팩토리 → 단독 진입점 → React 화면 → `embed.tsx`(`export function <App>App({ agent, token, basePath })`) 순서.
   `npm test`·`npm run build` 가 단독으로 돈다.
4. **뷰어 등록(볼트 확장 층 세 파일).** 코어(`projects/knowledge-viewer/config/`)는 고치지 않는다. `projects/knowledge-viewer/ext/` 의
   - `server.ts` `apps`: `{ id, title, storeDir: (root) => <root>/tmp/<프로젝트>/<앱>, server: async (ctx) => { const m = await import('<앱>/server/…'); const a = await m.create<App>({ …ctx 옵션 }); return { handle: a.handler, close: a.close }; } }`
   - `ui.ts` `apps`: `{ id, title, icon: <AppIconName>, load: () => import('<앱>/src/embed.tsx').then((m) => ({ App: m.<App>App })), docLink? }` — 아이콘 이름(`grid`·`checklist`·`pr`·`branch`)에 맞는 것이 없으면 코어 변경이다(`src/apps/app-icons.tsx`).
   - `build.ts` `appEmbeds`: `{ id, dir: <앱>/src }`(루트 클래스 기본 `app-<id>`), `installDirs`: `<앱 폴더>`(절대경로)
   id 는 `[a-z0-9-]+`, 세 파일이 같아야 하고, 뷰어 레이아웃 클래스와 겹치면 거부된다. 예시와 제약은 [유닛 README § 확장 지점](../../README.md#확장-지점).
5. **시험.** 볼트 확장 시험(`projects/knowledge-viewer/ext/tests`)에 실제 앱 행을 더한다 — 서버·화면 id 일치, ready, 토큰 없는 GET 401,
   다른 출처 POST 403, `localhost` 거부. 코어 시험(`config/app/tests`)은 합성 앱으로 런타임을 지키므로 고치지 않는다.
   앱 폴더 시험은 단독 계약. 시험은 AI env 를 뺀 셸로 돈다
   (`env -u WORKBENCH_AI_PROVIDERS -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u OPENAI_API_KEY -u OPENAI_MODEL npm --prefix projects/knowledge-viewer/ext test`,
   타입은 `npm --prefix projects/knowledge-viewer/ext run typecheck`).
6. **실측.** 뷰어를 **시험 포트**로 띄운다(상시 8778·8779 와 앱 단독 포트는 쓰지 않는다). `GET /api/apps` 에 `ready: true`, 브라우저 패널에서
   `http://127.0.0.1:<포트>/apps/<id>` — 화면·동작·콘솔 오류 0·CSP 위반 0, `?agent=claude` 도 한 번. 개인 이름 호스트는 배포 뒤 확인한다.
   앱에 doctor(연결 진단)가 있으면 그 결과를 보고에 싣는다(키 값·길이는 싣지 않는다).
7. **문서·스킬.** 앱 README(단독 실행·통합 차이), 볼트 확장 README(`projects/knowledge-viewer/ext/README.md`) 목록에 한 항목.
   여는 스킬(`<앱>-view`)은 뷰어 `/apps/<id>` 를 우선 열고 단독 서버는 폴백으로 둔다. 볼트가 앱 여는 말 스킬을 두었으면 그 표에도 한 줄.
8. **PR.** 앱 저장소가 볼트 안이면 PR 하나, 볼트 밖이면 앱 PR 과 볼트 등록 PR 을 나눈다. 머지 뒤 상시 8778 재배포(master 최신화 → `npm ci`·build → 재시작)와 패널 재확인.

## 서브에이전트에 맡길 때

구현은 서브(Opus)가, 코디네이터는 재검증(`npm test`·build·시험 포트 실측)·git/PR 만. 브리프에 이 스킬 경로와 유닛 README § 확장 지점,
확장 층 세 파일 위치, 시험 포트 범위, "심링크 금지·8778 금지·AI env 뺀 셸·1줄 주석·push/PR 금지" 를 적는다.

## 하지 않는 것

- html + 바닐라 js 로 새 도구를 짓지 않는다. iframe 으로 도구를 끼우지 않는다.
- `tmp/` 밖에 쓰지 않는다. 토큰을 `localStorage`·로그·`/api/info` 에 두지 않는다.
- 외부 CDN·폰트·분석 도구·원격 호출을 더하지 않는다. 뷰어의 다른 경로 보안 헤더를 바꾸지 않는다.
- 상시 8778 을 시험 서버로 쓰지 않는다. 워크트리에 `node_modules` 심링크를 쓰지 않는다.

## 검증 상태

2026-11-05 작성, 2026-11-10 등록 위치를 볼트 확장 층으로 옮겼다. 계약은 앱 넷(단독 + 뷰어 앱)으로 실증됐고, 이 스킬은 그 순서를 새 도구용으로 편 것이다.
볼트별 첫 적용 대상과 실제 등록 목록은 그 볼트의 `projects/knowledge-viewer/` 문서에 둔다.
