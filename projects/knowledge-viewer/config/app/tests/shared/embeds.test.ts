// remarkEmbeds: `![[…]]` 문법 표 → mdast. 이미지·노트·파일·블록 참조·자기 절·코드 제외·문단 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visit } from 'unist-util-visit';

import type { Root } from 'mdast';

import { embedKey, embedKind, imageSize, remarkEmbeds } from '../../shared/embeds.ts';
import { parseMarkdown, remarkWikilinks } from '../../shared/markdown.ts';

function run(md: string, nested = false): Root {
  const tree = parseMarkdown(md);
  remarkEmbeds({ nested })(tree);
  remarkWikilinks()(tree);
  return tree;
}

type Found = { type: string; url: string; mark?: unknown; alt?: string | null; width?: unknown; height?: unknown };
function found(tree: Root): Found[] {
  const out: Found[] = [];
  visit(tree, (n) => {
    if (n.type !== 'image' && n.type !== 'link') return;
    const props = (n.data as { hProperties?: Record<string, unknown> } | undefined)?.hProperties ?? {};
    const f: Found = { type: n.type, url: n.url };
    if (n.type === 'image') {
      f.alt = n.alt;
      if (props.width !== undefined) f.width = props.width;
      if (props.height !== undefined) f.height = props.height;
    } else if (props.dataEmbed !== undefined) f.mark = props.dataEmbed;
    out.push(f);
  });
  return out;
}

const paraName = (tree: Root): unknown => (tree.children[0]?.data as { hName?: string } | undefined)?.hName;

test('embedKind: 이미지 확장자 · md·확장자 없음 · 그 밖', () => {
  for (const t of ['a.png', 'b/c.JPG', 'x.jpeg', 'g.gif', 'w.webp', 'v.svg']) assert.equal(embedKind(t), 'image', t);
  for (const t of ['note', 'wiki/note', 'note.md', 'v1.2', '2026.10.24']) assert.equal(embedKind(t), 'note', t);
  for (const t of ['doc.pdf', 'out/a.html', 'board.canvas']) assert.equal(embedKind(t), 'file', t);
});

test('imageSize: 숫자 → width, WxH → width·height, 그 밖은 null', () => {
  assert.deepEqual(imageSize('460'), { width: '460' });
  assert.deepEqual(imageSize(' 640x480 '), { width: '640', height: '480' });
  assert.equal(imageSize('그림 설명'), null);
  assert.equal(imageSize('0'), null);
  assert.equal(imageSize('12345'), null);
});

test('embedKey: 앵커가 있으면 #으로 붙인다', () => {
  assert.equal(embedKey('note', null), 'note');
  assert.equal(embedKey('note', '절'), 'note#절');
});

// 문법 표 — 한 줄에 하나씩.
const TABLE: [string, Found[]][] = [
  ['![[golfmate-polish-06-complete.png|460]]', [{ type: 'image', url: 'golfmate-polish-06-complete.png', alt: '', width: '460' }]],
  ['![[img.png]]', [{ type: 'image', url: 'img.png', alt: '' }]],
  ['![[img.png|640x480]]', [{ type: 'image', url: 'img.png', alt: '', width: '640', height: '480' }]],
  ['![[img.png|화면 설명]]', [{ type: 'image', url: 'img.png', alt: '화면 설명' }]],
  ['![[note]]', [{ type: 'link', url: 'wikilink:note', mark: 'note' }]],
  ['![[wiki/note|별칭]]', [{ type: 'link', url: 'wikilink:wiki/note', mark: 'note' }]],
  ['![[note#절 제목]]', [{ type: 'link', url: 'wikilink:note#절 제목', mark: 'note' }]],
  ['![[note#^abc123]]', [{ type: 'link', url: 'wikilink:note#^abc123', mark: 'block' }]],
  ['![[#제목]]', [{ type: 'link', url: 'wikilink:#제목', mark: 'self' }]],
  ['![[doc.pdf]]', [{ type: 'link', url: 'wikilink:doc.pdf' }]],
  ['![[outputs/a.html]]', [{ type: 'link', url: 'wikilink:outputs/a.html' }]],
];

for (const [md, want] of TABLE) {
  test(`문법: ${md}`, () => {
    assert.deepEqual(found(run(md)), want);
  });
}

test('노트 임베드만 있는 문단은 div 가 된다(상자를 안에 둘 수 있게)', () => {
  assert.equal(paraName(run('![[note]]')), 'div');
  assert.equal(paraName(run('![[a]]\n![[b#x]]')), 'div');
  // 이미지만 있는 문단은 문단 그대로다.
  assert.equal(paraName(run('![[img.png|460]]')), undefined);
});

test('문장 안에 섞인 노트 임베드는 표시를 떼고 링크로 둔다', () => {
  const tree = run('앞 글 ![[note]] 뒤 글');
  assert.equal(paraName(tree), undefined);
  assert.deepEqual(found(tree), [{ type: 'link', url: 'wikilink:note' }]);
});

test('표 칸·제목 안의 노트 임베드도 링크로 둔다', () => {
  assert.deepEqual(found(run('| a |\n| --- |\n| ![[note]] |\n')), [{ type: 'link', url: 'wikilink:note' }]);
  assert.deepEqual(found(run('# ![[note]]')), [{ type: 'link', url: 'wikilink:note' }]);
});

test('코드 스팬·코드 블록·인용 속 코드 안의 ![[…]] 는 그대로 둔다', () => {
  assert.deepEqual(found(run('`![[note]]`')), []);
  assert.deepEqual(found(run('```\n![[note]]\n![[img.png]]\n```')), []);
  assert.deepEqual(found(run('> 설명: `![[img.png|460]]` 꼴')), []);
});

test('링크 글자 안의 ![[…]] 는 건드리지 않는다', () => {
  assert.deepEqual(found(run('[![[note]]](https://example.com)')), [{ type: 'link', url: 'https://example.com' }]);
});

test('nested: 노트 임베드는 상자 표시 없는 링크, 이미지는 그대로', () => {
  const tree = run('![[note]]\n\n![[img.png|100]]', true);
  assert.equal(paraName(tree), undefined);
  assert.deepEqual(found(tree), [
    { type: 'link', url: 'wikilink:note' },
    { type: 'image', url: 'img.png', alt: '', width: '100' },
  ]);
});

test('위키링크와 섞여도 각자 바뀐다 — 임베드가 먼저 돈다', () => {
  assert.deepEqual(found(run('[[a]] 와 ![[b.png]]')), [
    { type: 'link', url: 'wikilink:a' },
    { type: 'image', url: 'b.png', alt: '' },
  ]);
});

test('빈 임베드 ![[ ]] 와 짝 없는 ![[ 는 글자 그대로', () => {
  assert.deepEqual(found(run('![[ ]] 와 ![[열림')), []);
});
