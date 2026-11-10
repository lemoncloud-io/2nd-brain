# 볼트 읽기 뷰어 — 코어 유닛
<!-- origin: lemoncloud-io/knowledge@f68f1d38:projects/knowledge-viewer/config/README.md -->

볼트 문서를 주소 하나(`/v/<path>`)로 여는 읽기 전용 로컬 뷰어다. md 리더·HTML 틀·연결 지도·검색·사이드 패널·PR 리뷰 모드·앱 플러그인 런타임이 여기 있다.
이 폴더(`config/`)는 볼트마다 같은 코드다. 볼트마다 다른 것(앱 등록·가운데 열 화면·기본 허용 호스트)은 이 폴더 밖 볼트 소유 확장 층(`../ext/`)에 둔다.
코어는 확장이 없어도 설치·시험·타입 검사·빌드가 통과한다.

- 앱: `app/` — 서버(`server/`)·화면(`src/`)·공용(`shared/`). 의존성은 `app/package.json` 에만 둔다.
- 동반 유닛: 리뷰 뷰어 셸(`projects/project-viewer/config/`). 빌드·시험이 셸 파일을 읽으므로 함께 복제한다.
- 스킬: [knowledge-viewer-open](skills/knowledge-viewer-open/SKILL.md)(띄워서 열기) · [knowledge-viewer-app-build](skills/knowledge-viewer-app-build/SKILL.md)(새 도구 화면을 앱으로).

## 실행과 시험

| 용도 | 명령 (`app/` 기준) | 비고 |
| --- | --- | --- |
| 설치 | `npm ci` | 셸도 먼저: `npm --prefix ../../../project-viewer/config/shell ci` |
| 실행 | `npm start` | 첫 실행은 설치·빌드를 한다. 기본 포트 8778, git 소스 출처 포트 8779 |
| 개발 | `npm run dev` | Vite 8777 이 8778 서버로 프록시한다 |
| 시험 | `npm test` | 확장을 보지 않는다(가상 모듈은 늘 빈 모듈) |
| 타입 | `npm run typecheck` | 확장 구현을 보지 않는다(계약 d.ts 만) |
| 빌드 | `npm run build` | `dist/` 를 만든다. 확장이 있으면 그 화면·앱이 묶음에 든다 |
| 등록부 | `npm run viewers-build` (`-- --check`) | 뷰어 모음 등록부를 만든다 — § 뷰어 모음 등록부 |

확장을 끈 채로 보려면 `KNOWLEDGE_VIEWER_EXT=off npm run build` 처럼 환경 변수를 준다.

## 확장 지점

코어를 고치지 않고 붙일 수 있는 것은 아래가 전부다. 확장은 세 파일에 나눠 쓴다.

| 파일 | 실행 환경 | 기본 내보내기 | 계약 정본 |
| --- | --- | --- | --- |
| `ext/ui.ts` | 브라우저(뷰어 묶음) | `defineUiExtension({...})` | `app/src/ext/define.ts` |
| `ext/server.ts` | Node(서버 시작 때 한 번) | `defineServerExtension({...})` | `app/server/ext.ts` |
| `ext/build.ts` | Node(Vite 설정·`start.ts` 설치 전) | `defineBuildExtension({...})` | `app/ext-build.ts` |

세 파일 모두 선택이다. 없는 파일은 빈 확장으로 읽는다.

### 위치

- 기본 확장 폴더는 유닛 기준 `../../ext` 다. 곧 `config/` 의 형제 `ext/` 다(`app/ext-locate.ts` 의 `DEFAULT_EXT_DIR`).
- 확장은 코드라서 **빌드하는 체크아웃의 것**을 쓴다. `--vault` 로 다른 볼트를 띄워도 확장은 바뀌지 않는다.
- 환경 변수 `KNOWLEDGE_VIEWER_EXT` 가 바꾼다. `off` 면 확장 없음, 그 밖의 값은 폴더 경로다. 준 폴더가 없으면 던진다.
- 빌드(`vite.config.ts`)·시작(`start.ts`)·서버(`server/main.ts`)가 같은 함수(`extDir`·`extFile`)로 같은 폴더를 읽는다.
- 화면 쪽은 가상 모듈 `virtual:knowledge-viewer-ext/ui` 다. Vite 플러그인 `extVirtual()` 이 `ext/ui.ts` 로, 없으면 `app/src/ext/empty.ts` 로 푼다.
- Node 쪽은 파일이 있으면 동적 `import()` 로 읽는다. 타입 검사는 계산된 주소를 따라가지 않는다.

