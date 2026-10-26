// 라벨 전파 커뮤니티: 결정적이고, 두 덩어리를 가르고, 혼자는 혼자다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { communityCount, communitySizes, labelPropagation } from '../../src/graph/community.ts';

const tri = (a: string, b: string, c: string) => [
  { source: a, target: b },
  { source: b, target: c },
  { source: c, target: a },
];

test('두 삼각형을 다리 하나로 이으면 두 커뮤니티', () => {
  const paths = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const links = [...tri('a1', 'a2', 'a3'), ...tri('b1', 'b2', 'b3'), { source: 'a3', target: 'b1' }];
  const c = labelPropagation(paths, links);
  assert.equal(c.get('a1'), c.get('a2'));
  assert.equal(c.get('a2'), c.get('a3'));
  assert.equal(c.get('b1'), c.get('b2'));
  assert.equal(c.get('b2'), c.get('b3'));
  assert.notEqual(c.get('a1'), c.get('b1'));
  assert.equal(communityCount(c), 2);
  // id 는 그 커뮤니티에서 경로가 가장 작은 노드다.
  assert.equal(c.get('a3'), 'a1');
  assert.equal(c.get('b3'), 'b1');
});

test('결정적이다 — 입력 순서를 바꿔도 같은 결과', () => {
  const paths = ['x', 'y', 'z', 'p', 'q'];
  const links = [{ source: 'x', target: 'y' }, { source: 'y', target: 'z' }, { source: 'p', target: 'q' }];
  const a = labelPropagation(paths, links);
  const b = labelPropagation([...paths].reverse(), [...links].reverse());
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

test('간선이 없는 노드는 자기 자신이고 묶음 수에 들지 않는다', () => {
  const c = labelPropagation(['lonely', 'a', 'b'], [{ source: 'a', target: 'b' }]);
  assert.equal(c.get('lonely'), 'lonely');
  assert.equal(c.get('a'), 'a');
  assert.equal(c.get('b'), 'a');
  assert.deepEqual([...communitySizes(c).entries()].sort(), [['a', 2], ['lonely', 1]]);
  assert.equal(communityCount(c), 1);
});

test('허브의 표는 희석된다 — INDEX 에 닿은 두 덩어리가 INDEX 로 뭉치지 않는다', () => {
  // index 가 여섯 문서 모두에 닿고, a 셋·b 셋은 각각 삼각형이다.
  const paths = ['index', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const links = [
    ...tri('a1', 'a2', 'a3'),
    ...tri('b1', 'b2', 'b3'),
    ...['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((t) => ({ source: 'index', target: t })),
  ];
  const c = labelPropagation(paths, links);
  assert.equal(c.get('a1'), c.get('a3'));
  assert.equal(c.get('b1'), c.get('b3'));
  assert.notEqual(c.get('a1'), c.get('b1'));
  assert.equal(communityCount(c), 2);
});

test('가중치가 큰 쪽으로 붙는다', () => {
  // m 은 a 쪽 간선 하나(가중 5)와 b 쪽 간선 둘(가중 1씩) — 합이 큰 a 쪽.
  const paths = ['a', 'b1', 'b2', 'm'];
  const links = [
    { source: 'm', target: 'a', weight: 5 },
    { source: 'm', target: 'b1', weight: 1 },
    { source: 'm', target: 'b2', weight: 1 },
    { source: 'b1', target: 'b2', weight: 1 },
  ];
  const c = labelPropagation(paths, links);
  assert.equal(c.get('m'), c.get('a'));
});

test('모르는 끝·자기 간선은 무시하고, 라운드 상한에서 멈춘다', () => {
  const c = labelPropagation(['a', 'b'], [{ source: 'a', target: 'zzz' }, { source: 'a', target: 'a' }, { source: 'a', target: 'b' }], 1);
  assert.equal(c.get('a'), c.get('b'));
});
