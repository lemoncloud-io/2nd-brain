// Obsidian 임베드 `![[…]]` 의 AST 변환과 응답 형. 순수 함수만 둔다 — DOM도 React도 건드리지 않는다.
//
// markdown.ts 옆에 따로 둔 까닭: markdown.ts 는 링크 캐시 지문(server/link-cache.ts PARSER_SOURCES)에 들어간다.
// 이 파일은 화면 렌더만 바꾸고 링크 추출(links.ts — `![[…]]` 를 이미 embed: true 링크로 센다)은 건드리지 않는다.
// remarkWikilinks 보다 먼저 돌아야 한다 — 뒤에 돌면 `!` 만 남고 `[[…]]` 는 이미 링크가 되어 있다.

import { visit } from 'unist-util-visit';

import type { Link, Paragraph, PhrasingContent, Root, Text } from 'mdast';

import { RAW_IMAGE_EXT } from './image-src.ts';
import { WIKILINK_SCHEME } from './markdown.ts';
import type { Heading } from './types.ts';
import { splitWikiTarget } from './wikitarget.ts';

/** 이미지로 그리는 확장자(`![](…)` 와 같은 표). 나머지(pdf·html 등)는 링크로 떨어진다. */
export const IMAGE_EXT: ReadonlySet<string> = RAW_IMAGE_EXT;

/** 노트로 보는 확장자. 확장자가 없어도 노트다(`![[note]]`). */
const NOTE_EXT = 'md';

export type EmbedKind = 'image' | 'note' | 'file';

