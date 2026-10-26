import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyHref, isProvenancePath, transformUrl } from '../../src/reader/urls.ts';

test('transformUrl: 위키링크·앵커·http(s)·상대 경로는 통과', () => {
  for (const u of ['wikilink:foo#bar', '#sec', 'https://a.test/x', 'http://a.test', './a.md', '../b/c.md#x', 'dir/', 'img.png', 'a.html', '../x.pdf']) {
    assert.equal(transformUrl(u), u, u);
  }
});

test('transformUrl: 이미지 src는 그대로 둔다', () => {
  assert.equal(transformUrl('data:image/png;base64,AAAA', 'src'), 'data:image/png;base64,AAAA');
});

test('transformUrl: 그 밖은 빈 문자열', () => {
  for (const u of ['javascript:alert(1)', 'JavaScript:x', 'mailto:a@b.c', '//cdn.test/x.md', 'data:text/html,x', '']) {
    assert.equal(transformUrl(u), '', u);
  }
});

test('classifyHref: 위키링크는 인코딩을 풀고 앵커를 나눈다', () => {
  assert.deepEqual(classifyHref('wikilink:%EA%B0%80%20x#%EB%82%98'), { kind: 'wiki', target: '가 x', anchor: '나' });
  assert.deepEqual(classifyHref('wikilink:foo'), { kind: 'wiki', target: 'foo', anchor: '' });
  assert.deepEqual(classifyHref('wikilink:#sec'), { kind: 'anchor', anchor: 'sec' });
});

test('classifyHref: 상대 md·앵커·외부·그 밖', () => {
  assert.deepEqual(classifyHref('./a%20b.md#x'), { kind: 'md', target: './a b.md', anchor: 'x' });
  assert.deepEqual(classifyHref('#sec'), { kind: 'anchor', anchor: 'sec' });
  assert.deepEqual(classifyHref('https://a.test'), { kind: 'external', url: 'https://a.test' });
  assert.deepEqual(classifyHref(''), { kind: 'none' });
  assert.deepEqual(classifyHref(undefined), { kind: 'none' });
  assert.deepEqual(classifyHref('mailto:a@b.c'), { kind: 'none' });
});

test('classifyHref: md·폴더가 아닌 상대 경로는 file', () => {
  assert.deepEqual(classifyHref('../x.pdf#page=2'), { kind: 'file', target: '../x.pdf', anchor: 'page=2' });
  assert.deepEqual(classifyHref('%EB%B3%B4%EA%B3%A0%20%EC%84%9C.html'), { kind: 'file', target: '보고 서.html', anchor: '' });
  assert.deepEqual(classifyHref('dir/'), { kind: 'md', target: 'dir/', anchor: '' });
});

test('isProvenancePath: raw/·archive/ 아래 .md만', () => {
  assert.equal(isProvenancePath('raw/a.md'), true);
  assert.equal(isProvenancePath('archive/x/y.md'), true);
  assert.equal(isProvenancePath('wiki/a.md'), false);
  assert.equal(isProvenancePath('raw/a.png'), false);
  assert.equal(isProvenancePath('raw/.md'), false);
});
