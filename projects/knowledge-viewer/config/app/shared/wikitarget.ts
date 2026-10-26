// 위키링크 안쪽 `대상#앵커|별칭` 분해. markdown.ts와 links.ts가 함께 쓴다.
// 순환 import를 피하려고 이 작은 파일에 둔다(links.ts가 다시 내보낸다).

export interface WikiTarget {
  target: string;
  anchor: string | null;
  label: string;
}

/**
 * `a/b\|별칭`(표 셀 이스케이프)과 `a#절|x`를 다룬다. 첫 `|`가 대상과 별칭을 가르고,
 * 대상 끝의 `\`는 버린다. 첫 `#` 뒤는 앵커다. label은 별칭, 없으면 대상, 대상도 없으면 앵커다.
 */
export function splitWikiTarget(inner: string): WikiTarget {
  const bar = inner.indexOf('|');
  let head = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  if (head.endsWith('\\')) head = head.slice(0, -1).trimEnd();
  const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();

  const hash = head.indexOf('#');
  const target = (hash === -1 ? head : head.slice(0, hash)).trim();
  const rawAnchor = hash === -1 ? '' : head.slice(hash + 1).trim();
  const anchor = rawAnchor === '' ? null : rawAnchor;
  return { target, anchor, label: alias !== '' ? alias : target !== '' ? target : (anchor ?? '') };
}
