import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRelative } from '../../src/reader/relpath.ts';

test('resolveRelative: 문서 폴더 기준으로 푼다', () => {
  assert.equal(resolveRelative('wiki/a/doc.md', '../x.pdf'), 'wiki/x.pdf');
  assert.equal(resolveRelative('wiki/doc.md', './a/b.png'), 'wiki/a/b.png');
  assert.equal(resolveRelative('wiki/doc.md', 'a//./b.png'), 'wiki/a/b.png');
  assert.equal(resolveRelative('doc.md', 'img.png'), 'img.png');
});

test('resolveRelative: 한글·공백 이름은 그대로', () => {
  assert.equal(resolveRelative('wiki/문서.md', '../outputs/보고 서.html'), 'outputs/보고 서.html');
});

test('resolveRelative: 볼트 루트 밖·절대·빈 것은 null', () => {
  assert.equal(resolveRelative('wiki/doc.md', '../../..'), null);
  assert.equal(resolveRelative('wiki/doc.md', '../../x.pdf'), null);
  assert.equal(resolveRelative('wiki/doc.md', '..'), null);
  assert.equal(resolveRelative('wiki/doc.md', '/etc/passwd'), null);
  assert.equal(resolveRelative('wiki/doc.md', ''), null);
});
