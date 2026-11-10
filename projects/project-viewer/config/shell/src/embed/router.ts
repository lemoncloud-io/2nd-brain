// app/router.ts 의 통합 보기 판. 해시 형식(`#/p/…`·`#/glossary`·`#/docs`·`#/search/…`)은 원래 모듈 그대로 쓰고,
// 원본 문서 하나를 가리키는 주소(`#/docs/<id>[/<절>]`)만 바깥 앱의 문서 주소로 바꾼다 — 근거·원본 링크가 볼트 뷰어의
// 리더(백링크·PR 변경 표시가 있는 화면)로 가게 하려는 것이다. 볼트 밖 저장소 코드(repo)와 모르는 id 는 그대로 둔다.
import { formatRoute as formatHash, parseHash, sameScreen } from '../app/router.ts';
import type { Route } from '../app/router.ts';
import { embedBundle, embedHost, rememberDocLink } from './host.ts';

export type { Route };
export { parseHash, sameScreen };

/** 원본 문서 라우트가 볼트 문서를 가리키면 그 경로·앵커. 아니면 null. */
export function vaultDocOf(route: Route): { path: string; anchor?: string } | null {
  if (route.kind !== 'docs' || route.sourceId === undefined) return null;
  const doc = embedBundle().docs[route.sourceId];
  if (doc === undefined || doc.repo !== undefined) return null;
  return route.slug === undefined ? { path: doc.path } : { path: doc.path, anchor: route.slug };
}

/** 라우트 → 주소. 원본 문서 하나는 바깥 앱 주소(기억해 둔다), 나머지는 원래 해시다. */
export function formatRoute(route: Route): string {
  const target = vaultDocOf(route);
  if (target === null) return formatHash(route);
  return rememberDocLink(embedHost().docHref(target.path, target.anchor), target.path, target.anchor);
}