### 깨진 확장은 시작을 멈춘다

- 모양이 틀리면(id 문법·중복·예약어, 단축키 충돌, API 경로 규칙, 절대경로가 아닌 폴더) 던진다. 확장 `server.ts`·`build.ts` 를 import 하지 못해도 던진다.
- 그래서 빌드와 서버 시작이 한 줄 사유를 내고 멈춘다. 코드 실수라 조용히 빈 확장으로 낮추지 않는다.
- 화면 쪽 검사(`app/src/ext/registry.ts` 의 `checkUiExtension`)는 묶음이 읽힐 때 던진다. 깨진 `ui.ts` 는 브라우저에서 드러나므로 확장의 시험이 먼저 잡아야 한다.
- 예외: 앱 하나의 `server(ctx)` 생성 실패는 지금처럼 그 앱만 503 이다. 화면 청크 import 실패도 그 자리에만 안내를 남긴다.

### 1. 앱(`/apps/<id>`)

앱은 가운데 열 전체 화면과 API 묶음(`/api/apps/<id>/*`) 하나다. 세 파일에 같은 id 로 한 항목씩 넣는다.

**화면 — `ui.ts` 의 `apps`**

```ts
type AppHostProps = { apiBase: string; token: string; agent: boolean; navigate: (vaultPath: string) => void };
type AppIconName = 'grid' | 'checklist' | 'pr' | 'branch';
type ViewerAppUi = {
  id: string;                     // [a-z0-9-]+, 확장 안에서 겹치지 않는다
  title: string;                  // 앱 메뉴·뷰어 모음 패널의 이름
  icon: AppIconName;              // 모르는 이름은 격자 아이콘
  load: () => Promise<{ App: React.ComponentType<AppHostProps> }>;  // 지연 청크
  docLink?: (vaultPath: string) => string | null;  // 이 앱이 다루는 문서면 앱 해시(# 없이)
};
```

`docLink` 는 뷰어 묶음에 바로 든다. 가볍고 순수한 함수여야 한다.

**서버 — `server.ts` 의 `apps`**

```ts
type AppServerContext = { vaultRoot: string; basePath: string; token: string; env: NodeJS.ProcessEnv; log: (line: string) => void };
type AppServer = { handle: RequestListener; close(): Promise<void> };
type ViewerApp = {
  id: string;
  title: string;
  server: (ctx: AppServerContext) => Promise<AppServer>;  // 첫 요청 때 한 번. 여기서 지연 import 한다
  storeDir?: (vaultRoot: string) => string;              // <vaultRoot>/tmp/<자기 폴더> 아래만
};
```

- 뷰어가 앱마다 토큰을 만든다. `/apps/<id>` 응답의 `<meta name="kv-app-token">` 에만 싣는다.
- `/api/apps/<id>/*` 는 GET·HEAD 도 `X-Workbench-Token` 이 맞아야 한다. POST 는 앱 출처·같은 Origin·토큰이 모두 맞을 때만 앱으로 간다.
- `/apps/<id>` 응답에는 엄격한 CSP 가 붙는다. 인라인 스크립트·외부 폰트·외부 CDN 은 안 된다.
- `storeDir` 가 `tmp/` 밖이면 등록을 거부한다(`ready: false` 와 사유).

**빌드 — `build.ts` 의 `appEmbeds`·`installDirs`**

