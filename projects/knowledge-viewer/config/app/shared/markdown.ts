// 출처: projects/project-viewer/config/shell/src/reader/markdown.ts (2026-10-23 복사)
// 원문 md의 AST 변환. 순수 함수만 둔다 — DOM도 React도 건드리지 않는다.
//
// 원문은 글자 하나도 바꾸지 않는다. 위키링크·HTML 처리는 전부 mdast 단계에서 하고
// 문자열 치환(정규식으로 md를 고치는 일)은 하지 않는다(설계 § md 렌더 규칙 1·8).

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

import type { PhrasingContent, Root, Text } from 'mdast';

import { slugify } from './slug.ts';
import type { Heading } from './types.ts';
import { splitWikiTarget } from './wikitarget.ts';

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
        const parts = splitWikiTarget(match[1] ?? '');
        if (parts.target === '' && parts.anchor === null && parts.label === '') continue;
        if (match.index > at) out.push({ type: 'text', value: value.slice(at, match.index) });
        out.push({
          type: 'link',
          url: `${WIKILINK_SCHEME}${parts.target}${parts.anchor === null ? '' : `#${parts.anchor}`}`,
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

// ── PR 변경 표시 ────────────────────────────────────────────────────────────
export interface ChangedOptions {
  /** 바뀐 줄 범위. 파일 전체 기준(1부터, frontmatter 포함). */
  hunks: { start: number; end: number }[];
  /** 지운 자리. afterLine 은 새 파일에서 지운 자리 바로 앞 줄(0 이면 맨 앞). */
  removed: { afterLine: number; count: number }[];
  /** 원문에서 본문 첫 줄. 본문 노드의 줄 번호에 `bodyStartLine - 1` 을 더하면 파일 줄이 된다. */
  bodyStartLine: number;
  /** 에이전트 모드면 색 클래스 대신 `data-changed="1"` 만 단다. */
  agent?: boolean;
}

type HProps = Record<string, unknown>;

/**
 * 코드 블록(`code`)의 표식은 hProperties 가 아니라 여기에 둔다. mdast-util-to-hast 는 code 의
 * hProperties 를 안쪽 `<code>` 에 덮어써 `language-*` 클래스를 지우기 때문이다.
 * 화면(Reader)의 code 핸들러가 이것을 바깥 `<pre>` 로 옮긴다.
 */
export interface CodeChangeData {
  hChanged?: boolean;
  hRemoved?: number;
}

/** code 노드의 표식을 읽는다(없으면 빈 객체). */
export function codeChangeOf(node: { data?: unknown }): CodeChangeData {
  return (node.data ?? {}) as CodeChangeData;
}

function codeDataOf(node: Root['children'][number]): CodeChangeData {
  return (node.data ?? (node.data = {})) as CodeChangeData;
}

function hPropsOf(node: Root['children'][number]): HProps {
  const data = (node.data ?? (node.data = {})) as { hProperties?: HProps };
  return data.hProperties ?? (data.hProperties = {});
}

/**
 * PR 이 바꾼 최상위 블록에 `changed` 클래스(에이전트면 `data-changed="1"`)를,
 * 지운 자리 바로 뒤 블록에 `data-removed="<줄 수>"` 를 단다. 중첩 노드는 건드리지 않는다.
 * 코드 블록은 `data.hChanged`·`data.hRemoved` 에 두고(CodeChangeData), 화면이 `<pre>` 로 옮긴다.
 * 본문 노드의 줄은 본문 기준이라 `bodyStartLine` 으로 파일 줄로 옮긴 뒤 hunk 와 견준다.
 */
export function remarkChanged(options: ChangedOptions): (tree: Root) => void {
  const { hunks, removed, bodyStartLine, agent = false } = options;
  const offset = bodyStartLine - 1;
  return (tree: Root) => {
    const blocks = tree.children
      .filter((n) => n.position !== undefined)
      .map((node) => ({ node, start: node.position!.start.line + offset, end: node.position!.end.line + offset }));
    if (blocks.length === 0) return;

    for (const b of blocks) {
      if (!hunks.some((h) => h.start <= b.end && h.end >= b.start)) continue;
      if (b.node.type === 'code') {
        codeDataOf(b.node).hChanged = true;
        continue;
      }
      const props = hPropsOf(b.node);
      if (agent) props.dataChanged = '1';
      else {
        const cls = Array.isArray(props.className) ? (props.className as string[]) : [];
        if (!cls.includes('changed')) props.className = [...cls, 'changed'];
      }
    }

    const counts = new Map<(typeof blocks)[number], number>();
    for (const r of removed) {
      const at = blocks.find((b) => b.start > r.afterLine) ?? blocks[blocks.length - 1]!;
      counts.set(at, (counts.get(at) ?? 0) + r.count);
    }
    for (const [b, count] of counts) {
      if (b.node.type === 'code') codeDataOf(b.node).hRemoved = count;
      else hPropsOf(b.node).dataRemoved = String(count);
    }
  };
}
