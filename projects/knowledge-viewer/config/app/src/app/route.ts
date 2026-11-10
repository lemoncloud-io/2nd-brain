// 주소 ↔ Route. 순수 모듈이다(DOM을 만지지 않는다).
import { MAIN, parseSource, sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';
import type { CenterViewExtension } from '../ext/define.ts';
import { EXT_VIEWS } from '../ext/registry.ts';

/** 가운데 열: 문서 리더(기본), 링크 그래프, 또는 확장 층이 등록한 화면의 id. */
export type View = 'doc' | 'graph' | (string & {});

/** 지도 깊이(홉 수). 1~3 만이다. */
export type GraphDepth = 1 | 2 | 3;
/** 지도 그리기 방식. 3D(three.js) 가 기본이고 2D 는 캔버스다. */
export type GraphMode = '3d' | '2d';
/** 지도 인자. 주소가 상태다 — 공유하면 같은 지도가 열린다. 문서 보기에도 기본값으로 늘 있다. */
export type GraphParams = { depth: GraphDepth; mode: GraphMode; all: boolean };
/** hrefFor 의 지도 인자. 빠진 값은 기본값이다. */
export type GraphTarget = { view: 'graph'; depth?: number; mode?: GraphMode; all?: boolean };

/**
 * 앱 안 이동. src 를 주지 않으면 지금 소스를 둔다. view 를 주지 않으면 리더(doc)다.
 * App 이 만들고 패널·지도가 받는다.
 */
export type NavigateFn = (path: string, anchor?: string, src?: Source, view?: View | GraphTarget) => void;

/** app: `/apps/<id>` 주소면 그 앱 id(가운데 열 전체가 앱이다). 문서 주소에는 키가 없다. */
export type Route = { path: string; anchor: string; agent: boolean; src: Source; view: View; graph: GraphParams; app?: string };

/** `/apps/<id>`(뒤에 `/…` 가 붙어도) 면 풀어 쓴 id, `/apps`·`/apps/` 면 ''(앱 없음 화면), 그 밖은 null. 등록부에 없는 id 는 화면이 "앱 없음" 으로 보인다. */
export function appIdOf(pathname: string): string | null {
  if (pathname === '/apps' || pathname === '/apps/') return '';
  const m = /^\/apps\/([^/]+)(?:\/.*)?$/s.exec(pathname);
  if (m === null) return null;
  let id = m[1]!;
  try {
    id = decodeURIComponent(id);
  } catch {
    // 잘못된 % 열은 그대로 둔다(문법 검사에서 걸러진다).
  }
  return id;
}

/** 앱 화면 주소. 에이전트 모드는 `?agent=claude` 를 싣는다. 앱 이동은 전체 페이지 이동이다(서버가 토큰 meta 를 넣는다). */
export function appHref(id: string, agent: boolean): string {
  return `/apps/${encodeURIComponent(id)}${agent ? '?agent=claude' : ''}`;
}

export const GRAPH_DEFAULTS: GraphParams = { depth: 2, mode: '3d', all: false };

/** 질의의 depth 값. 1·2·3 이 아니면 기본값(2)이다. */
function depthOf(v: string | null): GraphDepth {
  return v === '1' ? 1 : v === '3' ? 3 : GRAPH_DEFAULTS.depth;
}

export const HOME_PATH = 'wiki/INDEX.md';

/** 주소를 읽는다. views 는 확장 화면 목록(기본은 확장 층 등록부) — 옛 경로·`?view=<id>` 를 그 화면으로 연다. */
export function parseLocation(pathname: string, search: string, hash: string, views: readonly CenterViewExtension[] = EXT_VIEWS): Route {
  let path = HOME_PATH;
  if (pathname.startsWith('/v/')) {
    const raw = pathname.slice(3);
    if (raw !== '') {
      try {
        path = decodeURIComponent(raw);
      } catch {
        path = raw;
      }
    }
  }
  const params = new URLSearchParams(search);
  const agent = params.get('agent') === 'claude';
  const src = parseSource(params.get('src')) ?? MAIN;
  // 확장 화면(옛 경로 또는 등록된 `?view=<id>`)이면 그 화면, 지도면 지도, 그 밖(모르는 view 포함)은 기본 문서 리더다.
  const wanted = params.get('view');
  const ext = views.find((v) => v.legacyPaths?.includes(path) === true) ?? views.find((v) => v.id === wanted);
  const view: View = ext !== undefined ? ext.id : wanted === 'graph' ? 'graph' : 'doc';
  // 확장 화면의 문서 경로는 늘 그 화면의 home.path 다.
  if (ext !== undefined) path = ext.home.path;
  // 지도 인자는 모르는 값이면 기본값이다. all 은 `1` 만 참이다.
  const graph: GraphParams = {
    depth: depthOf(params.get('depth')),
    mode: params.get('mode') === '2d' ? '2d' : '3d',
    all: params.get('all') === '1',
  };
  // 앱 주소: 해시는 앱 것이라 앵커로 읽지 않는다. 경로·보기는 기본값(문서 데이터를 받지 않는다 — App 이 거른다).
  const app = appIdOf(pathname);
  if (app !== null) return { path, anchor: '', agent, src, view: 'doc', graph, app };
  let anchor = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // 잘못된 % 열은 그대로 둔다.
  }
  return { path, anchor, agent, src, view, graph };
}