```ts
type AppEmbedEntry = { id: string; dir: string; rootClass?: string };  // dir 은 절대경로(화면 src), rootClass 기본 'app-<id>'
```

- `appEmbeds` 의 폴더 CSS 는 `.app-<id>` 아래로 가둔다. 뷰어 CSS 는 그 안에 닿지 않는다. React 는 뷰어 한 벌이다.
- `installDirs` 는 `start.ts` 가 lockfile 기준으로 `npm ci` 할 앱 폴더(절대경로)다. 앱의 서버 지연 import 와 화면 묶음이 그 `node_modules` 를 쓴다.

**없을 때**: 앱 메뉴가 없다. `GET /api/apps` → `{ "apps": [] }`.

**제약**: 앱 id 는 뷰어 레이아웃 클래스(`app-agent`·`app-left-collapsed`·`app-drawer-*` 등)와 겹치면 안 된다. 세 파일의 id 가 같아야 한다 — 확장의 시험으로 지킨다.

### 2. 가운데 열 화면(`?view=<id>`)

문서 대신 가운데 열 전체를 그리는 화면이다. 상단바 단추·단축키·옛 주소를 함께 선언한다. `ui.ts` 의 `views` 에 넣는다.

```ts
type FramePorts = { gitRawPort: number | null; rawPort: number | null; ready: boolean };
type CenterViewProps = { src: Source; agent: boolean; navigate: NavigateFn; frame: FramePorts };
interface CenterViewExtension {
  id: string;                                  // ?view=<id>. /^[a-z][a-z0-9-]*$/, 'doc'·'graph' 는 예약어
  title: string;                               // 단추 aria-label, title "<title> (<KEY>)", 불러오는 중 문구
  icon: ComponentType<{ size?: number }>;      // 상단바 단추 아이콘(src/ext/icons.ts)
  home: { path: string; anchor?: string };     // 단추·단축키가 여는 곳. 이 보기의 문서 경로는 늘 home.path
  legacyPaths?: readonly string[];             // 이 경로로 들어온 주소는 이 보기로 연다(옛 주소)
  shortcut?: { key: string; desc: string };    // 수식어 없는 소문자·숫자 한 글자
  hashRouted?: boolean;                        // 안쪽 HashRouter: 앵커 = '#/…' 해시, 소스 전환 때 해시 유지
  hidePanels?: readonly string[];              // 이 보기에서 그리지 않을 오른쪽 패널 id(예: 'toc')
  archifyZoom?: boolean;                       // ⚙ "그림 글자" 줄을 보인다
  load: () => Promise<{ default: ComponentType<CenterViewProps> }>;  // 지연 청크
}
```

- 상단바 단추는 `<a class="icon-btn <id>-toggle">` 다. 지금 보기면 `aria-current` 가 붙는다.
- 단축키는 도움말 표에 `view.ext.<id>` 행으로 들어간다. 누르면 `home` 으로 간다.
- 화면 청크는 코어 내부 파일 대신 `app/src/ext/host.ts` 에서 받는다: `hrefFor`·`isPlainClick`·`ChangedEventsContext`·`sourceKey`·`ArchifyFrame`(archify 산출 HTML 을 샌드박스 iframe 으로, 테마·높이 맞춤·배율)·`useArchifyZoom`.

**없을 때**: 단추·단축키·`?view=` 라우트가 없다. 모르는 `view` 는 리더로, 옛 경로는 일반 문서로 연다. ⚙ "그림 글자" 줄도 없다.

**제약**: 단축키가 코어 키(`g`·`j`·`k`·`p`·`b`·`t`·`/`·`?`·`[`·`]`·`,` 등)나 다른 보기와 겹치면 시작 때 거부한다.

### 3. 서버 API 경로

코어에 없는 읽기 API 를 더한다. `server.ts` 의 `api` 에 넣는다.

```ts
type ExtApiContext = {
  includePrivate: boolean;
  readSource(url: URL): Promise<{ src: Source; reader: SourceReader } | ApiResult>;  // ?src= 를 읽는다. 틀리면 오류 응답
};
type ExtApiRoute = { path: string; handle(ctx: ExtApiContext, url: URL): Promise<ApiResult> };
```

