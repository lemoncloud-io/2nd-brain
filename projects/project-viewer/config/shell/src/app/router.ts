// 해시 라우터의 순수 부분. DOM을 건드리지 않으므로 node --test로 그대로 돌릴 수 있다.
// 해시를 쓰는 이유는 산출물이 file://과 샌드박스 iframe에서도 열려야 하기 때문이다.

export type Route =
  | { kind: 'home' }
  | { kind: 'page'; pageId: string; itemId?: string }
  | { kind: 'glossary'; termId?: string }
  | { kind: 'docs'; sourceId?: string; slug?: string }
  | { kind: 'search'; q: string };

const HOME: Route = { kind: 'home' };

// 브라우저가 이미 퍼센트 인코딩해 둔 해시와 사람이 손으로 쓴 해시를 같게 읽는다.
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('/')) return HOME;
  const parts = raw.slice(1).split('/');
  // 빈 segment가 섞이면(`#//`, `#/p//x`) 주소가 깨진 것이므로 첫 페이지로 떨어뜨린다.
  if (parts.length === 1 && parts[0] === '') return HOME;
  if (parts.some((p) => p === '')) return HOME;

  const [head, a, b] = parts;
  if (head === 'p' && a !== undefined && parts.length <= 3) {
    return b === undefined
      ? { kind: 'page', pageId: decode(a) }
      : { kind: 'page', pageId: decode(a), itemId: decode(b) };
  }
  if (head === 'glossary' && parts.length <= 2) {
    return a === undefined ? { kind: 'glossary' } : { kind: 'glossary', termId: decode(a) };
  }
  if (head === 'docs' && parts.length <= 3) {
    if (a === undefined) return { kind: 'docs' };
    return b === undefined
      ? { kind: 'docs', sourceId: decode(a) }
      : { kind: 'docs', sourceId: decode(a), slug: decode(b) };
  }
  if (head === 'search' && a !== undefined && parts.length === 2) {
    const q = decode(a);
    return q.trim() === '' ? HOME : { kind: 'search', q };
  }
  return HOME;
}

export function formatRoute(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'page':
      return route.itemId === undefined
        ? `#/p/${enc(route.pageId)}`
        : `#/p/${enc(route.pageId)}/${enc(route.itemId)}`;
    case 'glossary':
      return route.termId === undefined ? '#/glossary' : `#/glossary/${enc(route.termId)}`;
    case 'docs':
      if (route.sourceId === undefined) return '#/docs';
      return route.slug === undefined
        ? `#/docs/${enc(route.sourceId)}`
        : `#/docs/${enc(route.sourceId)}/${enc(route.slug)}`;
    case 'search':
      return `#/search/${enc(route.q)}`;
  }
}

// 같은 화면인지 비교할 때 쓴다(스크롤 위치를 유지할지 판단).
export function sameScreen(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'page' && b.kind === 'page') return a.pageId === b.pageId;
  if (a.kind === 'docs' && b.kind === 'docs') return a.sourceId === b.sourceId;
  return true;
}
