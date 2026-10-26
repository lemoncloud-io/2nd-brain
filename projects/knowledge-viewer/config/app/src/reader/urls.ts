// 본문 링크 주소 판정. 순수 함수만 둔다.
import { WIKILINK_SCHEME } from '../../shared/markdown.ts';

export type LinkTarget =
  | { kind: 'wiki'; target: string; anchor: string }
  | { kind: 'md'; target: string; anchor: string }
  /** md 도 폴더도 아닌 상대 경로(첨부·이미지·html 등). 경로는 아직 문서 기준 상대다. */
  | { kind: 'file'; target: string; anchor: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const hasScheme = (url: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(url);

/** `a.md#x` → ['a.md', 'x']. 쿼리(`?`)는 문서 주소에 쓰지 않으므로 버린다. */
function splitHash(url: string): [string, string] {
  const h = url.indexOf('#');
  const head = h === -1 ? url : url.slice(0, h);
  const q = head.indexOf('?');
  return [q === -1 ? head : head.slice(0, q), h === -1 ? '' : url.slice(h + 1)];
}

/** react-markdown `urlTransform`(sanitize 뒤에 돈다): 위키링크·상대 경로·`#앵커`·http(s)만 통과시키고 나머지는 빈 문자열로 만든다. */
export function transformUrl(url: string, key?: string): string {
  // 이미지 src는 sanitize가 이미 `data:`만 남겼다. 여기서는 건드리지 않는다.
  if (key === 'src') return url;
  if (url.startsWith(WIKILINK_SCHEME) || url.startsWith('#') || /^https?:/i.test(url)) return url;
  if (hasScheme(url) || url.startsWith('//') || url === '') return '';
  // 상대 경로는 모두 통과한다. md·폴더는 문서로, 그 밖은 /raw 로 BodyLink 가 가른다.
  return url;
}

/** 변환된 href를 링크 종류로 읽는다. */
export function classifyHref(href: string | undefined): LinkTarget {
  if (href === undefined || href === '') return { kind: 'none' };
  if (href.startsWith(WIKILINK_SCHEME)) {
    // mdast-util-to-hast가 url을 퍼센트 인코딩했으므로 풀어서 읽는다. 위키링크 대상에는 쿼리가 없다.
    const rest = href.slice(WIKILINK_SCHEME.length);
    const h = rest.indexOf('#');
    const target = safeDecode(h === -1 ? rest : rest.slice(0, h));
    const anchor = h === -1 ? '' : safeDecode(rest.slice(h + 1));
    return target === '' ? (anchor === '' ? { kind: 'none' } : { kind: 'anchor', anchor }) : { kind: 'wiki', target, anchor };
  }
  if (href.startsWith('#')) return { kind: 'anchor', anchor: safeDecode(href.slice(1)) };
  if (/^https?:/i.test(href)) return { kind: 'external', url: href };
  if (hasScheme(href) || href.startsWith('//')) return { kind: 'none' };
  const [path, anchor] = splitHash(href);
  if (path === '') return { kind: 'none' };
  const kind = path.endsWith('.md') || path.endsWith('/') ? 'md' : 'file';
  return { kind, target: safeDecode(path), anchor: safeDecode(anchor) };
}

/** 인라인 코드가 출처 문자열(`raw/….md`·`archive/….md`)인가. */
export const isProvenancePath = (code: string): boolean => /^(raw|archive)\/.+\.md$/.test(code);
