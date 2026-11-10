// 원문 md 안의 링크를 sources 범위 안에서만 해소한다. 범위 밖이면 링크를 만들지 않는다.
// 이 파일은 리더(브라우저)도 그대로 import한다 — 그래서 Node 내장 모듈을 쓰지 않고 경로 계산도 직접 한다.

/** sourcePaths: 볼트 상대경로 → 원본 id. 저장소(repo) 원본은 볼트 경로가 아니므로 넣지 않는다. */
export type SourcePaths = Map<string, string>;

export type LinkTarget =
  | { kind: 'internal'; source: string; slug?: string }
  | { kind: 'external' }
  | { kind: 'same-doc'; slug: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'blocked'; reason: string };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** 퍼센트 인코딩이 깨져 있어도 원문을 잃지 않는다. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** `a/b/../c` → `a/c`. 루트 위로 나가면 null이다. */
function normalize(segments: string[]): string | null {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

function dirSegments(fromPath: string): string[] {
  const parts = fromPath.split('/');
  parts.pop();
  return parts;
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** `경로#조각`을 나눈다. 별칭(`|`)은 위키링크에서만 쓰지만 여기서도 함께 떼어 둔다. */
function splitTarget(raw: string): { target: string; slug: string | undefined } {
  const noAlias = raw.split('|')[0] ?? '';
  const hash = noAlias.indexOf('#');
  if (hash === -1) return { target: noAlias, slug: undefined };
  const slug = decode(noAlias.slice(hash + 1)).trim();
  return { target: noAlias.slice(0, hash), slug: slug === '' ? undefined : slug };
}

/**
 * md의 link 노드 하나를 판정한다.
 * `fromPath`는 이 문서의 볼트 상대경로다. 상대경로 링크는 그 자리 기준으로 푼다.
 */
export function classifyLink(href: string, fromPath: string, sourcePaths: SourcePaths): LinkTarget {
  const raw = href.trim();
  if (raw === '') return { kind: 'missing', reason: '링크 대상이 비었다' };

  if (raw.startsWith('//')) return { kind: 'external' };
  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name === 'http' || name === 'https') return { kind: 'external' };
    return { kind: 'blocked', reason: `${name}: 스킴은 링크로 만들지 않는다` };
  }

  const { target, slug } = splitTarget(raw.split('?')[0] ?? raw);
  if (target === '') {
    if (slug === undefined) return { kind: 'missing', reason: '링크 대상이 비었다' };
    return { kind: 'same-doc', slug };
  }

  const decoded = decode(target);
  if (decoded.startsWith('/') || decoded.startsWith('\\')) {
    return { kind: 'missing', reason: `절대경로는 해소하지 않는다: ${decoded}` };
  }

  const resolved = normalize([...dirSegments(fromPath), ...decoded.split('/')]);
  if (resolved === null) return { kind: 'missing', reason: `볼트 밖을 가리킨다: ${decoded}` };

  const id = sourcePaths.get(resolved);
  if (id === undefined) return { kind: 'missing', reason: `sources 밖이다: ${decoded}` };
  return slug === undefined ? { kind: 'internal', source: id } : { kind: 'internal', source: id, slug };
}

/**
 * `[[대상]]`을 판정한다. 위키링크는 문서 자리가 아니라 볼트 전체를 기준으로 삼으므로
 * 전체경로 · 확장자 없는 경로 · 파일 이름 셋 중 하나로 맞춘다.
 */
export function resolveWikilink(target: string, sourcePaths: SourcePaths): LinkTarget {
  const { target: raw, slug } = splitTarget(target.trim());
  const want = decode(raw).trim();
  if (want === '') {
    if (slug === undefined) return { kind: 'missing', reason: '위키링크 대상이 비었다' };
    return { kind: 'same-doc', slug };
  }

  const withMd = want.endsWith('.md') ? want : `${want}.md`;
  let id = sourcePaths.get(want) ?? sourcePaths.get(withMd);
  if (id === undefined) {
    // 파일 이름만 적은 위키링크. 먼저 등록된 원본이 이긴다(순서가 결정적이어야 한다).
    for (const [p, candidate] of sourcePaths) {
      const base = basename(p);
      if (base === want || base === withMd) {
        id = candidate;
        break;
      }
    }
  }
  if (id === undefined) return { kind: 'missing', reason: `sources 밖이다: ${want}` };
  return slug === undefined ? { kind: 'internal', source: id } : { kind: 'internal', source: id, slug };
}
