// `/api/doc` 의 `embeds` — 문서가 `![[노트]]` 로 품은 노트의 본문을 1단계만 싣는다.
// 재귀하지 않는다: 실린 본문 안의 임베드는 화면이 링크로 그린다(remarkEmbeds nested).
// 읽기는 문서를 읽은 그 소스 리더로 한다 — local 은 디스크 범위(private 는 includePrivate 일 때만), git 소스는 private 를 담지 않는다.
import { splitFrontmatter, titleOf } from '../shared/frontmatter.ts';
import { embedKey, embedKind, type DocEmbed } from '../shared/embeds.ts';
import { extractLinks, type LinkRef } from '../shared/links.ts';
import { segmentsBlocked, type ScopeOptions } from '../shared/scope.ts';
import { extractHeadings, slugify } from '../shared/slug.ts';
import type { Heading } from '../shared/types.ts';
import type { Resolution } from './index-store.ts';

export type ResolvedLink = LinkRef & Resolution;

/** 한 문서가 싣는 임베드 수의 상한. 넘는 것은 싣지 않는다(화면은 링크로 그린다). */
export const EMBED_LIMIT = 20;

export type EmbedInput = {
  /** 지금 문서의 볼트 경로. 자기 자신 임베드를 가린다. */
  rel: string;
  /** 지금 문서의 링크(해석 결과가 붙은 것). */
  links: ResolvedLink[];
  bodyStartLine: number;
  /** 문서를 읽은 소스 리더의 readText. 범위 밖·없는 파일은 null. */
  read: (rel: string) => string | null;
  /** 같은 소스의 해석기. 실린 문서의 링크를 그 문서 기준으로 푼다(이미지 임베드도 — 링크 전체를 넘긴다). */
  resolve: (from: string, link: LinkRef) => Resolution;
  /** 경로 조각 검사 범위. git 소스면 includePrivate: false. 리더도 같은 검사를 하지만 먼저 한 번 더 본다. */
  scope: ScopeOptions;
};

/** 제목 찾기: 원문 글자 → 슬러그 → 글자의 슬러그 순(Obsidian 은 `#제목 글자`, 이 뷰어의 앵커는 슬러그다). */
function findHeading(headings: Heading[], anchor: string): number {
  const byText = headings.findIndex((h) => h.text === anchor);
  if (byText !== -1) return byText;
  const bySlug = headings.findIndex((h) => h.slug === anchor);
  if (bySlug !== -1) return bySlug;
  const slug = slugify(anchor, new Map());
  return headings.findIndex((h) => h.slug === slug);
}

/** `#절` 이면 그 제목부터 다음 같은 급(또는 더 높은 급) 제목 앞까지. 줄은 body 기준(1부터). */
function sectionOf(body: string, headings: Heading[], i: number): { text: string; startLine: number } {
  const h = headings[i]!;
  const next = headings.slice(i + 1).find((x) => x.depth <= h.depth);
  const lines = body.split('\n');
  return { text: lines.slice(h.line - 1, next === undefined ? lines.length : next.line - 1).join('\n').replace(/\n+$/, ''), startLine: h.line };
}

function embedOne(input: EmbedInput, path: string, anchor: string | null): DocEmbed<ResolvedLink> | null {
  if (path === input.rel) return { status: 'circular', path };
  if (segmentsBlocked(path.split('/'), input.scope)) return null;
  const text = input.read(path);
  if (text === null) return null;
  const { data, body, bodyStartLine } = splitFrontmatter(text);
  const title = titleOf(path, data, body);
  const all = extractHeadings(body);
  let part = { text: body, startLine: 1 };
  let headings = all;
  if (anchor !== null) {
    const i = findHeading(all, anchor);
    if (i === -1) return { status: 'no-section', path, title, anchor };
    part = sectionOf(body, all, i);
    const end = part.startLine + part.text.split('\n').length - 1;
    headings = all.filter((h) => h.line >= part.startLine && h.line <= end);
  }
  const fileLine = (bodyLine: number): number => bodyLine + bodyStartLine - 1;
  const links = extractLinks(text).map((l) => ({ ...l, ...input.resolve(path, l) }));
  return {
    status: 'ok',
    path,
    title,
    anchor,
    body: part.text,
    bodyStartLine: fileLine(part.startLine),
    headings: headings.map((h) => ({ ...h, line: fileLine(h.line) })),
    links,
  };
}

/**
 * 본문의 노트 임베드(`![[노트]]`·`![[노트#절]]`)마다 대상 본문을 싣는다. 키는 `embedKey(target, anchor)`.
 * 이미지·파일(pdf 등)·블록 참조(`#^id`)·자기 절(`![[#절]]`)·해석 못 한 대상은 싣지 않는다 — 화면이 링크·배지·안내로 그린다.
 */
export function collectEmbeds(input: EmbedInput): Record<string, DocEmbed<ResolvedLink>> {
  const out: Record<string, DocEmbed<ResolvedLink>> = {};
  let count = 0;
  for (const l of input.links) {
    if (!l.embed || l.kind !== 'wiki' || l.line < input.bodyStartLine) continue;
    if (l.target === '' || embedKind(l.target) !== 'note' || l.path === null) continue;
    if (l.anchor?.startsWith('^') === true) continue;
    const key = embedKey(l.target, l.anchor);
    if (Object.hasOwn(out, key)) continue;
    if (count >= EMBED_LIMIT) break;
    const made = embedOne(input, l.path, l.anchor);
    if (made === null) continue;
    out[key] = made;
    count += 1;
  }
  return out;
}
