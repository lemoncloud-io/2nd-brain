// 임베딩 묶음의 k-means(순수) — k 규칙, 결정성, 빈 군집 처리.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kFor, kmeans, normalize, seededRandom } from '../../server/kmeans.ts';

test('kFor: max(2, round(√(n/2))), 문서가 적으면 문서 수', () => {
  assert.equal(kFor(0), 0);
  assert.equal(kFor(1), 1);
  assert.equal(kFor(2), 2);
  assert.equal(kFor(8), 2);
  assert.equal(kFor(50), 5);
  assert.equal(kFor(2330), 34);
});

test('seededRandom 은 같은 시드면 같은 수열', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  for (let i = 0; i < 5; i += 1) assert.equal(a(), b());
});

test('normalize: 단위 길이, 0 벡터는 0', () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(v[0]! - 0.6) < 1e-6 && Math.abs(v[1]! - 0.8) < 1e-6);
  assert.deepEqual([...normalize([0, 0])], [0, 0]);
});

/** 세 방향 둘레에 흩은 점. 방향(코사인)이 같으면 길이가 달라도 한 군집이다. */
function blobs(): number[][] {
  const out: number[][] = [];
  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const r = seededRandom(1);
  for (const d of dirs) for (let i = 0; i < 10; i += 1) out.push(d.map((x) => (x + (r() - 0.5) * 0.2) * (1 + i)));
  return out;
}

test('kmeans: 방향별 묶음을 가르고(코사인), 같은 입력이면 같은 답', () => {
  const xs = blobs();
  const a = kmeans(xs, 3);
  const b = kmeans(xs, 3);
  assert.deepEqual(a.assign, b.assign);
  assert.equal(a.k, 3);
  for (let g = 0; g < 3; g += 1) {
    const ids = new Set(a.assign.slice(g * 10, g * 10 + 10));
    assert.equal(ids.size, 1, `묶음 ${g} 는 한 군집`);
  }
  assert.equal(new Set(a.assign).size, 3);
  assert.ok(a.iterations <= 20);
});

test('kmeans: 같은 점이 많아 군집이 비면 다시 심어 k 개를 채운다', () => {
  const xs = [...Array.from({ length: 6 }, () => [1, 0]), [0, 1], [0, 1]];
  const r = kmeans(xs, 4);
  assert.equal(r.k, 4);
  const sizes = new Map<number, number>();
  for (const a of r.assign) sizes.set(a, (sizes.get(a) ?? 0) + 1);
  assert.equal(sizes.size, 4, '빈 군집이 없다');
});

test('kmeans: k 가 점보다 많으면 점 수로, 빈 입력은 0', () => {
  assert.equal(kmeans([[1, 0], [0, 1]], 5).k, 2);
  assert.deepEqual(kmeans([], 3), { k: 0, assign: [], iterations: 0 });
});
