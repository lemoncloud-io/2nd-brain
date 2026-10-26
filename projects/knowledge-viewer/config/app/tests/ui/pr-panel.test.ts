import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatUpdated, splitFiles } from '../../src/panels/pr-format.ts';

test('splitFiles: viewable md 와 없는 md 를 경로순으로 나누고 md 외는 개수만', () => {
  const r = splitFiles([
    { path: 'wiki/z.md', md: true, viewable: true },
    { path: 'outputs/a.html', md: false, viewable: false },
    { path: 'wiki/b.md', md: true, viewable: false },
    { path: 'wiki/a.md', md: true, viewable: true },
    { path: 'src/x.ts', md: false, viewable: false },
  ]);
  assert.deepEqual(r.viewable.map((f) => f.path), ['wiki/a.md', 'wiki/z.md']);
  assert.deepEqual(r.missing.map((f) => f.path), ['wiki/b.md']);
  assert.equal(r.otherCount, 2);
});

test('formatUpdated: 분·시간·어제·날짜', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(formatUpdated('2026-10-23T11:57:00Z', now), '3분 전');
  assert.equal(formatUpdated('2026-10-23T12:00:30Z', now), '방금');
  assert.equal(formatUpdated('2026-10-23T10:00:00Z', now), '2시간 전');
  assert.equal(formatUpdated('2026-10-22T13:00:00Z', now), '어제');
  assert.equal(formatUpdated('2026-10-01T00:00:00Z', now), '2026-10-01');
  assert.equal(formatUpdated('bogus', now), '');
});
