import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placeCard } from '../../src/reader/preview-place.ts';

const viewport = { width: 1000, height: 800 };
const card = { width: 400, height: 200 };
const rect = (left: number, top: number, w = 80, h = 20) => ({ left, top, right: left + w, bottom: top + h });

test('placeCard: 아래에 자리가 있으면 앵커 아래에 놓는다', () => {
  const p = placeCard(rect(100, 100), viewport, card);
  assert.deepEqual(p, { left: 100, top: 128, side: 'below' });
});

test('placeCard: 아래가 모자라고 위가 넉넉하면 위에 놓는다', () => {
  const p = placeCard(rect(100, 700), viewport, card);
  assert.equal(p.side, 'above');
  assert.equal(p.top, 700 - 8 - 200);
});

test('placeCard: 오른쪽 가장자리를 넘으면 왼쪽으로 당긴다', () => {
  const p = placeCard(rect(900, 100), viewport, card);
  assert.equal(p.left, 1000 - 400 - 12);
});

test('placeCard: 왼쪽 가장자리 밖이면 여백으로 당긴다', () => {
  const p = placeCard(rect(-30, 100), viewport, card);
  assert.equal(p.left, 12);
});

test('placeCard: 위아래 모두 모자라면 화면 안에 가둔다', () => {
  const tall = { width: 400, height: 350 };
  const p = placeCard(rect(100, 150), { width: 1000, height: 400 }, tall);
  assert.equal(p.top, 400 - 350 - 12);
});
