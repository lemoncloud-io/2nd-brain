import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moveImageSrcToTitle, rawImageUrl, type ImageEnv } from '../../src/reader/imageSrc.ts';

type El = { type: string; tagName: string; properties: Record<string, unknown>; children: never[] };
const img = (src: string, extra: Record<string, unknown> = {}): El => ({
  type: 'element',
  tagName: 'img',
  properties: { src, alt: 'a', ...extra },
  children: [],
});

test('moveImageSrcToTitle: 외부·상대 src는 title로 옮기고 src를 지운다', () => {
  const tree = { type: 'root', children: [img('https://x.test/a.png'), img('./a.png', { title: '원래' })] };
  moveImageSrcToTitle(tree);
  assert.deepEqual(tree.children[0]?.properties, { alt: 'a', title: 'https://x.test/a.png' });
  assert.deepEqual(tree.children[1]?.properties, { alt: 'a', title: './a.png' });
});

test('moveImageSrcToTitle: data: src는 그대로 둔다', () => {
  const tree = { type: 'root', children: [img('data:image/png;base64,AAAA')] };
  moveImageSrcToTitle(tree);
  assert.equal(tree.children[0]?.properties.src, 'data:image/png;base64,AAAA');
  assert.equal('title' in (tree.children[0]?.properties ?? {}), false);
});

test('moveImageSrcToTitle: 깊이 들어 있는 img도 고친다', () => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', children: [img('x.png')] }] };
  moveImageSrcToTitle(tree as never);
  const inner = (tree.children[0] as { children: El[] }).children[0];
  assert.equal(inner?.properties.title, 'x.png');
});

// ── 볼트 이미지(env 를 넘길 때) ─────────────────────────────────────────────
const ENV: ImageEnv = {
  agent: false,
  docPath: 'projects/p/outputs/doc.md',
  links: [{ kind: 'wiki', target: '그림.png', embed: true, path: 'projects/p/outputs/assets/그림.png' }],
  gitOrigin: 'http://localhost:8779',
};
const run1 = (el: El, env: ImageEnv | undefined = ENV): Record<string, unknown> => {
  const tree = { type: 'root', children: [el] };
  moveImageSrcToTitle(tree, env);
  return tree.children[0]!.properties;
};

test('moveImageSrcToTitle(env): 상대경로는 문서 기준으로 풀어 /raw 로, title 에 원 경로, lazy·async', () => {
  assert.deepEqual(run1(img('assets/a.png')), {
    src: '/raw/projects/p/outputs/assets/a.png',
    alt: 'a',
    title: 'assets/a.png',
    loading: 'lazy',
    decoding: 'async',
  });
  assert.equal(run1(img('../shared/b.SVG')).src, '/raw/projects/p/shared/b.SVG');
  // 퍼센트 인코딩된 url 은 풀어서 풀고, 주소는 다시 부호화한다.
  const k = run1(img('%EA%B7%B8%EB%A6%BC.png'));
  assert.equal(k.title, '그림.png');
  assert.equal(k.src, '/raw/projects/p/outputs/' + encodeURI('그림.png'));
});

test('moveImageSrcToTitle(env): 볼트 밖(..)·절대경로·원격·javascript:·이미지 아닌 확장자는 배지(src 지움)', () => {
  for (const s of ['../../../../x.png', '/etc/x.png', 'https://x.test/a.png', '//x.test/a.png', 'javascript:alert(1)', 'file:///x.png', 'a.pdf']) {
    const p = run1(img(s));
    assert.equal('src' in p, false, s);
    assert.equal(p.title, s);
  }
});

test('moveImageSrcToTitle(env): 위키 임베드는 표시를 떼고 링크 표의 경로로 그린다 — 없으면 배지', () => {
  const p = run1(img(encodeURI('그림.png'), { dataWikiEmbed: '1', width: '640' }));
  assert.equal(p.src, '/raw/projects/p/outputs/assets/' + encodeURI('그림.png'));
  assert.equal(p.width, '640');
  assert.equal('dataWikiEmbed' in p, false);
  const miss = run1(img('없는.png', { dataWikiEmbed: '1' }));
  assert.equal('src' in miss, false);
  assert.equal('dataWikiEmbed' in miss, false);
  // 같은 이름의 ![](…) 는 문서 기준 상대경로로 푼다(링크 표를 보지 않는다).
  assert.equal(run1(img(encodeURI('그림.png'))).src, '/raw/projects/p/outputs/' + encodeURI('그림.png'));
});

test('moveImageSrcToTitle(env): git 소스는 git 출처의 /raw/@main·@pr 주소', () => {
  assert.equal(run1(img('a.png'), { ...ENV, src: { kind: 'main' } }).src, 'http://localhost:8779/raw/@main/projects/p/outputs/a.png');
  assert.equal(run1(img('a.svg'), { ...ENV, src: { kind: 'pr', number: 12 } }).src, 'http://localhost:8779/raw/@pr/12/projects/p/outputs/a.svg');
  assert.equal(rawImageUrl('@x/a.png', { kind: 'local' }, 'http://localhost:1'), '/raw/%40x/a.png');
});

test('moveImageSrcToTitle(env): 에이전트 모드는 볼트 이미지도 배지다', () => {
  const p = run1(img('assets/a.png', { dataWikiEmbed: '1' }), { ...ENV, agent: true });
  assert.deepEqual(p, { alt: 'a', title: 'assets/a.png' });
});

test('moveImageSrcToTitle(env): 링크 안의 이미지는 볼트·배지 모두 data-in-link', () => {
  const tree = {
    type: 'root',
    children: [{ type: 'element', tagName: 'a', properties: { href: 'x.md' }, children: [img('a.png'), img('https://x.test/b.png')] }],
  };
  moveImageSrcToTitle(tree as never, ENV);
  const [vault, remote] = (tree.children[0] as unknown as { children: El[] }).children;
  assert.equal(vault!.properties.dataInLink, '1');
  assert.equal(remote!.properties.dataInLink, '1');
  assert.equal('dataInLink' in run1(img('a.png')), false);
});
