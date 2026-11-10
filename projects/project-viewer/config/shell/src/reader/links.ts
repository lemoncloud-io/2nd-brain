// 링크 판정은 `loader/doclinks.ts` 한 곳에 모은다 — 빌드 때 "해소되지 않은 링크"를 세는 기준과
// 화면이 링크를 만드는 기준이 같아야 숫자와 화면이 어긋나지 않는다.
//
// 이 파일은 그 위에 두 가지만 얹는다.
// 1. `markdown.ts`가 만든 `wikilink:<대상>` 주소를 `resolveWikilink`로 보낸다(그냥 넘기면 모르는 스킴으로 막힌다).
// 2. 절 이름을 헤딩 id와 같은 슬러그로 바꾼다. 원문에 `[[design#검사 규칙]]`처럼 헤딩 문구를 그대로 적는 일이
//    흔한데, 슬러그로 바꾸지 않으면 그 자리로 이동하지 못한다(설계 § md 렌더 규칙 4).

import { classifyLink as classifyHref, resolveWikilink } from '../../loader/doclinks.ts';
import type { LinkTarget, SourcePaths } from '../../loader/doclinks.ts';
import { slugify } from '../../model/index.ts';
import { WIKILINK_SCHEME } from './markdown.ts';

export type DocLink = LinkTarget;

// 코드·데이터 원본은 절이 아니라 줄로 이동한다. 슬러그로 바꾸면 소문자가 되어 그 줄을 찾지 못한다.
const LINE_ANCHOR = /^L\d+$/;

function toSlug(fragment: string): string {
  const raw = fragment.trim();
  if (raw === '' || LINE_ANCHOR.test(raw)) return raw;
  return slugify(raw, new Map());
}

function withSlug(link: LinkTarget): LinkTarget {
  if (link.kind === 'same-doc') return { kind: 'same-doc', slug: toSlug(link.slug) };
  if (link.kind === 'internal' && link.slug !== undefined) {
    return { kind: 'internal', source: link.source, slug: toSlug(link.slug) };
  }
  return link;
}

/**
 * @param href 링크 주소. 위키링크는 `wikilink:<대상>` 형태다(`markdown.ts`가 그렇게 만든다).
 * @param fromPath 이 링크가 들어 있는 문서의 볼트 상대경로
 * @param sourcePaths 볼트 상대경로 → 원본 id
 */
export function classifyLink(href: string, fromPath: string, sourcePaths: SourcePaths): DocLink {
  const raw = href.trim();
  if (raw.startsWith(WIKILINK_SCHEME)) {
    return withSlug(resolveWikilink(raw.slice(WIKILINK_SCHEME.length), sourcePaths));
  }
  return withSlug(classifyHref(raw, fromPath, sourcePaths));
}
