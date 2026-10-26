// 문서 한 편에서 다른 문서로 가는 링크를 뽑는다.
// 본문은 AST에서 뽑고(코드펜스·인라인 코드 안은 text 노드가 아니라 저절로 빠진다),
// frontmatter 머리는 YAML 값 안의 `[[…]]`를 정규식으로 뽑는다.
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';

import { splitFrontmatter } from './frontmatter.ts';
import { parseMarkdown } from './markdown.ts';
import { splitWikiTarget } from './wikitarget.ts';

export { splitWikiTarget };

export type LinkRef = {
  kind: 'wiki' | 'md';
  target: string;
  anchor: string | null;
  label: string;
  line: number;
  embed: boolean;
};

const HEAD_WIKI = /!?\[\[([^\]]+?)\]\]/g;
const BODY_WIKI = /\[\[([^[\]]+?)\]\]/g;

function countNewlines(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '\n') n += 1;
  return n;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 문서 링크의 상대 url인가. 스킴(http·mailto 등)·`//`·`#`만 있는 url은 아니다. */
function isRelative(url: string): boolean {
  if (url === '' || url.startsWith('#') || url.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

export function extractLinks(text: string): LinkRef[] {
  const { body, bodyStartLine } = splitFrontmatter(text);
  const refs: LinkRef[] = [];

  // frontmatter 머리 — 본문 앞의 원문 조각이다(body는 text의 접미사).
  const head = text.slice(0, text.length - body.length);
  if (head !== '') {
    HEAD_WIKI.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEAD_WIKI.exec(head)) !== null) {
      const parts = splitWikiTarget(m[1] ?? '');
      refs.push({
        kind: 'wiki',
        target: parts.target,
        anchor: parts.anchor,
        label: parts.label,
        line: 1 + countNewlines(head.slice(0, m.index)),
        embed: m[0].startsWith('!'),
      });
    }
  }

  const tree = parseMarkdown(body);
  const offset = bodyStartLine - 1;
  visit(tree, (node, _index, parent) => {
    if (node.type === 'text') {
      // remarkWikilinks와 같은 규칙: 링크 글자 안의 [[ ]]는 링크로 읽지 않는다.
      if (parent !== undefined && (parent.type === 'link' || parent.type === 'linkReference')) return;
      const startLine = node.position?.start.line ?? 1;
      const value = node.value;
      BODY_WIKI.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BODY_WIKI.exec(value)) !== null) {
        const parts = splitWikiTarget(m[1] ?? '');
        refs.push({
          kind: 'wiki',
          target: parts.target,
          anchor: parts.anchor,
          label: parts.label,
          line: startLine + countNewlines(value.slice(0, m.index)) + offset,
          embed: m.index > 0 && value[m.index - 1] === '!',
        });
      }
      return;
    }
    if (node.type === 'link') {
      if (!isRelative(node.url)) return;
      const decoded = safeDecode(node.url);
      const hash = decoded.indexOf('#');
      const path = hash === -1 ? decoded : decoded.slice(0, hash);
      if (!path.endsWith('.md') && !path.endsWith('/')) return;
      const rawAnchor = hash === -1 ? '' : decoded.slice(hash + 1);
      refs.push({
        kind: 'md',
        target: path,
        anchor: rawAnchor === '' ? null : rawAnchor,
        label: toString(node),
        line: (node.position?.start.line ?? 1) + offset,
        embed: false,
      });
    }
  });

  return refs;
}
