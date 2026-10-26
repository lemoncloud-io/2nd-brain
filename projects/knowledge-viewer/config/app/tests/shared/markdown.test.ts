import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';

import { WIKILINK_SCHEME, parseMarkdown, remarkWikilinks } from '../../shared/markdown.ts';

function wikilinks(md: string): { url: string; text: string }[] {
  const tree = parseMarkdown(md);
  remarkWikilinks()(tree);
  const out: { url: string; text: string }[] = [];
  visit(tree, 'link', (node) => {
    if (node.url.startsWith(WIKILINK_SCHEME)) out.push({ url: node.url, text: toString(node) });
  });
  return out;
}

test('표 셀의 [[beta\\|베타]]가 wikilink 링크가 된다', () => {
  const md = '| a | b |\n| --- | --- |\n| 표 | [[beta\\|베타]] |\n';
  assert.deepEqual(wikilinks(md), [{ url: 'wikilink:beta', text: '베타' }]);
});

test('앵커는 url 뒤에 #로 붙는다', () => {
  assert.deepEqual(wikilinks('[[beta#둘째|절]]'), [{ url: 'wikilink:beta#둘째', text: '절' }]);
});

test('코드펜스와 인라인 코드 안은 그대로 둔다', () => {
  assert.deepEqual(wikilinks('```\n[[x]]\n```\n\n`[[y]]`'), []);
});
