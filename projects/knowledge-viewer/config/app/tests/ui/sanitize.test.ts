import { test } from 'node:test';
import assert from 'node:assert/strict';

import rehypeSanitize from 'rehype-sanitize';

import { IMG_SRC, REMOTE_ASK, SANITIZE_SCHEMA } from '../../src/reader/sanitize.ts';

const tags = SANITIZE_SCHEMA.tagNames ?? [];

test('SANITIZE_SCHEMA: details·summary·kbd 등을 허용한다', () => {
  for (const t of ['details', 'summary', 'kbd', 'img', 'br', 'sub', 'sup']) assert.ok(tags.includes(t), t);
});

test('SANITIZE_SCHEMA: script·iframe 등은 허용하지 않는다', () => {
  for (const t of ['script', 'iframe', 'style', 'object', 'embed']) assert.ok(!tags.includes(t), t);
});

test('SANITIZE_SCHEMA: tagNames에 중복이 없다', () => {
  assert.equal(new Set(tags).size, tags.length);
});

test('SANITIZE_SCHEMA: img는 alt·title·src(IMG_SRC)·loading(lazy)·decoding(async)·data-in-link(1)·data-remote-ask(https)만 허용한다', () => {
  assert.deepEqual(SANITIZE_SCHEMA.attributes?.img, [
    'alt',
    'title',
    ['src', IMG_SRC],
    ['loading', 'lazy'],
    ['decoding', 'async'],
    ['dataInLink', '1'],
    ['dataRemoteAsk', REMOTE_ASK],
  ]);
});

test('SANITIZE_SCHEMA: img src 프로토콜은 data·http(git 출처용)·https(원격 토글), href는 wikilink를 더 허용한다', () => {
  assert.deepEqual(SANITIZE_SCHEMA.protocols?.src, ['data', 'http', 'https']);
  const href = SANITIZE_SCHEMA.protocols?.href ?? [];
  for (const p of ['http', 'https', 'mailto', 'wikilink']) assert.ok(href.includes(p), p);
});

test('SANITIZE_SCHEMA: 주석은 버린다', () => {
  assert.notEqual(SANITIZE_SCHEMA.allowComments, true);
});

test('SANITIZE_SCHEMA: 헤딩 id에 접두를 붙이지 않는다', () => {
  assert.deepEqual(SANITIZE_SCHEMA.clobber, []);
  assert.ok(SANITIZE_SCHEMA.attributes?.['*']?.includes('id'));
});

test('SANITIZE_SCHEMA: td·th className 은 표 보기 클래스 값만 허용한다', () => {
  assert.deepEqual(SANITIZE_SCHEMA.attributes?.td, [['className', 'cell-first', 'cell-short']]);
  assert.deepEqual(SANITIZE_SCHEMA.attributes?.th, [['className', 'cell-first', 'cell-short']]);
});

test('SANITIZE_SCHEMA: PR 변경 표시(changed 클래스·data-changed·data-removed)만 더 허용한다', () => {
  const all = SANITIZE_SCHEMA.attributes?.['*'] ?? [];
  assert.ok(all.some((a) => Array.isArray(a) && a[0] === 'className' && a.includes('changed') && a.length === 2));
  assert.ok(all.includes('dataChanged'));
  assert.ok(all.includes('dataRemoved'));
});

test('SANITIZE_SCHEMA: h2·ul·ol 의 className 튜플은 기존 값에 changed 를 더한다', () => {
  const tuple = (tag: string) => (SANITIZE_SCHEMA.attributes?.[tag] ?? []).find((a) => Array.isArray(a) && a[0] === 'className');
  assert.deepEqual(tuple('h2'), ['className', 'sr-only', 'changed']);
  assert.deepEqual(tuple('ul'), ['className', 'contains-task-list', 'changed']);
  assert.deepEqual(tuple('ol'), ['className', 'contains-task-list', 'changed']);
  // <pre> 는 태그별 규칙이 없어 '*' 를 따른다.
  assert.equal(SANITIZE_SCHEMA.attributes?.pre, undefined);
});

// ── img src 값 검사(정화를 실제로 돌린다) ────────────────────────────────────
type Img = { type: 'element'; tagName: 'img'; properties: Record<string, unknown>; children: [] };
const clean = (properties: Record<string, unknown>): Record<string, unknown> => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'img', properties, children: [] } as Img] };
  const out = (rehypeSanitize as unknown as (s: unknown) => (t: unknown) => typeof tree)(SANITIZE_SCHEMA)(tree);
  return out.children[0]!.properties;
};

test('sanitize: img src 허용 3종(data:·같은 출처 /raw/…·git 출처 /raw/@main|@pr/<n>/…)은 통과한다', () => {
  for (const src of [
    'data:image/png;base64,AAAA',
    '/raw/wiki/a.png',
    '/raw/%40x/a.svg',
    'http://localhost:8779/raw/@main/wiki/a.png',
    'http://localhost:8779/raw/@pr/12/wiki/a.svg',
  ]) {
    assert.equal(clean({ src, alt: 'a' }).src, src, src);
  }
  assert.deepEqual(clean({ src: '/raw/a.png', loading: 'lazy', decoding: 'async', dataInLink: '1', width: '640' }), {
    src: '/raw/a.png',
    loading: 'lazy',
    decoding: 'async',
    dataInLink: '1',
    width: '640',
  });
});

test('sanitize: 원격 https:// 는 값 검사로 통과한다 — 그릴지는 rehypeImageSrcToTitle 이 앞에서 정한다', () => {
  for (const src of ['https://image.lemoncloud.io/abc', 'https://miro.medium.com/v2/a.png', 'https://localhost:8779/raw/@main/a.png']) {
    assert.equal(clean({ src, alt: 'a' }).src, src, src);
  }
  assert.equal(clean({ dataRemoteAsk: 'https://miro.medium.com/a.png' }).dataRemoteAsk, 'https://miro.medium.com/a.png');
  for (const v of ['http://miro.medium.com/a.png', 'javascript:alert(1)', '//evil.test/a.png', 'x']) {
    assert.equal('dataRemoteAsk' in clean({ dataRemoteAsk: v }), false, v);
  }
});

test('sanitize: http 원격·절대경로·javascript:·file:·다른 출처·같은 출처 git 접두는 src 를 벗긴다', () => {
  for (const src of [
    'http://evil.test/a.png',
    'http://image.lemoncloud.io/a.png',
    'http://evil.test/raw/@main/a.png',
    'http://localhost:8779/raw/wiki/a.png',
    'http://localhost.evil.test:80/raw/@main/a.png',
    '//evil.test/raw/a.png',
    '//image.lemoncloud.io/a.png',
    '/etc/passwd.png',
    '/raw//evil.test/a.png',
    '/raw/@main/wiki/a.png',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'file:///etc/a.png',
    'raw/a.png',
  ]) {
    assert.equal('src' in clean({ src, alt: 'a' }), false, src);
  }
  // 다른 값의 loading·decoding·data-in-link 도 벗긴다.
  assert.deepEqual(clean({ loading: 'eager', decoding: 'sync', dataInLink: 'x', dataWikiEmbed: '1' }), {});
});
