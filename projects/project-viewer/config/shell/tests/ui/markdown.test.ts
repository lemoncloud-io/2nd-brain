import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Root, RootContent } from 'mdast';

import { extractHeadings } from '../../model/index.ts';
import type { Heading } from '../../model/index.ts';
import {
  imageMode,
  parseMarkdown,
  remarkHeadingIds,
  remarkHtmlAsText,
  remarkWikilinks,
  WIKILINK_SCHEME,
} from '../../src/reader/markdown.ts';

// 화면이 실제로 쓰는 순서대로 돌린다 — 플러그인 순서가 바뀌면 결과가 달라지므로 테스트도 같은 순서를 쓴다.
function render(text: string, headings?: Heading[]): Root {
  const tree = parseMarkdown(text);
  remarkHtmlAsText()(tree);
  remarkWikilinks()(tree);
  remarkHeadingIds(headings === undefined ? undefined : { headings })(tree);
  return tree;
}

type AnyNode = { type: string; [key: string]: unknown };

function walk(node: AnyNode, out: AnyNode[]): AnyNode[] {
  out.push(node);
  const children = node.children;
  if (Array.isArray(children)) for (const child of children) walk(child as AnyNode, out);
  return out;
}

function nodesOf(tree: Root, type: string): AnyNode[] {
  return walk(tree as unknown as AnyNode, []).filter((n) => n.type === type);
}

function linksOf(tree: Root): { url: string; text: string }[] {
  return nodesOf(tree, 'link').map((n) => ({
    url: String(n.url),
    text: ((n.children as AnyNode[]) ?? []).map((c) => String(c.value ?? '')).join(''),
  }));
}

function headingIds(tree: Root): string[] {
  const ids: string[] = [];
  for (const node of tree.children as RootContent[]) {
    if (node.type !== 'heading') continue;
    const data = node.data as { hProperties?: { id?: string } } | undefined;
    ids.push(data?.hProperties?.id ?? '');
  }
  return ids;
}

test('코드펜스 안의 [[x]]는 치환되지 않고 글자 그대로 남는다', () => {
  const md = ['본문 [[대상]] 하나', '', '```md', '[[펜스안]]', '```'].join('\n');
  const tree = render(md);

  const links = linksOf(tree);
  assert.deepEqual(
    links.map((l) => l.url),
    [`${WIKILINK_SCHEME}대상`],
    '펜스 안의 위키링크가 링크로 바뀌었다',
  );

  const fences = nodesOf(tree, 'code');
  assert.equal(fences.length, 1);
  assert.equal(fences[0]!.value, '[[펜스안]]', '펜스 안의 원문이 바뀌었다');
});

test('인라인 코드 안의 [[x]]는 치환되지 않는다', () => {
  const tree = render('`[[코드안]]` 과 [[코드밖]]');

  assert.deepEqual(
    linksOf(tree).map((l) => l.url),
    [`${WIKILINK_SCHEME}코드밖`],
  );
  const codes = nodesOf(tree, 'inlineCode');
  assert.equal(codes.length, 1);
  assert.equal(codes[0]!.value, '[[코드안]]', '인라인 코드 안의 원문이 바뀌었다');
});

test('물결표 하나짜리 C01~C04는 취소선이 아니다', () => {
  const tree = render('항목 C01~C04 범위를 본다');

  assert.equal(nodesOf(tree, 'delete').length, 0, 'singleTilde가 켜져 범위 표기가 취소선이 됐다');
  const text = nodesOf(tree, 'text')
    .map((n) => String(n.value))
    .join('');
  assert.equal(text.includes('C01~C04'), true, '범위 표기의 물결표가 사라졌다');
});

test('물결표 두 개짜리 ~~x~~는 취소선이다', () => {
  const tree = render('~~지운 문장~~ 과 남은 문장');

  const deletes = nodesOf(tree, 'delete');
  assert.equal(deletes.length, 1, 'GFM 취소선이 해석되지 않았다');
  assert.equal(((deletes[0]!.children as AnyNode[])[0] as AnyNode).value, '지운 문장');
});

test('표 셀 안의 [[a\\|b]]는 별칭이 붙은 링크로 읽는다', () => {
  const md = ['| 원본 | 설명 |', '| --- | --- |', '| [[design\\|설계 문서]] | 표 안 |'].join('\n');
  const tree = render(md);

  assert.equal(nodesOf(tree, 'table').length, 1, '표로 파싱되지 않았다');
  assert.deepEqual(linksOf(tree), [{ url: `${WIKILINK_SCHEME}design`, text: '설계 문서' }]);
});