- 확장 서버 코드는 코어를 `app/server/ext-api.ts` 에서만 받는다: `z`(zod)·`segmentsBlocked`·`Source`·`SourceReader`·`ApiResult`·`ExtApiContext`·`ExtApiRoute`. 확장 폴더에는 `node_modules` 가 없다.
- 경로 문법은 `^/api/[a-z0-9-]+(/[a-z0-9-]+)*$` 다.
- 코어 경로(`CORE_API_PATHS`)와 겹치면 안 된다. 코어 접두 `/api/apps`·`/api/panels`·`/api/events`·`/api/graph`·`/api/pr` 아래도 안 된다. 확장끼리도 겹치면 안 된다.
- 코어 경로가 늘 먼저다. 확장 경로는 코어가 모르는 경로에만 닿는다. GET·HEAD 만 온다(POST 는 405).

**없을 때**: 404.

### 4. 원격 이미지 기본 허용 호스트

⚙ "이미지" 줄의 허용 호스트 목록 기본값이다. "기본값" 단추가 이 값으로 되돌린다. `ui.ts` 의 `remoteImageHosts` 에 넣는다.

```ts
remoteImageHosts?: readonly string[];   // 'img.example.com' 또는 '*.cdn.example.org'
```

**없을 때**: 빈 목록이다. 원격 이미지는 사용자가 호스트를 더하거나 하나씩 불러올 때만 그린다.

**제약**: 빈 문자열은 거부한다. 꼴이 틀린 칸(홀로 `*`·포트·경로)은 비교 때 무시된다.

### 5. 빌드 플러그인·설치·감시 폴더

`build.ts` 의 나머지 칸이다.

```ts
interface ViewerBuildExtension {
  appEmbeds?: readonly AppEmbedEntry[];
  plugins?: readonly unknown[];        // Vite 플러그인. 코어 플러그인보다 앞에 놓인다
  installDirs?: readonly string[];     // start.ts 가 npm ci 할 폴더(절대경로)
  watch?: readonly string[];           // dist 신선도 판정에 더할 경로(절대경로, 폴더는 재귀)
}
```

- 가운데 열 화면이 다른 패키지의 소스를 묶음에 넣으면 그 Vite 플러그인을 `plugins` 로 준다. CSS 가두기 규칙은 `app/ext-build.ts` 가 다시 내보낸다: `scopeCss`·`excludeCss`·`HOST_STYLES_DIR`·`APP_DEDUPE`.
- `watch` 의 파일이 `dist/` 보다 새것이면 `start.ts` 가 다시 빌드한다.

**없을 때**: 플러그인·설치·감시 대상이 없다.

### 순환 금지 규칙

- `ui.ts` 와 그것이 정적으로 import 하는 모듈은 `app/src/ext/define.ts`·`app/src/ext/icons.ts` 와 자기 쪽 순수 모듈만 쓴다.
- `app/src/ext/host.ts` 는 `load()` 안의 지연 청크에서만 쓴다. host 는 라우트를 거쳐 등록부를 부른다.
- 어기면 `registry.ts → virtual → ui.ts → route.ts → registry.ts` 순환이 생기고 모듈 초기화 오류(TDZ)가 난다. 코어 시험이 `define.ts` 의 정적 import 그래프에 등록부가 없음을 지킨다.
- `build.ts` 와 그 정적 import 는 node 내장과 이 유닛·셸의 의존성 없는 파일뿐이다. Vite 설정을 읽을 때와 설치 전에 쓰인다.

### 확장의 시험과 타입 검사

