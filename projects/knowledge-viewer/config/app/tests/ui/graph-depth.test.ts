// 3D 깊이감 — 거리 정규화·양자화·크기·불투명도·안개 범위(순수).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEPTH_LEVELS, LABEL_FRONT, depthOf, depthRange, fogRange, isFront, opacityAt, quantize, scaleAt } from '../../src/graph/depth.ts';

const near = (actual: number, expected: number, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('depthRange: 5·95 백분위를 앞·뒤 끝으로 삼고 바깥 튄 값은 무시한다', () => {
  // 1..100 에 멀리 튄 값 1000 — 최대값이 아니라 95 백분위 근처가 far 다.
  const d = [...Array.from({ length: 100 }, (_, i) => i + 1), 1000];
  const r = depthRange(d);
  assert.ok(r.near >= 5 && r.near <= 7, `near ${r.near}`);
  assert.ok(r.far >= 94 && r.far <= 97, `far ${r.far}`);
});

test('depthRange: 비면 [0, 1], 모두 같으면 far 를 1 띄운다, 입력은 그대로다', () => {
  assert.deepEqual(depthRange([]), { near: 0, far: 1 });
  assert.deepEqual(depthRange([7, 7, 7]), { near: 7, far: 8 });
  const src = Float64Array.of(3, 1, 2);
  depthRange(src);
  assert.deepEqual([...src], [3, 1, 2]);
});

test('depthOf: 범위 안은 0~1 로, 밖은 끝값', () => {
  assert.equal(depthOf(100, 100, 200), 0);
  assert.equal(depthOf(150, 100, 200), 0.5);
  assert.equal(depthOf(200, 100, 200), 1);
  assert.equal(depthOf(50, 100, 200), 0);
  assert.equal(depthOf(900, 100, 200), 1);
});

test('quantize: DEPTH_LEVELS 단계 가운데 가장 가까운 값', () => {
  assert.equal(DEPTH_LEVELS, 6);
  assert.equal(quantize(0), 0);
  assert.equal(quantize(1), 1);
  near(quantize(0.45), 0.4);
  near(quantize(0.55), 0.6);
  near(quantize(0.31), 0.4);
  near(quantize(0.29), 0.2);
  assert.equal(new Set(Array.from({ length: 101 }, (_, i) => quantize(i / 100))).size, DEPTH_LEVELS);
});

test('scaleAt: 앞 1.25 · 뒤 0.75, 불투명도는 앞 1 · 뒤 0.35', () => {
  near(scaleAt(0), 1.25);
  near(scaleAt(1), 0.75);
  near(scaleAt(0.5), 1);
  near(opacityAt(0), 1);
  near(opacityAt(1), 0.35);
  near(opacityAt(0.5), 0.675);
  // 범위 밖도 끝값이다.
  near(scaleAt(-3), 1.25);
  near(opacityAt(9), 0.35);
});

test('isFront: LABEL_FRONT(0.6) 앞만 참', () => {
  assert.equal(LABEL_FRONT, 0.6);
  assert.equal(isFront(0.59), true);
  assert.equal(isFront(0.6), false);
});

test('fogRange: near 는 그대로, far 는 뒤 끝에서 65 % 만 섞이도록 더 멀리', () => {
  const f = fogRange(100, 200);
  assert.equal(f.near, 100);
  // 선형 안개의 섞임 = (d − near) / (far − near). d = 200 에서 0.65 여야 한다.
  near((200 - f.near) / (f.far - f.near), 0.65);
});
