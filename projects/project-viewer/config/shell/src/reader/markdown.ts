// 원문 md의 AST 변환. 순수 함수만 둔다 — DOM도 React도 건드리지 않는다.
//
// 원문은 글자 하나도 바꾸지 않는다. 위키링크·HTML 처리는 전부 mdast 단계에서 하고
// 문자열 치환(정규식으로 md를 고치는 일)은 하지 않는다(설계 § md 렌더 규칙 1·8).

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

import type { Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast';

import { slugify } from '../../model/index.ts';
import type { Heading } from '../../model/index.ts';

/** 위키링크를 링크 노드로 만들 때 쓰는 표시. `classifyLink`가 이 접두를 보고 위키링크로 읽는다. */
export const WIKILINK_SCHEME = 'wikilink:';

/** `C01~C04` 같은 범위 표기를 취소선으로 읽지 않기 위해 물결표 하나는 인정하지 않는다. */
export const GFM_OPTIONS = { singleTilde: false } as const;

interface ExtensionStore {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
  toMarkdownExtensions?: unknown[];
}
type GfmAttacher = (this: { data: () => ExtensionStore }, options: typeof GFM_OPTIONS) => void;

// 파서 확장을 remark-gfm에서 직접 꺼낸다. micromark·mdast-util 쪽 패키지를 따로 import하면
// package.json에 선언하지 않은 모듈에 기대게 되므로(셸은 자기완결이어야 한다) 선언된 것만 쓴다.
function gfmExtensions(): Required<Pick<ExtensionStore, 'micromarkExtensions' | 'fromMarkdownExtensions'>> {
  const store: ExtensionStore = {};
  (remarkGfm as unknown as GfmAttacher).call({ data: () => store }, GFM_OPTIONS);
  return {
    micromarkExtensions: store.micromarkExtensions ?? [],
    fromMarkdownExtensions: store.fromMarkdownExtensions ?? [],
  };
}

/** 화면 렌더러(react-markdown)와 같은 문법 설정으로 파싱한다. 테스트와 빌드 때의 판정을 같게 하려는 것이다. */
export function parseMarkdown(text: string): Root {
  const ext = gfmExtensions();
  return fromMarkdown(text, {
    extensions: ext.micromarkExtensions as never,
    mdastExtensions: ext.fromMarkdownExtensions as never,
  });
}

// ── 이미지 ──────────────────────────────────────────────────────────────────
/** 이미지를 어떻게 다룰지. 판정만 하는 순수 함수라 화면 없이 테스트한다. */
export type ImageMode = 'inline' | 'badge-external' | 'badge-relative';

/**
 * 산출물은 단일 HTML이고 런타임에 외부 네트워크를 쓰지 않는다(설계 § 빌드와 산출물).
 * 그래서 번들 안에 들어 있는 `data:`만 실제로 그린다. 원격 이미지는 그리지 않고 배지로 두되
 * 주소로 가는 외부 링크를 남기고, 상대경로 이미지는 번들에 없으므로 배지만 둔다.
 */
export function imageMode(src: string): ImageMode {
  const raw = src.trim();
  if (raw === '') return 'badge-relative';
  if (/^data:/i.test(raw)) return 'inline';
  // 프로토콜 없는 `//host/a.png`도 원격이다.
  if (/^https?:/i.test(raw) || raw.startsWith('//')) return 'badge-external';
  return 'badge-relative';
}

// ── 위키링크 ────────────────────────────────────────────────────────────────
// 대괄호가 들어가지 않는 한 덩이만 대상으로 삼는다. 짝이 맞지 않으면 글자 그대로 둔다.
const WIKILINK = /\[\[([^[\]]+?)\]\]/g;

interface WikiParts {
  target: string;
  label: string;
}
function splitWikilink(inner: string): WikiParts | null {
  const bar = inner.indexOf('|');
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();
  if (target === '' && alias === '') return null;
  return { target, label: alias === '' ? target : alias };
}

/**
 * 텍스트 노드 안의 `[[대상|별칭]]`을 링크 노드로 바꾼다.
 * 코드펜스(`code`)와 인라인 코드(`inlineCode`)는 텍스트 노드가 아니므로 애초에 닿지 않는다 —
 * 이것이 문자열 치환 대신 AST를 쓰는 이유다.
 */
export function remarkWikilinks(): (tree: Root) => void {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent === undefined || index === undefined) return;
      // 링크 글자 안에 또 링크를 만들지 않는다(중첩 링크는 그릴 수 없다).
      if (parent.type === 'link' || parent.type === 'linkReference') return;

      const value = node.value;
      WIKILINK.lastIndex = 0;
      if (!WIKILINK.test(value)) return;
      WIKILINK.lastIndex = 0;

      const out: PhrasingContent[] = [];
      let at = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKILINK.exec(value)) !== null) {
        const parts = splitWikilink(match[1] ?? '');
        if (parts === null) continue;
        if (match.index > at) out.push({ type: 'text', value: value.slice(at, match.index) });
        out.push({
          type: 'link',
          url: `${WIKILINK_SCHEME}${parts.target}`,
          title: null,
          children: [{ type: 'text', value: parts.label }],
        });
        at = match.index + match[0].length;
      }
      if (out.length === 0) return;
      if (at < value.length) out.push({ type: 'text', value: value.slice(at) });

      (parent.children as PhrasingContent[]).splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

// ── raw HTML ────────────────────────────────────────────────────────────────
/**
 * 원문 안의 raw HTML을 글자로 되돌린다. `rehype-raw`를 쓰지 않으므로 HTML은 주입되지 않고,
 * 그냥 버리면 원문이 조용히 사라지므로 보이는 글자로 남긴다.
 */
export function remarkHtmlAsText(): (tree: Root) => void {
  return (tree: Root) => {
    visit(tree, 'html', (node, index, parent) => {
      if (parent === undefined || index === undefined) return;
      const text: Text = { type: 'text', value: node.value };
      // 블록 자리의 HTML은 문단으로 감싼다. 문단 안이면 글자 노드로 충분하다.
      const replacement: RootContent | PhrasingContent =
        parent.type === 'root' ? ({ type: 'paragraph', children: [text] } satisfies Paragraph) : text;
      (parent.children as RootContent[]).splice(index, 1, replacement as RootContent);
      return index + 1;
    });
  };
}

// ── 헤딩 id ─────────────────────────────────────────────────────────────────
/**
 * 헤딩에 id를 붙인다. 근거 참조가 가리키는 자리와 화면의 자리가 같아야 하므로
 * 검사기가 쓴 슬러그(`headings`)를 정본으로 삼고, 없거나 문구가 어긋나는 자리만 같은 함수로 다시 만든다.
 * `extractHeadings`와 같게 최상위 헤딩만 센다.
 */
export function remarkHeadingIds(options?: { headings?: Heading[] }): (tree: Root) => void {
  const given = options?.headings;
  return (tree: Root) => {
    const seen = new Map<string, number>();
    let order = 0;
    for (const node of tree.children) {
      if (node.type !== 'heading') continue;
      const text = toString(node).trim();
      const known = given?.[order];
      const slug = known !== undefined && known.text === text ? known.slug : slugify(text, seen);
      if (known !== undefined && known.text === text && !seen.has(slug)) seen.set(slug, 0);

      const data = (node.data ?? (node.data = {})) as { hProperties?: Record<string, unknown> };
      const props = data.hProperties ?? (data.hProperties = {});
      props.id = slug;
      order += 1;
    }
  };
}
