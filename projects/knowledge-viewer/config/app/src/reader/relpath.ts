// 본문 상대 링크를 볼트 경로로 푼다. 순수 함수다 — 브라우저 번들에 node:path 를 들이지 않으려고 직접 정규화한다.

/**
 * `fromPath`(문서 경로) 의 폴더를 기준으로 `href`(부호를 푼 상대 경로) 를 정규화한다.
 * 절대 경로(`/…`)이거나, 볼트 루트 위로 나가거나, 루트 자체가 되면 null 이다.
 */
export function resolveRelative(fromPath: string, href: string): string | null {
  if (href === '' || href.startsWith('/')) return null;
  const segs = fromPath.split('/').slice(0, -1);
  for (const s of href.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (segs.length === 0) return null;
      segs.pop();
    } else {
      segs.push(s);
    }
  }
  return segs.length === 0 ? null : segs.join('/');
}
