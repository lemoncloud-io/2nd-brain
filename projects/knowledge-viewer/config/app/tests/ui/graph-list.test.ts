// 에이전트 모드 지도 목록: 홉별 묶음(순수)과 텍스트 목록 렌더를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { MAIN } from '../../shared/source.ts';
import type { GraphNode, GraphResponse } from '../../src/app/types.ts';
import { groupByHop, weightTo } from '../../src/graph/groupByHop.ts';

const { GraphList } = await import('../../src/graph/GraphList.tsx');

const node = (path: string, over: Partial<GraphNode> = {}): GraphNode => ({
  path,
  title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
  kind: 'concept',
  cluster: 'wiki',
  hop: 1,
  in: 0,
  out: 0,
  hub: false,
  truncated: false,
  ...over,
});

const res: GraphResponse = {
  center: 'wiki/alpha.md',
  depth: 2,
  hubThreshold: 50,
  version: 1,
  nodes: [
    node('wiki/alpha.md', { hop: 0, in: 23, out: 18 }),
    node('INDEX.md', { in: 1, out: 0 }),
    node('wiki/beta.md', { in: 1, out: 1, hub: true }),
    node('demo/README.md', { in: 2, out: 1 }),
    node('wiki/gamma.md', { hop: 2, in: 5, out: 0, truncated: true }),
  ],
  links: [
    { source: 'wiki/alpha.md', target: 'wiki/beta.md', weight: 3, mutual: false },
    { source: 'demo/README.md', target: 'wiki/alpha.md', weight: 1, mutual: false },
    { source: 'wiki/beta.md', target: 'wiki/gamma.md', weight: 9, mutual: false },
  ],
};

test('groupByHop: 홉 오름차순, 홉 안은 in+out 내림차순 뒤 경로 순', () => {
  const g = groupByHop(res);
  assert.equal(g.center?.path, 'wiki/alpha.md');
  assert.deepEqual(
    g.hops.map((h) => h.hop),
    [1, 2],
  );
  assert.deepEqual(
    g.hops[0]!.nodes.map((n) => n.path),
    ['demo/README.md', 'wiki/beta.md', 'INDEX.md'],
  );
});

test('groupByHop: 합이 같으면 경로의 코드 포인트 순', () => {
  const tie: GraphResponse = { ...res, nodes: [node('b.md'), node('B.md'), node('a.md'), node('wiki/alpha.md', { hop: 0 })] };
  assert.deepEqual(
    groupByHop(tie).hops[0]!.nodes.map((n) => n.path),
    ['B.md', 'a.md', 'b.md'],
  );
});

test('groupByHop: 전체 보기(center null)는 홉 -1 한 묶음', () => {
  const all: GraphResponse = { ...res, center: null, nodes: res.nodes.map((n) => ({ ...n, hop: -1 })) };
  const g = groupByHop(all);
  assert.equal(g.center, null);
  assert.equal(g.hops.length, 1);
  assert.equal(g.hops[0]!.hop, -1);
  assert.equal(g.hops[0]!.nodes.length, 5);
});

test('weightTo: 중심과 노드 사이 가중치는 어느 방향이든, 없으면 0', () => {
  assert.equal(weightTo(res, 'wiki/beta.md'), 3);
  assert.equal(weightTo(res, 'demo/README.md'), 1);
  assert.equal(weightTo(res, 'INDEX.md'), 0);
  assert.equal(weightTo({ ...res, center: null }, 'wiki/beta.md'), 0);
});

test('GraphList: 중심 줄·홉 제목·항목을 텍스트로 그린다(캔버스 없음)', () => {
  const html = renderToStaticMarkup(createElement(GraphList, { data: res, src: MAIN }));
  assert.ok(html.includes('data-graph-center="wiki/alpha.md"'));
  assert.ok(html.includes('중심: alpha (wiki/alpha.md) · concept · 들어옴 23 · 나감 18'));
  assert.ok(html.includes('<p data-vault-path="wiki/alpha.md">'));
  assert.ok(html.includes('1홉 (3)'));
  assert.ok(html.includes('2홉 (1)'));
  assert.ok(html.includes('data-vault-path="wiki/beta.md"'));
  assert.ok(html.includes('가중치 3'));
  assert.ok(html.includes('href="/v/wiki/beta.md?agent=claude"'));
  assert.ok(html.includes('가중치 3 · 허브'));
  assert.ok(html.includes('· 더 있음'));
  // 가중치 0(중심과 직접 잇지 않음)은 적지 않는다.
  assert.ok(html.includes('(INDEX.md) · concept</li>'), html);
  assert.ok(html.includes('(wiki/gamma.md) · concept · 더 있음'), html);
  assert.ok(!html.includes('가중치 0'));
  assert.ok(!html.includes('<canvas'));
});

test('GraphList: 전체 보기는 "전체 (N)" 제목, 중심 줄 없음', () => {
  const all: GraphResponse = { ...res, center: null, nodes: res.nodes.map((n) => ({ ...n, hop: -1 })) };
  const html = renderToStaticMarkup(createElement(GraphList, { data: all, src: MAIN }));
  assert.ok(html.includes('전체 (5)'));
  assert.ok(html.includes('data-graph-center=""'));
  assert.ok(!html.includes('중심:'));
});

test('GraphList: 항목 링크는 지금 소스(pr)를 싣는다', () => {
  const html = renderToStaticMarkup(createElement(GraphList, { data: res, src: { kind: 'pr', number: 7 } }));
  assert.ok(html.includes('href="/v/wiki/beta.md?agent=claude&amp;src=pr:7"'), html);
});
