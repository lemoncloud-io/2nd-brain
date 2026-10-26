import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractLinks, splitWikiTarget } from '../../shared/links.ts';

const ALPHA = readFileSync(
  fileURLToPath(new URL('../fixtures/vault/wiki/alpha.md', import.meta.url)),
  'utf8',
);

test('fixture alpha.md의 위키링크를 순서대로 뽑는다', () => {
  const refs = extractLinks(ALPHA);
  assert.deepEqual(
    refs.map((r) => [r.kind, r.target, r.anchor, r.label, r.embed]),
    [
      ['wiki', 'beta', null, 'beta', false],
      ['wiki', 'projects/demo/README', null, '데모', false],
      ['wiki', 'beta', null, '베타', false],
      ['wiki', 'beta', '둘째', '절', false],
    ],
  );
});

test('코드펜스 안의 [[ignored]]와 인라인 코드의 경로는 링크가 아니다', () => {
  const refs = extractLinks(ALPHA);
  assert.equal(refs.some((r) => r.target === 'ignored'), false);
  assert.equal(refs.some((r) => r.target.includes('raw/src.md')), false);
});

test('줄 번호는 frontmatter를 포함한 원문 기준이다', () => {
  const lines = ALPHA.split('\n');
  const refs = extractLinks(ALPHA);
  for (const r of refs) {
    assert.ok(lines[r.line - 1]?.includes('[['), `line ${r.line} 에 [[ 가 있어야 한다`);
  }
  assert.equal(refs[0]?.line, lines.findIndex((l) => l.startsWith('링크:')) + 1);
});

test('splitWikiTarget은 \\|와 #앵커를 다룬다', () => {
  assert.deepEqual(splitWikiTarget('a/b\\|별칭'), { target: 'a/b', anchor: null, label: '별칭' });
  assert.deepEqual(splitWikiTarget('a#절|x'), { target: 'a', anchor: '절', label: 'x' });
  assert.equal(splitWikiTarget('#절').target, '');
  assert.equal(splitWikiTarget('#절').anchor, '절');
});

test('![[…]]는 embed다', () => {
  assert.equal(extractLinks('![[img.png]]')[0]?.embed, true);
  assert.equal(extractLinks('[[img]]')[0]?.embed, false);
});

test('frontmatter 머리의 위키링크를 정규식으로 뽑는다', () => {
  const refs = extractLinks('---\nrelated: ["[[wiki/beta|B]] — why"]\n---\n');
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, 'wiki');
  assert.equal(refs[0]?.target, 'wiki/beta');
  assert.equal(refs[0]?.label, 'B');
  assert.equal(refs[0]?.line, 2);
});

test('상대 .md 링크는 kind md다', () => {
  const [ref] = extractLinks('[x](../../wiki/beta.md#h)');
  assert.deepEqual(ref, {
    kind: 'md',
    target: '../../wiki/beta.md',
    anchor: 'h',
    label: 'x',
    line: 1,
    embed: false,
  });
});

test('외부 링크·앵커 전용·이미지는 문서 링크가 아니다', () => {
  assert.deepEqual(extractLinks('[x](https://e.com/a.md)'), []);
  assert.deepEqual(extractLinks('[x](mailto:a@b.c)'), []);
  assert.deepEqual(extractLinks('[x](#h)'), []);
  assert.deepEqual(extractLinks('![x](a.md)'), []);
  assert.deepEqual(extractLinks('[x](a.png)'), []);
});

test('폴더 링크(/로 끝남)는 md다', () => {
  assert.equal(extractLinks('[x](../)')[0]?.target, '../');
});

test('url은 디코딩한다', () => {
  assert.equal(extractLinks('[x](%ED%95%9C%EA%B8%80.md)')[0]?.target, '한글.md');
});
