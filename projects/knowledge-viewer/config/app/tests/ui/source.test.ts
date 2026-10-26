import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL, MAIN, parseSource, sourceKey } from '../../shared/source.ts';
import { hrefFor, parseLocation } from '../../src/app/route.ts';

test('parseSource: main · local · pr:<n>', () => {
  assert.deepEqual(parseSource('main'), { kind: 'main' });
  assert.deepEqual(parseSource('local'), { kind: 'local' });
  assert.deepEqual(parseSource('pr:927'), { kind: 'pr', number: 927 });
  assert.deepEqual(parseSource('pr:0001'), { kind: 'pr', number: 1 });
});

test('parseSource: 그 밖은 null', () => {
  for (const s of ['pr:1234567890', 'PR:1', '', 'pr:', 'pr:-1', 'pr:1a', 'zzz', ' main']) {
    assert.equal(parseSource(s), null, s);
  }
  assert.equal(parseSource(null), null);
  assert.equal(parseSource(undefined), null);
});

test('sourceKey: 왕복', () => {
  assert.equal(sourceKey(MAIN), 'main');
  assert.equal(sourceKey(LOCAL), 'local');
  assert.equal(sourceKey({ kind: 'pr', number: 927 }), 'pr:927');
  for (const k of ['main', 'local', 'pr:927']) {
    const s = parseSource(k);
    assert.ok(s !== null);
    assert.equal(sourceKey(s), k);
  }
});

test('parseLocation: src 쿼리를 읽고 없거나 틀리면 main', () => {
  const r = parseLocation('/v/a.md', '?src=pr:927&agent=claude', '');
  assert.deepEqual(r.src, { kind: 'pr', number: 927 });
  assert.equal(r.agent, true);
  assert.deepEqual(parseLocation('/v/a.md', '?src=zzz', '').src, MAIN);
  assert.deepEqual(parseLocation('/v/a.md', '', '').src, MAIN);
  assert.deepEqual(parseLocation('/v/a.md', '?src=local', '').src, LOCAL);
});

test('hrefFor: src 는 main 이면 생략, 그 밖은 붙인다', () => {
  assert.equal(hrefFor('a.md', undefined, false, { kind: 'main' }), '/v/a.md');
  assert.equal(hrefFor('a.md', 'h', true, { kind: 'pr', number: 927 }), '/v/a.md?agent=claude&src=pr:927#h');
  assert.equal(hrefFor('a.md', undefined, false, LOCAL), '/v/a.md?src=local');
  assert.equal(hrefFor('a.md'), '/v/a.md');
});
