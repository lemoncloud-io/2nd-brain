// 링크 캐시(스키마 3)의 링크 꼴. 엣지는 해석된 경로(노드)만 적고 원문 대상은 적지 않는다 — 복원할 때
// 해석 결과가 같은 대상을 경로에서 다시 만든다. 그렇게 만들 수 없는 위키링크(별칭·부분 경로)만 원문을 적는다.
// 이 파일이 바뀌면 캐시 뜻이 바뀌므로 추출기 지문(PARSER_SOURCES)에 들어간다.
// 계약: docs/superpowers/specs/2026-10-24-vault-graph-index-design.md § 링크 캐시
import path from 'node:path';

import { EXCLUDED_TOP } from '../shared/scope.ts';

export type LinkKind = 'wiki' | 'md' | 'embed';
/** stem: 위키링크가 파일명(경로 없음)으로 썼다. target: 경로에서 다시 만들 수 없는 원문 대상, 아니면 null. */
export type LinkForm = { stem: boolean; target: string | null };

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stemOf = (p: string): string => path.posix.basename(p, '.md');

/** resolveWith 의 위키 대상 정규화와 같다: `.md` 제거·`/` 트림·소문자. */
function wikiKey(target: string): string {
  let t = target;
  if (t.toLowerCase().endsWith('.md')) t = t.slice(0, -3);
  return t.replace(/^\/+|\/+$/g, '').toLowerCase();
}

/**
 * 해석된 링크(`to`)의 꼴. md 는 해석이 경로 정규화와 집합 포함뿐이라 상대 경로로 다시 만든 대상이 늘 같은 결과를 낸다.
 * 위키링크는 정규화한 대상이 `to` 의 경로(`.md` 뗌)와 같으면 경로 꼴, 파일명과 같으면 파일명 꼴이다 — 둘 다 같은 표 키로
 * 찾으므로 문서 집합이 바뀌어도 해석이 같다. 그 밖(별칭·부분 경로)은 원문을 적는다.
 */
export function formOf(link: { kind: 'wiki' | 'md'; target: string }, to: string): LinkForm {
  if (link.kind === 'md') return { stem: false, target: null };
  const k = wikiKey(link.target);
  if (k === to.slice(0, -3).toLowerCase()) return { stem: false, target: null };
  if (!k.includes('/') && k === stemOf(to).toLowerCase()) return { stem: true, target: null };
  return { stem: false, target: link.target };
}

/** formOf 의 거꿀 — 복원할 때 해석기에 넘길 대상. */
export function targetOf(source: string, kind: LinkKind, to: string, form: LinkForm): string {
  if (form.target !== null) return form.target;
  if (kind === 'md') return path.posix.relative(dirOf(source), to);
  return form.stem ? stemOf(to) : to.slice(0, -3);
}

/** md 가 될 수 없는 파일 확장자. 위키 임베드 `![[그림.png]]` 같은 것이다. */
const NOT_MD = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|pdf|mp4|mov|webm|mp3|wav|ogg|zip|csv|tsv|json|ya?ml|xlsx?|docx?|pptx?|hwpx?|html?|canvas|base)$/i;

/**
 * lint 범위의 md 로 해석될 수 없는 링크 — 캐시에 적지 않는다. md 링크가 볼트 밖이나 `raw/`·`archive/`·`private/` 로 가는 것,
 * 위키링크 대상이 비었거나(같은 문서의 절) md 가 아닌 파일인 것. 해석기는 이것들을 어떤 문서 집합에서도 null 로 낸다.
 */
export function neverResolves(source: string, link: { kind: 'wiki' | 'md'; target: string }): boolean {
  if (link.kind === 'md') {
    if (link.target.startsWith('/')) return true;
    const p = path.posix.normalize(path.posix.join(dirOf(source), link.target));
    if (p === '..' || p.startsWith('../')) return true;
    return EXCLUDED_TOP.includes(p.split('/')[0] ?? '');
  }
  const t = link.target.trim();
  return t === '' || NOT_MD.test(t);
}