test('별칭과 절이 함께 있는 위키링크는 절을 붙인 대상과 별칭 글자로 나뉜다', () => {
  const tree = render('[[design#검사 규칙|검사]] 와 [[design#검사 규칙]]');

  assert.deepEqual(linksOf(tree), [
    { url: `${WIKILINK_SCHEME}design#검사 규칙`, text: '검사' },
    { url: `${WIKILINK_SCHEME}design#검사 규칙`, text: 'design#검사 규칙' },
  ]);
});

test('이미 링크인 글자 안의 [[x]]는 다시 링크로 만들지 않는다', () => {
  const tree = render('[[[안쪽]]](x.md)');

  const urls = linksOf(tree).map((l) => l.url);
  assert.equal(
    urls.some((u) => u.startsWith(WIKILINK_SCHEME)),
    false,
    '링크 안에 링크가 생겼다',
  );
});

test('헤딩 id는 검사기(extractHeadings)의 슬러그와 같다 — 중복·인라인 코드·링크·한글', () => {
  const md = [
    '# 검사 규칙',
    '',
    '## `code` 가 든 헤딩',
    '',
    '## [링크](x.md) 가 든 헤딩',
    '',
    '## 검사 규칙',
    '',
    '## 검사 규칙',
    '',
    '```',
    '# 펜스 안의 헤딩',
    '```',
  ].join('\n');

  const expected = extractHeadings(md).map((h) => h.slug);
  // 중복 헤딩이 실제로 접미를 받는지 먼저 확인한다 — 아니면 이 테스트가 아무것도 지키지 못한다.
  assert.deepEqual(expected, [
    '검사-규칙',
    'code-가-든-헤딩',
    '링크-가-든-헤딩',
    '검사-규칙-1',
    '검사-규칙-2',
  ]);
  assert.deepEqual(headingIds(render(md)), expected);
});

test('빌드 때 계산한 headings를 주면 그 슬러그를 그대로 쓴다', () => {
  const md = ['# 첫 절', '', '## 둘째 절'].join('\n');
  const given: Heading[] = [
    { depth: 1, text: '첫 절', slug: 'fixed-one', line: 1 },
    { depth: 2, text: '둘째 절', slug: 'fixed-two', line: 3 },
  ];

  assert.deepEqual(headingIds(render(md, given)), ['fixed-one', 'fixed-two']);
});

test('주어진 headings가 본문과 어긋나면 그 자리만 직접 계산한 슬러그로 돌아간다', () => {
  const md = ['# 첫 절', '', '## 둘째 절'].join('\n');
  const given: Heading[] = [{ depth: 1, text: '다른 문구', slug: 'fixed-one', line: 1 }];

  assert.deepEqual(headingIds(render(md, given)), ['첫-절', '둘째-절']);
});

test('원문 안의 raw HTML은 렌더되지 않고 글자로 남는다', () => {
  const tree = render('<script>alert(1)</script>\n\n문단 안의 <b>굵게</b> 표시');

  assert.equal(nodesOf(tree, 'html').length, 0, 'raw HTML 노드가 남아 있다');
  const text = nodesOf(tree, 'text')
    .map((n) => String(n.value))
    .join('');
  assert.equal(text.includes('<script>'), true, 'HTML이 글자로 남지 않았다');
  assert.equal(text.includes('<b>'), true);
});

test('원격 이미지는 그리지 않고 배지로 둔다 — 런타임에 외부 네트워크를 쓰지 않는다', () => {
  // 산출물은 file://에서도 열려야 하고 CDN을 부르지 않는다(설계 § 빌드와 산출물).
  for (const src of [
    'https://example.com/a.png',
    'http://example.com/a.png',
    'HTTPS://EXAMPLE.COM/A.PNG',
    '//example.com/a.png',
  ]) {
    assert.equal(imageMode(src), 'badge-external', `원격 이미지를 그리려 한다: ${src}`);
  }
});

test('단일 HTML 안에 든 data: 이미지만 실제로 그린다', () => {
  assert.equal(imageMode('data:image/png;base64,iVBORw0KGgo='), 'inline');
  assert.equal(imageMode('DATA:image/png;base64,iVBORw0KGgo='), 'inline');
});

test('상대경로 이미지는 번들에 없으므로 처음부터 배지다', () => {
  for (const src of ['images/a.png', './a.png', '../fig/b.svg', '/abs/c.png', '', '   ']) {
    assert.equal(imageMode(src), 'badge-relative', `상대경로 판정이 아니다: ${src}`);
  }
});

test('javascript: 같은 주소는 외부 링크로도 만들지 않는다', () => {
  assert.equal(imageMode('javascript:alert(1)'), 'badge-relative');
  assert.equal(imageMode('file:///etc/passwd'), 'badge-relative');
});