/** 대상 파일명의 확장자(소문자). 마지막 조각에 `.` 이 없으면 빈 문자열이다. */
function extOf(target: string): string {
  const base = target.slice(target.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * 대상이 무엇인가. 이미지 확장자면 이미지, `.md`·확장자 없음이면 노트, 그 밖은 파일(링크로).
 * `v1.2` 처럼 글자가 없는 꼬리는 확장자로 치지 않는다.
 */
export function embedKind(target: string): EmbedKind {
  const ext = extOf(target);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === '' || ext === NOTE_EXT || !/[a-z]/.test(ext)) return 'note';
  return 'file';
}

/** `|640`·`|640x480` 은 크기, 그 밖은 alt. 크기는 1~4자리 정수만 받는다. */
export function imageSize(label: string): { width: string; height?: string } | null {
  const m = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(label.trim());
  if (m === null || m[1] === '0') return null;
  return m[2] === undefined ? { width: m[1]! } : { width: m[1]!, height: m[2] };
}

/** 서버 응답 `embeds` 의 키. 화면은 링크 href 에서 같은 키를 다시 만든다. */
export function embedKey(target: string, anchor: string | null): string {
  return anchor === null || anchor === '' ? target : `${target}#${anchor}`;
}

/**
 * `/api/doc` 의 `embeds[key]`. 1단계만 싣는다 — 본문 안의 임베드는 화면이 링크로 그린다.
 * - ok: 대상 본문(앵커가 있으면 그 절만). `links` 는 대상 문서 기준으로 푼 것이다.
 * - circular: 대상이 지금 문서 자신이다.
 * - no-section: `#절` 을 대상에서 찾지 못했다.
 */
export type DocEmbed<L = unknown> =
  | {
      status: 'ok';
      path: string;
      title: string;
      anchor: string | null;
      body: string;
      /** 본문(절이면 그 절)의 첫 줄이 원문 파일의 몇째 줄인가. */
      bodyStartLine: number;
      headings: Heading[];
      links: L[];
    }
  | { status: 'circular'; path: string }
  | { status: 'no-section'; path: string; title: string; anchor: string };

// 대괄호가 들어가지 않는 한 덩이만 대상으로 삼는다(remarkWikilinks 와 같은 규칙에 `!` 만 붙었다).
const EMBED = /!\[\[([^[\]]+?)\]\]/g;

/** 화면에 싣는 표시. `a[data-embed]` 를 리더가 임베드 상자로 바꾼다. */
export type EmbedMark = 'note' | 'block' | 'self';

type HData = { hName?: string; hProperties?: Record<string, unknown> };
const dataOf = (node: { data?: unknown }): HData => (node.data ?? ((node as { data?: unknown }).data = {})) as HData;

function wikiLink(target: string, anchor: string | null, label: string, mark?: EmbedMark): Link {
  const link: Link = {
    type: 'link',
    url: `${WIKILINK_SCHEME}${target}${anchor === null ? '' : `#${anchor}`}`,
    title: null,
    children: [{ type: 'text', value: label }],
  };
  if (mark !== undefined) dataOf(link).hProperties = { dataEmbed: mark };
  return link;
}

/**
 * 임베드 하나를 mdast 노드로. 이미지는 `![](path)` 와 같은 image 노드다(같은 sanitize·배지 길로 간다).
 * 다만 url 은 파일명(Obsidian 규칙)이라 `dataWikiEmbed` 표시를 단다 — 리더가 이것을 보고 문서 기준 상대경로 대신
 * `/api/doc` 링크(서버가 이미지 목록으로 푼 path)로 경로를 찾는다. 표시는 rehypeImageSrcToTitle 이 떼어 정화에 닿지 않는다.
 */
function embedNode(inner: string, nested: boolean): PhrasingContent | null {
  const parts = splitWikiTarget(inner);
  if (parts.target === '' && parts.anchor === null) return null;
  const kind = parts.target === '' ? 'note' : embedKind(parts.target);
  if (kind === 'image') {
    const alias = inner.includes('|') ? parts.label : '';
    const size = imageSize(alias);
    const image: PhrasingContent = { type: 'image', url: parts.target, alt: size === null ? alias : '', title: null };
    dataOf(image).hProperties = { ...(size ?? {}), dataWikiEmbed: '1' };
    return image;
  }
  // 임베드 안의 임베드, 파일(pdf·html 등)은 `[[…]]` 와 같은 링크다.
  if (nested || kind === 'file') return wikiLink(parts.target, parts.anchor, parts.label);
  const mark: EmbedMark = parts.target === '' ? 'self' : parts.anchor?.startsWith('^') === true ? 'block' : 'note';
  return wikiLink(parts.target, parts.anchor, parts.label, mark);
}

const isBlank = (n: PhrasingContent): boolean => (n.type === 'text' && n.value.trim() === '') || n.type === 'break';
const markOf = (n: PhrasingContent): unknown => (n.type === 'link' ? (n.data as HData | undefined)?.hProperties?.dataEmbed : undefined);

export type EmbedOptions = {
  /** 임베드 본문을 그릴 때 true — 노트 임베드를 상자 대신 링크로 둔다(재귀 금지). */
  nested?: boolean;
};

/**
 * 텍스트 노드 안의 `![[대상|별칭]]` 을 바꾼다.
 * - 이미지: image 노드. `|640`·`|640x480` 은 width·height, 숫자가 아니면 alt.
 * - 노트: `wikilink:` 링크 + `data-embed`. 한 문단이 임베드만으로 되어 있으면 문단을 `div` 로 바꿔
 *   리더가 그 안에 `<section>` 을 둘 수 있게 한다. 문장 안에 섞인 노트 임베드는 표시를 떼고 링크로 둔다.
 * - 그 밖(pdf·html 등)과 `nested` 의 노트: `[[…]]` 와 같은 링크.
 * 코드 블록·인라인 코드는 텍스트 노드가 아니므로 닿지 않는다(remarkWikilinks 와 같다).
 */
export function remarkEmbeds(options?: EmbedOptions): (tree: Root) => void {
  const nested = options?.nested === true;
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent === undefined || index === undefined) return;
      if (parent.type === 'link' || parent.type === 'linkReference') return;
      const value = node.value;
      EMBED.lastIndex = 0;
      if (!EMBED.test(value)) return;
      EMBED.lastIndex = 0;

      const out: PhrasingContent[] = [];
      let at = 0;
      let match: RegExpExecArray | null;
      while ((match = EMBED.exec(value)) !== null) {
        const made = embedNode(match[1] ?? '', nested);
        if (made === null) continue;
        if (match.index > at) out.push({ type: 'text', value: value.slice(at, match.index) });
        out.push(made);
        at = match.index + match[0].length;
      }
      if (out.length === 0) return;
      if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
      (parent.children as PhrasingContent[]).splice(index, 1, ...out);
      return index + out.length;
    });

    if (nested) return;
    visit(tree, 'paragraph', (node: Paragraph) => {
      const marked = node.children.filter((c) => markOf(c) !== undefined);
      if (marked.length === 0) return;
      if (node.children.every((c) => markOf(c) !== undefined || isBlank(c))) {
        dataOf(node).hName = 'div';
        return;
      }
      for (const c of marked) delete (c.data as HData).hProperties;
    });
    // 문단 밖(표 칸·제목)에 놓인 노트 임베드도 링크로 둔다 — 상자를 그 안에 넣을 수 없다.
    visit(tree, 'link', (node: Link, _i, parent) => {
      if (parent?.type === 'paragraph') return;
      const data = node.data as HData | undefined;
      if (data?.hProperties?.dataEmbed !== undefined) delete data.hProperties;
    });
  };
}
