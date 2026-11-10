// 앱 화면에서 나가는 이동의 판정. 서버는 `/apps/<id>` 응답에만 CSP 를 낸다(server/static.ts APP_PAGE_HEADERS).
// CSP 는 문서에 붙어 있어 SPA 이동으로는 벗겨지지 않는다 — 앱 페이지로 서빙된 문서에서 나가는 이동은 전체 페이지 이동이다(2026-11-05 실측).
import { appIdOf } from '../app/route.ts';

/** 이 주소(pathname)로 서빙된 문서가 앱 페이지인가. 첫 진입 주소로 한 번 판정한다(SPA 이동 뒤에도 문서 헤더는 그대로다). */
export function servedAsAppAt(pathname: string): boolean {
  // `/apps`·`/apps/<id>` 모두 앱 경로다. `/apps` 는 CSP 가 없지만 전체 이동해도 해가 없다.
  return appIdOf(pathname) !== null;
}

/** 이 href 가 앱 주소인가. 질의·조각은 떼고 경로만 본다. */
export function isAppHref(href: string): boolean {
  // `?`·`#` 앞까지가 경로다.
  const pathname = href.split(/[?#]/, 1)[0] ?? '';
  return appIdOf(pathname) !== null;
}

/** 앱 안 이동을 전체 페이지 이동으로 할까. 앱 문서에서 나가거나(CSP 를 벗긴다) 앱으로 들어가면(토큰 meta 를 받는다) 전체 이동이다. */
export function shouldFullLoad({ servedAsApp, toApp }: { servedAsApp: boolean; toApp: boolean }): boolean {
  // 비앱 → 비앱만 SPA 다.
  return servedAsApp || toApp;
}

/** popstate(뒤로·앞으로) 처리. 문서 종류(앱·비앱)가 새 주소와 다르면 다시 읽어 서버 헤더를 맞춘다. 주소는 이미 바뀌어 있다. */
export function popAction({ servedAsApp, nextIsApp }: { servedAsApp: boolean; nextIsApp: boolean }): 'reload' | 'spa' {
  // 같은 종류끼리는 지금처럼 route 만 다시 읽는다.
  return servedAsApp !== nextIsApp ? 'reload' : 'spa';
}
