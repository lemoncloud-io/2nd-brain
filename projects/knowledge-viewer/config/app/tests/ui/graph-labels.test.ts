// 제목 규칙 — 주요 노드 선택·호버 이웃·격자 겹침 제거(순수).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAJOR_MAX,
  MAJOR_MIN,
  adjacencyOf,
  cullOverlaps,
  hoverNeighbors,
  isLabelMode,
  labelWidth,
  majorLimit,
  selectMajor,
} from '../../src/graph/labels.ts';

const node = (path: string, deg: number, hub = false) => ({ path, in: deg, out: 0, hub });

test('majorLimit: max(8, 4 %) 에 상한 40', () => {
  assert.equal(MAJOR_MIN, 8);
  assert.equal(MAJOR_MAX, 40);
  assert.equal(majorLimit(47), 8);
  assert.equal(majorLimit(162), 8);
  assert.equal(majorLimit(546), 22);
  assert.equal(majorLimit(2324), 40);
});

test('selectMajor: 중심·허브·연결 수 상위 N, 동률은 경로 순', () => {
  const nodes = [
    node('c.md', 1),
    node('hub.md', 2, true),
    ...Array.from({ length: 20 }, (_, i) => node(`n${String(i).padStart(2, '0')}.md`, 100 - i)),
    node('tie-b.md', 100),
    node('tie-a.md', 100),
  ];
  const major = selectMajor(nodes, 'c.md');
  assert.ok(major.has('c.md'), '중심');
  assert.ok(major.has('hub.md'), '허브');
  // 상위 8: n00·tie-a·tie-b(100, 경로 순) 다음 n01(99) … n05(95). n06(94) 은 9 번째다.
  for (const p of ['tie-a.md', 'n00.md', 'tie-b.md', 'n01.md', 'n05.md']) assert.ok(major.has(p), p);
  assert.ok(!major.has('n06.md'), 'n06 은 9 번째');
  assert.equal(major.size, 2 + 8);
});

test('selectMajor: 중심이 비면(전체 보기) 더하지 않는다', () => {
  const major = selectMajor([node('a.md', 1), node('b.md', 2)], '');
  assert.deepEqual([...major].sort(), ['a.md', 'b.md']);
});

test('adjacencyOf·hoverNeighbors: 양방향 이웃을 연결 수 순으로 12 개까지', () => {
  const links = [
    ...Array.from({ length: 15 }, (_, i) => ({ source: 'x.md', target: `y${i}.md` })),
    { source: { path: 'z.md' }, target: { path: 'x.md' } },
    { source: 'x.md', target: 'y0.md' },
  ];
  const adj = adjacencyOf(links);
  assert.ok(adj.get('z.md')?.includes('x.md'));
  const deg = (p: string) => (p === 'z.md' ? 99 : p === 'y3.md' ? 50 : 1);
  const nb = hoverNeighbors('x.md', adj, deg);
  assert.equal(nb.length, 12);
  assert.deepEqual(nb.slice(0, 2), ['z.md', 'y3.md']);
  assert.equal(new Set(nb).size, 12, '중복 없음');
  assert.deepEqual(hoverNeighbors('none.md', adj, deg), []);
});

test('labelWidth: 전각은 글자 높이, 그 밖은 0.55 배', () => {
  assert.equal(labelWidth('ab', 10), 11);
  assert.equal(labelWidth('가나', 10), 20);
  assert.equal(labelWidth('a가', 10), 15.5);
  assert.equal(labelWidth('', 10), 0);
});

test('cullOverlaps: 겹치면 rank 큰 쪽만 남고, 떨어져 있으면 둘 다 남는다', () => {
  const kept = cullOverlaps(
    [
      { id: 'small', x: 100, y: 100, w: 60, h: 14, rank: 3 },
      { id: 'big', x: 110, y: 104, w: 60, h: 14, rank: 10 },
      { id: 'far', x: 400, y: 300, w: 60, h: 14, rank: 1 },
    ],
    16,
  );
  assert.deepEqual([...kept].sort(), ['big', 'far']);
});

test('cullOverlaps: 같은 rank 는 id 순으로 정해 매 프레임 같은 쪽이 남는다', () => {
  const boxes = [
    { id: 'b', x: 50, y: 50, w: 40, h: 14, rank: 5 },
    { id: 'a', x: 52, y: 50, w: 40, h: 14, rank: 5 },
  ];
  assert.deepEqual([...cullOverlaps(boxes)], ['a']);
  assert.deepEqual([...cullOverlaps([...boxes].reverse())], ['a']);
});

test('cullOverlaps: 비면 빈 집합, 음수 좌표도 칸을 잡는다', () => {
  assert.equal(cullOverlaps([]).size, 0);
  const kept = cullOverlaps([
    { id: 'p', x: -5, y: -5, w: 20, h: 10, rank: 1 },
    { id: 'q', x: -8, y: -3, w: 20, h: 10, rank: 2 },
  ]);
  assert.deepEqual([...kept], ['q']);
});

test('isLabelMode: 세 값만', () => {
  assert.equal(isLabelMode('major'), true);
  assert.equal(isLabelMode('all'), true);
  assert.equal(isLabelMode('none'), true);
  assert.equal(isLabelMode('x'), false);
  assert.equal(isLabelMode(null), false);
});
