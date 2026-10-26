// 다시 데울 때의 노드 고정: 같은 중심에서 집합이 바뀌면 남은 노드를 지금 자리에 고정하고, 멈추면 푼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Positioned } from '../../src/graph/merge.ts';
import { applyPins, releasePins } from '../../src/graph/pins.ts';

const node = (path: string, at?: { x: number; y: number; z?: number }): Positioned => ({
  path,
  title: path,
  kind: 'concept',
  cluster: 'wiki',
  hop: 1,
  in: 0,
  out: 0,
  hub: false,
  truncated: false,
  ...(at ?? {}),
});

test('applyPins: 첫 그림·중심 변경은 중심만 원점에 고정하고 나머지는 풀어 둔다', () => {
  const c = node('c.md');
  const a = node('a.md', { x: 3, y: 4, z: 5 });
  a.fx = 9;
  a.fy = 9;
  a.fz = 9;
  const pinned = new Set(['a.md']);
  applyPins([c, a], 'c.md', new Set(['a.md']), { sameCenter: false, reheat: true }, pinned);
  assert.deepEqual([c.fx, c.fy, c.fz], [0, 0, 0]);
  assert.equal(a.fx, undefined);
  assert.equal(a.fz, undefined);
  assert.equal(pinned.size, 0);
});

test('applyPins: 같은 중심에서 집합이 바뀌면 남은 노드만 지금 자리에 고정한다(새 노드·중심은 아니다)', () => {
  const c = node('c.md', { x: 0, y: 0, z: 0 });
  const kept = node('kept.md', { x: 10, y: -2, z: 7 });
  const flat = node('flat.md', { x: 1, y: 2 });
  const fresh = node('new.md', { x: 11, y: -1, z: 6 });
  const pinned = new Set<string>();
  applyPins([c, kept, flat, fresh], 'c.md', new Map([['kept.md', ''], ['flat.md', ''], ['c.md', '']]), { sameCenter: true, reheat: true }, pinned);
  assert.deepEqual([kept.fx, kept.fy, kept.fz], [10, -2, 7]);
  // 2D 노드는 z 가 없다 — fz 를 두지 않는다.
  assert.deepEqual([flat.fx, flat.fy, flat.fz], [1, 2, undefined]);
  assert.equal(fresh.fx, undefined);
  assert.deepEqual([c.fx, c.fy, c.fz], [0, 0, 0]);
  assert.deepEqual([...pinned].sort(), ['flat.md', 'kept.md']);
});

test('applyPins: 멈추기 전에 또 바뀌면 그때 자리에 다시 고정한다(여러 번 해도 같다)', () => {
  const a = node('a.md', { x: 1, y: 1, z: 1 });
  const pinned = new Set<string>();
  applyPins([a], 'c.md', new Set(['a.md']), { sameCenter: true, reheat: true }, pinned);
  applyPins([a], 'c.md', new Set(['a.md']), { sameCenter: true, reheat: true }, pinned);
  assert.deepEqual([a.fx, a.fy, a.fz], [1, 1, 1]);
  assert.deepEqual([...pinned], ['a.md']);
});

test('applyPins: 가중치만 바뀌면 앞서 건 고정을 둔다', () => {
  const a = node('a.md', { x: 1, y: 2, z: 3 });
  const pinned = new Set<string>();
  applyPins([a], 'c.md', new Set(['a.md']), { sameCenter: true, reheat: true }, pinned);
  applyPins([a], 'c.md', new Set(['a.md']), { sameCenter: true, reheat: false }, pinned);
  assert.equal(a.fx, 1);
  assert.deepEqual([...pinned], ['a.md']);
});

test('releasePins: 우리가 건 고정만 풀고 중심의 원점 고정은 둔다', () => {
  const c = node('c.md');
  const a = node('a.md', { x: 1, y: 2, z: 3 });
  const other = node('o.md', { x: 5, y: 5, z: 5 });
  const pinned = new Set<string>();
  applyPins([c, a, other], 'c.md', new Set(['a.md']), { sameCenter: true, reheat: true }, pinned);
  // o.md 는 남은 노드가 아니므로 고정되지 않았다. 다른 이유로 걸린 고정이라도 releasePins 는 건드리지 않는다.
  other.fx = 5;
  releasePins([c, a, other], 'c.md', pinned);
  assert.equal(a.fx, undefined);
  assert.equal(a.fz, undefined);
  assert.equal(other.fx, 5);
  assert.deepEqual([c.fx, c.fy, c.fz], [0, 0, 0]);
  assert.equal(pinned.size, 0);
});
