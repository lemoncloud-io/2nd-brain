// 앱 플러그인 서버 계약. 앱 목록은 확장 층(ext/server.ts 의 apps)이 주고, 서버 시작 때 한 번 읽는다(server/ext.ts).
// 앱 하나는 `/api/apps/<id>/*` 요청을 받는 RequestListener 하나다. 뷰어는 req 를 고치지 않고 넘기고,
// 앱 핸들러가 basePath(`/api/apps/<id>`)를 스스로 뗀다. 설계: docs/superpowers/specs/2026-11-05-knowledge-viewer-app-plugins-design.md
import path from 'node:path';
import type { RequestListener } from 'node:http';

/** 앱 server() 가 받는 것. token 은 뷰어가 이 앱에만 만든 값이다(/apps/<id> 의 meta 와 같다). */
export type AppServerContext = { vaultRoot: string; basePath: string; token: string; env: NodeJS.ProcessEnv; log: (line: string) => void };

/** 앱 server() 가 돌려주는 것. close 는 뷰어 서버가 닫힐 때 부른다. */
export type AppServer = { handle: RequestListener; close(): Promise<void> };

/** 등록부 항목. server 는 첫 요청 때 한 번 부른다(지연 import 를 여기서). 실패하면 그 앱만 503 이다. */
export type ViewerApp = {
  id: string;
  title: string;
  server: (ctx: AppServerContext) => Promise<AppServer>;
  /** 앱이 쓰는 저장소 폴더. 있으면 `<vaultRoot>/tmp/` 아래여야 등록된다 — 뷰어는 볼트 문서를 쓰지 않는다. */
  storeDir?: (vaultRoot: string) => string;
};

/** 앱 id 문법. 주소 조각으로 그대로 쓰므로 소문자·숫자·하이픈만. */
export const APP_ID = /^[a-z0-9-]+$/;

/** 앱 경로 기준점. 앱 핸들러에는 이 접두가 붙은 채로 req.url 이 간다. */
export const appBasePath = (id: string): string => `/api/apps/${id}`;

/** 저장소 경계: 앱 저장소가 `<vaultRoot>/tmp/` 아래가 아니면 그 까닭, 맞으면 null. */
export function storeDirProblem(app: ViewerApp, vaultRoot: string): string | null {
  if (app.storeDir === undefined) return null;
  let dir: string;
  try {
    dir = app.storeDir(vaultRoot);
  } catch (e) {
    return `저장소 경로를 정하지 못했다: ${e instanceof Error ? e.message : String(e)}`;
  }
  // 상대 경로가 `..` 로 시작하거나 절대면 tmp 밖이다. tmp 자체도 받지 않는다(자기 폴더가 있어야 한다).
  const rel = path.relative(path.join(path.resolve(vaultRoot), 'tmp'), path.resolve(vaultRoot, dir));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return '저장소가 볼트 tmp/ 아래가 아니다 — 앱은 tmp/ 아래 자기 폴더에만 쓴다';
  return null;
}

/** 등록부 검사: id 문법·중복. 틀리면 시작부터 멈춘다(코드 실수다). */
export function assertApps(apps: ViewerApp[]): void {
  const seen = new Set<string>();
  for (const a of apps) {
    if (!APP_ID.test(a.id)) throw new Error(`앱 id 가 올바르지 않다([a-z0-9-]+): ${a.id}`);
    if (seen.has(a.id)) throw new Error(`앱 id 가 겹친다: ${a.id}`);
    seen.add(a.id);
  }
}