export function hrefFor(
  path: string,
  anchor?: string,
  agent?: boolean,
  src?: Source,
  view?: View | GraphTarget,
): string {
  // encodeURI 는 `?`·`#` 를 남긴다. 경로 안의 것은 쿼리·조각으로 읽히지 않게 따로 부호화한다.
  let href = `/v/${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`;
  // 질의 순서는 agent·src·view·depth·mode·all 이다. 주 소스(main)와 리더(`doc`)는 질의를 붙이지 않는다.
  // 기본값과 같은 지도 인자는 쓰지 않는다.
  const query: string[] = [];
  if (agent) query.push('agent=claude');
  if (src !== undefined && src.kind !== 'main') query.push(`src=${sourceKey(src)}`);
  if (view === 'graph') query.push('view=graph');
  else if (typeof view === 'string' && view !== 'doc') query.push(`view=${encodeURIComponent(view)}`);
  else if (typeof view === 'object') {
    query.push('view=graph');
    const depth = depthOf(view.depth === undefined ? null : String(view.depth));
    if (depth !== GRAPH_DEFAULTS.depth) query.push(`depth=${depth}`);
    if (view.mode === '2d') query.push('mode=2d');
    if (view.all === true) query.push('all=1');
  }
  if (query.length > 0) href += `?${query.join('&')}`;
  if (anchor !== undefined && anchor !== '') href += `#${anchor}`;
  return href;
}

/** 끝이 `/` 인 경로는 폴더 주소다. README 가 있으면 그것을, 없으면 안의 문서 목록을 보여 준다. */
export function isFolderPath(path: string): boolean {
  return path.endsWith('/');
}

/** 폴더 주소에서 폴더 경로(끝 `/` 없이). */
export function folderOf(path: string): string {
  return path.replace(/\/+$/, '');
}

/** 경로 표시줄 조각이 가리키는 곳. 루트는 홈, 폴더는 그 폴더 주소(`<dir>/`)다. */
export function crumbTarget(dir: string): string {
  const d = dir.replace(/^\/+|\/+$/g, '');
  return d === '' ? HOME_PATH : `${d}/`;
}

/**
 * 검색 상자에서 고른 문서로 갈 때의 보기. 지도에서 고르면 그 문서가 중심인 지도로 간다 — 깊이·모드는 두고,
 * 전체 보기는 걷는다(고른 문서가 중심이 되게). 문서 보기, 또는 md 가 아닌 문서는 리더(undefined)다.
 */
export function searchTarget(route: Pick<Route, 'view' | 'graph'>, picked: string): GraphTarget | undefined {
  if (route.view !== 'graph' || !picked.endsWith('.md')) return undefined;
  return { view: 'graph', depth: route.graph.depth, mode: route.graph.mode };
}

/** `templates/` 아래 문서는 노트 계약(자리표시자·빈 절)이라 렌더 대신 원문 보기로 연다. */
export function isTemplatePath(path: string): boolean {
  return path === 'templates' || path.startsWith('templates/');
}
