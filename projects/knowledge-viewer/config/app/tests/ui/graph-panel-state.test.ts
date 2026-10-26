import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GraphNode, GraphResponse } from '../../src/app/types.ts';
import type { MergeResult } from '../../src/graph/merge.ts';
import { panelState } from '../../src/panels/graphPanelState.ts';

const node = (path: string, hop: number): GraphNode => ({
  path,
  title: path,
  kind: 'concept',
  cluster: 'wiki',
  hop,
  in: 0,
  out: 0,
  hub: false,
  truncated: false,
});

const C = 'wiki/a.md';
// 중심 하나와 이웃 n-1 개인 1홉 응답과 그 병합 결과.
const pair = (center: string, n: number): { data: MergeResult; res: GraphResponse } => {
  const nodes = n === 0 ? [] : [node(center, 0), ...Array.from({ length: n - 1 }, (_, i) => node(`wiki/n${i}.md`, 1))];
  const res: GraphResponse = { center, depth: 1, hubThreshold: 30, version: 1, nodes, links: [] };
  return { data: { nodes, links: [], changed: true, reheat: true }, res };
};

test('panelState: 결과가 없으면 불러오는 중', () => {
  assert.deepEqual(panelState({ data: null, res: null, path: C, missing: false, error: null }), {
    current: false,
    notice: '불러오는 중…',
    count: 0,
  });
});

test('panelState: 중심 없음이 오류보다 앞선다', () => {
  assert.equal(panelState({ data: null, res: null, path: C, missing: true, error: '서버 오류' }).notice, '중심 문서가 없다');
});

test('panelState: 오류가 불러오는 중보다 앞선다', () => {
  assert.equal(panelState({ data: null, res: null, path: C, missing: false, error: '서버 오류' }).notice, '서버 오류');
});

test('panelState: 옛 중심의 결과는 지금 결과가 아니다', () => {
  const s = panelState({ ...pair('wiki/old.md', 3), path: C, missing: false, error: null });
  assert.equal(s.current, false);
  assert.equal(s.notice, '불러오는 중…');
  assert.equal(s.count, 0);
});

test('panelState: 1홉 수는 노드 수 - 1 이다', () => {
  assert.deepEqual(panelState({ ...pair(C, 5), path: C, missing: false, error: null }), { current: true, notice: null, count: 4 });
  assert.equal(panelState({ ...pair(C, 1), path: C, missing: false, error: null }).count, 0);
});

test('panelState: 노드가 없으면 수는 0 이다', () => {
  const s = panelState({ ...pair(C, 0), path: C, missing: false, error: null });
  assert.equal(s.count, 0);
  assert.equal(s.current, false);
});