유닛 시험·타입 검사는 확장을 보지 않는다. 확장 폴더에 자기 `package.json` 을 두고 유닛의 실행기를 빌려 쓴다.

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import ../config/app/tests/helpers/ext-hooks-vault.ts --test \"tests/**/*.test.ts\"",
    "typecheck": "node ../config/app/node_modules/typescript/bin/tsc -p tsconfig.json"
  }
}
```

- `ext-hooks-vault.ts` 는 가상 모듈을 실제 `ui.ts` 로 푼다. 유닛 밖 파일이 부르는 React 계열은 유닛의 한 벌로 푼다(Vite dedupe 와 같은 뜻).
- `tsconfig.json` 은 `../config/app/tsconfig.json` 을 잇는다. `compilerOptions.paths` 로 `react`·`react-dom`·`react/*`·`react-dom/*`·`react-router-dom` 을 `../config/app/node_modules` 에 고정한다. 여러 `node_modules` 에 같은 판 사본이 있으면 타입이 두 벌로 실린다.
- `files` 에 유닛의 선언 파일 넷을 넣는다: `node_modules/vite/client.d.ts`·`src/ext/virtual.d.ts`·`src/viewer-bundle.d.ts`·`src/graph/d3-force-3d.d.ts`.
- 다른 패키지 폴더의 `.ts` 를 확장이 부르면 그 폴더에 `{"type": "module"}` `package.json` 을 둔다. 없으면 상위 `package.json` 을 따라 CJS 로 읽힐 수 있다.

### 최소 예시 — 합성 `demo` 앱 하나

```ts
// ext/ui.ts
import { defineUiExtension } from '../config/app/src/ext/define.ts';
export default defineUiExtension({
  apps: [{ id: 'demo', title: '데모', icon: 'grid', load: () => import('../../demo/config/app/src/embed.tsx').then((m) => ({ App: m.DemoApp })) }],
  remoteImageHosts: ['img.example.com'],
});
```

```ts
// ext/server.ts
import path from 'node:path';
import { defineServerExtension } from '../config/app/server/ext.ts';
export default defineServerExtension({
  apps: [{
    id: 'demo',
    title: '데모',
    storeDir: (root) => path.join(root, 'tmp', 'demo'),
    // 첫 요청 때 앱 서버를 만든다. Host 판정·보안 헤더·정적 서빙은 뷰어가 맡는다.
    server: async (ctx) => {
      const m = await import('../../demo/config/app/server/index.ts');
      const s = await m.createDemo({ vaultRoot: ctx.vaultRoot, token: ctx.token, basePath: ctx.basePath, env: ctx.env, log: ctx.log });
      return { handle: s.handler, close: s.close };
    },
  }],
});
```

```ts
// ext/build.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineBuildExtension } from '../config/app/ext-build.ts';
const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo', 'config', 'app');
export default defineBuildExtension({
  appEmbeds: [{ id: 'demo', dir: path.join(demo, 'src') }],
  installDirs: [demo],
});
```

앱 하나를 짓는 순서와 앱 쪽 계약(`embed.tsx`·서버 팩토리·토큰·CSP)은 [knowledge-viewer-app-build](skills/knowledge-viewer-app-build/SKILL.md) 에 있다.

## 뷰어 모음 등록부

오른쪽 열 `뷰어 모음` 패널은 볼트 소유 생성물 `projects/knowledge-viewer/viewers.yml` 을 읽는다. 확장 층과 같은 폴더 층(`config/` 밖)이다.

- 정본은 각 뷰어 스킬 `SKILL.md` frontmatter 의 `viewer:` 블록이다.
- 빌더(`npm run viewers-build`)가 그 볼트의 스킬 등록 레이어 `.claude/skills/<이름>` 을 훑어 등록부를 쓴다. 볼트마다 목록이 다르다.
- 스킬을 등록·해제하거나 `viewer:` 를 바꾸면 그 볼트에서 다시 빌드해 커밋한다. `-- --check` 는 쓰지 않고 다르면 종료 코드 1 이다.
- 등록부가 없으면 패널 위에 만드는 명령 한 줄이 뜬다. 볼트의 실제 등록부가 스킬과 같은지는 그 볼트의 확장 시험이 지킨다.
