import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changedMapOf, changedUnder, deltaOf } from '../../src/app/changed.ts';

const map = changedMapOf([
  { path: 'wiki/a.md', status: 'M' },
  { path: 'projects/x/README.md', status: 'A' },
  { path: 'projects/x/old.md', status: 'D' },
  { path: 'wiki/new.md', status: 'R', from: 'wiki/old.md' },
]);

test('changedMapOf: 경로 → 상태', () => {
  assert.equal(map.get('wiki/a.md'), 'M');
  assert.equal(map.get('wiki/new.md'), 'R');
  assert.equal(map.get('wiki/old.md'), undefined);
  assert.equal(map.size, 4);
});

test('changedUnder: 하위 경로에 변경이 있으면 true', () => {
  assert.equal(changedUnder(map, 'wiki'), true);
  assert.equal(changedUnder(map, 'projects'), true);
  assert.equal(changedUnder(map, 'projects/x'), true);
  assert.equal(changedUnder(map, 'projects/x/'), true);
});

test('changedUnder: 접두만 같은 이웃 폴더·없는 폴더는 false', () => {
  assert.equal(changedUnder(map, 'wik'), false);
  assert.equal(changedUnder(map, 'projects/xy'), false);
  assert.equal(changedUnder(map, 'raw'), false);
  // 파일 자기 경로는 폴더가 아니다.
  assert.equal(changedUnder(map, 'wiki/a.md'), false);
});

test('changedUnder: 지도가 없거나 비었으면 false, 루트는 변경이 하나라도 있으면 true', () => {
  assert.equal(changedUnder(undefined, 'wiki'), false);
  assert.equal(changedUnder(new Map(), ''), false);
  assert.equal(changedUnder(map, ''), true);
});

test('deltaOf: A=+, M·R=Δ, D=−', () => {
  assert.equal(deltaOf('A'), '+');
  assert.equal(deltaOf('M'), 'Δ');
  assert.equal(deltaOf('R'), 'Δ');
  assert.equal(deltaOf('D'), '−');
});
