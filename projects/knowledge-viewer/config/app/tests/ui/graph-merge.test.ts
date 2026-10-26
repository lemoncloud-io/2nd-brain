import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GraphLink, GraphNode, GraphResponse } from '../../src/app/types.ts';
import { mergeGraph } from '../../src/graph/merge.ts';
import type { Positioned } from '../../src/graph/merge.ts';
import { shouldRefetch } from '../../src/graph/useGraphData.ts';

const node = (path: string, over: Partial<GraphNode> = {}): GraphNode => ({
  path,
  title: path,
  kind: 'concept',
  cluster: 'wiki',
  hop: 0,
  in: 0,
  out: 0,
  hub: false,
  truncated: false,
  ...over,
});
const link = (source: string, target: string, weight = 1): GraphLink => ({ source, target, weight, mutual: false });
const res = (nodes: GraphNode[], links: GraphLink[] = [], version = 1): GraphResponse => ({
  center: 'a',
  depth: 2,
  hubThreshold: 50,
  version,
  nodes,
  links,
});

test('집합이 같으면 reheat=false, 좌표 유지', () => {
  const a: Positioned = { ...node('a'), x: 1, y: 2, z: 3 };
  const out = mergeGraph({ nodes: [a], links: [] }, res([node('a', { in: 7, title: '새 제목' })]));
  assert.equal(out.nodes[0], a);
  assert.equal(out.nodes[0]?.x, 1);
  assert.equal(out.nodes[0]?.in, 7);
  assert.equal(out.nodes[0]?.title, '새 제목');
  assert.equal(out.reheat, false);
  assert.equal(out.changed, false);
});

test('shouldRefetch: raw·archive·private 첫 폴더만 거른다', () => {
  for (const p of ['wiki/a.md', 'projects/x', 'docs']) assert.equal(shouldRefetch(p), true, p);
  for (const p of ['raw/a.md', 'archive/x.md', 'private/p.md']) assert.equal(shouldRefetch(p), false, p);
});

test('새 노드는 이웃 옆', () => {
  const a: Positioned = { ...node('a'), x: 10, y: 20, z: 30 };
  const out = mergeGraph({ nodes: [a], links: [] }, res([node('a'), node('b')], [link('a', 'b')]));
  const b = out.nodes.find((n) => n.path === 'b');
  assert.ok(b);
  assert.ok(b.x !== undefined && Math.abs(b.x - 10) <= 5, `x=${b.x}`);
  assert.ok(b.y !== undefined && Math.abs(b.y - 20) <= 5, `y=${b.y}`);
  assert.ok(b.z !== undefined && Math.abs(b.z - 30) <= 5, `z=${b.z}`);
  assert.equal(out.reheat, true);
  assert.equal(out.changed, true);
});

test('사라진 노드 제거', () => {
  const prev = { nodes: [node('a'), node('b')] as Positioned[], links: [link('a', 'b')] };
  const out = mergeGraph(prev, res([node('a')]));
  assert.equal(out.nodes.length, 1);
  assert.equal(out.links.length, 0);
  assert.equal(out.reheat, true);
});

test('가중치만 바뀌면 changed 만', () => {
  const prev = { nodes: [node('a'), node('b')] as Positioned[], links: [link('a', 'b', 1)] };
  const out = mergeGraph(prev, res([node('a'), node('b')], [link('a', 'b', 2)]));
  assert.equal(out.changed, true);
  assert.equal(out.reheat, false);
  assert.equal(out.links[0]?.weight, 2);
});

test('간선 끝이 노드 객체로 바뀌어 있어도 같은 집합으로 본다', () => {
  const a: Positioned = node('a');
  const b: Positioned = node('b');
  // 3d-force-graph 는 source·target 을 노드 객체로 바꿔 둔다.
  const mutated = { source: a, target: b, weight: 1, mutual: false } as unknown as GraphLink;
  const out = mergeGraph({ nodes: [a, b], links: [mutated] }, res([node('a'), node('b')], [link('a', 'b', 1)]));
  assert.equal(out.changed, false);
  assert.equal(out.reheat, false);
  assert.equal(out.links[0]?.source, 'a');
});

test('prev null', () => {
  const out = mergeGraph(null, res([node('a'), node('b')], [link('a', 'b')]));
  assert.equal(out.changed, true);
  assert.equal(out.reheat, true);
  for (const n of out.nodes) assert.equal(n.x, undefined);
});
