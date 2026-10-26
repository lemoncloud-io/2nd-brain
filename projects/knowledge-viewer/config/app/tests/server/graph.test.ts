// /api/graph 의 계산부 — BFS·허브 규칙·간선 두 겹·가중치.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildGraph, GraphError, inGraphScope, linkCount } from '../../server/graph.ts';
import type { GraphResponse } from '../../server/graph.ts';
import { VaultIndex } from '../../server/index-store.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const ALPHA = 'wiki/alpha.md';
const BETA = 'wiki/beta.md';
const INDEX = 'wiki/INDEX.md';
const DEMO = 'projects/demo/README.md';

const paths = (g: GraphResponse): string[] => g.nodes.map((n) => n.path).sort();
const node = (g: GraphResponse, p: string): GraphResponse['nodes'][number] => {
  const n = g.nodes.find((x) => x.path === p);
  assert.ok(n, `노드가 없다: ${p}`);
  return n;
};
const link = (g: GraphResponse, source: string, target: string): GraphResponse['links'][number] | undefined =>
  g.links.find((l) => l.source === source && l.target === target);

describe('buildGraph', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let idx: VaultIndex;
  beforeEach(() => {
    fx = makeFixtureVault();
    idx = new VaultIndex(fx.root);
    idx.build();
  });
  afterEach(() => fx.cleanup());

  it('node_modules 안의 문서는 노드가 아니다 — 전체 보기·중심 지도·중심 지정 모두', () => {
    // 색인이 거르지만, 지도 층에서도 거른다(inGraphScope). 색인에 억지로 넣어도 노드·간선에 안 들어간다.
    assert.equal(inGraphScope('projects/x/config/app/node_modules/pkg/README.md'), false);
    assert.equal(inGraphScope('wiki/INDEX.md'), true);
    const nm = path.join(fx.root, 'projects', 'app', 'node_modules', 'pkg');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'README.md'), `---\ntype: concept\n---\n\n# pkg\n\n[[${ALPHA.replace(/\.md$/, '')}]]\n`);
    idx = new VaultIndex(fx.root);
    idx.build();
    const all = buildGraph(idx, { all: true }, 50);
    assert.ok(all.nodes.every((n) => !n.path.includes('node_modules')));
    assert.ok(all.links.every((l) => !l.source.includes('node_modules') && !l.target.includes('node_modules')));
    const g = buildGraph(idx, { center: ALPHA, depth: 3, hubs: 'expand', expand: [] }, 50);
    assert.ok(g.nodes.every((n) => !n.path.includes('node_modules')));
    assert.throws(() => buildGraph(idx, { center: 'projects/app/node_modules/pkg/README.md', depth: 1, hubs: 'keep', expand: [] }, 50), GraphError);
  });

  it('linkCount 는 양방향 링크 수를 합한다', () => {
    assert.equal(linkCount(idx, ALPHA, BETA), 3);
    assert.equal(linkCount(idx, BETA, ALPHA), 3);
    assert.equal(linkCount(idx, ALPHA, DEMO), 2);
  });

  it('1홉 이웃과 가중치', () => {
    const g = buildGraph(idx, { center: ALPHA, depth: 1, hubs: 'keep', expand: [] }, 50);
    assert.deepEqual(paths(g), [INDEX, ALPHA, BETA, DEMO].sort());
    assert.equal(g.center, ALPHA);
    assert.equal(g.depth, 1);
    assert.equal(g.hubThreshold, 50);
    assert.equal(g.version, idx.version);
    assert.equal(node(g, ALPHA).hop, 0);
    for (const p of [BETA, DEMO, INDEX]) assert.equal(node(g, p).hop, 1);
    assert.deepEqual(link(g, ALPHA, BETA), { source: ALPHA, target: BETA, weight: 3, mutual: false });
    assert.deepEqual(link(g, ALPHA, DEMO), { source: ALPHA, target: DEMO, weight: 2, mutual: true });
    assert.deepEqual(link(g, INDEX, ALPHA), { source: INDEX, target: ALPHA, weight: 1, mutual: false });
    assert.deepEqual([node(g, ALPHA).in, node(g, ALPHA).out], [2, 2]);
    assert.equal(node(g, ALPHA).kind, idx.kind(ALPHA));
    assert.equal(node(g, ALPHA).cluster, idx.cluster(ALPHA));
    assert.equal(node(g, ALPHA).title, idx.title(ALPHA));
    assert.equal(node(g, ALPHA).hub, false);
    for (const p of [BETA, DEMO, INDEX, ALPHA]) assert.equal(node(g, p).truncated, false, p);
  });

  it('2홉 기본', () => {
    const g = buildGraph(idx, { center: INDEX, depth: 2, hubs: 'keep', expand: [] }, 50);
    assert.equal(g.nodes.length, 4);
    assert.equal(node(g, INDEX).hop, 0);
    assert.equal(node(g, ALPHA).hop, 1);
    assert.equal(node(g, BETA).hop, 2);
    assert.equal(node(g, DEMO).hop, 2);
  });

  it('1홉이 마지막이면 너머가 있는 노드는 truncated', () => {
    const g = buildGraph(idx, { center: INDEX, depth: 1, hubs: 'keep', expand: [] }, 50);
    assert.deepEqual(paths(g), [ALPHA, INDEX].sort());
    assert.equal(node(g, ALPHA).truncated, true);
    assert.equal(node(g, INDEX).truncated, false);
  });

  it('expand 는 마지막 홉 노드도 한 홉 더 펼친다', () => {
    const base = buildGraph(idx, { center: INDEX, depth: 1, hubs: 'keep', expand: [] }, 50);
    assert.deepEqual(paths(base), [ALPHA, INDEX].sort());
    assert.equal(node(base, ALPHA).hop, 1);
    assert.equal(node(base, ALPHA).truncated, true);
    const g = buildGraph(idx, { center: INDEX, depth: 1, hubs: 'keep', expand: [ALPHA] }, 50);
    assert.deepEqual(paths(g), [ALPHA, BETA, DEMO, INDEX].sort());
    assert.equal(g.depth, 1);
    assert.equal(node(g, BETA).hop, 2);
    assert.equal(node(g, DEMO).hop, 2);
    assert.equal(node(g, ALPHA).truncated, false);
    // 새로 닿은 노드는 expand 에 없으면 더 펼치지 않는다.
    const none = buildGraph(idx, { center: INDEX, depth: 1, hubs: 'keep', expand: [BETA] }, 50);
    assert.deepEqual(paths(none), [ALPHA, INDEX].sort());
  });

  it('중심은 허브여도 펼친다', () => {
    const g = buildGraph(idx, { center: ALPHA, depth: 1, hubs: 'keep', expand: [] }, 3);
    assert.equal(g.nodes.length, 4);
    assert.equal(node(g, ALPHA).hub, true);
    assert.equal(g.hubThreshold, 3);
  });

  it('허브는 안 펼친다', () => {
    const keep = buildGraph(idx, { center: INDEX, depth: 2, hubs: 'keep', expand: [] }, 3);
    assert.deepEqual(paths(keep), [ALPHA, INDEX].sort());
    assert.equal(node(keep, ALPHA).hub, true);
    assert.equal(node(keep, ALPHA).truncated, true);
    assert.equal(keep.links.length, 1);
    const all = buildGraph(idx, { center: INDEX, depth: 2, hubs: 'expand', expand: [] }, 3);
    assert.equal(all.nodes.length, 4);
    const one = buildGraph(idx, { center: INDEX, depth: 2, hubs: 'keep', expand: [ALPHA] }, 3);
    assert.equal(one.nodes.length, 4);
    // 모르는 경로는 무시한다
    const ignored = buildGraph(idx, { center: INDEX, depth: 2, hubs: 'keep', expand: ['wiki/none.md'] }, 3);
    assert.deepEqual(paths(ignored), [ALPHA, INDEX].sort());
  });

  it('펼치지 않은 허브의 간선은 BFS 간선만', () => {
    const keep = buildGraph(idx, { center: BETA, depth: 2, hubs: 'keep', expand: [] }, 3);
    assert.deepEqual(paths(keep), [ALPHA, BETA, DEMO].sort());
    assert.deepEqual(keep.links.map((l) => `${l.source}>${l.target}`).sort(), [`${ALPHA}>${BETA}`, `${DEMO}>${BETA}`].sort());
    const ex = buildGraph(idx, { center: BETA, depth: 2, hubs: 'expand', expand: [] }, 3);
    // 펼치면 alpha 너머의 INDEX 도 2홉으로 든다. beta·alpha·demo/README 셋 사이에는 간선이 셋이다.
    assert.deepEqual(paths(ex), [ALPHA, BETA, DEMO, INDEX].sort());
    assert.equal(ex.links.filter((l) => l.source !== INDEX).length, 3);
    assert.ok(ex.links.some((l) => (l.source === ALPHA && l.target === DEMO) || (l.source === DEMO && l.target === ALPHA)));
  });

  it('두 부모가 같은 허브에 닿아도 BFS 간선은 하나', () => {
    // 문턱 3 이면 alpha 가 허브다. demo/README 에서 alpha·beta 가 모두 1홉이다.
    // beta 를 펼치면 2홉에서 alpha 에 다시 닿지만 alpha 는 이미 찾았다 — alpha 의 간선은 demo/README–alpha 하나뿐이다.
    const g = buildGraph(idx, { center: DEMO, depth: 2, hubs: 'keep', expand: [] }, 3);
    assert.deepEqual(paths(g), [ALPHA, BETA, DEMO].sort());
    assert.equal(node(g, ALPHA).hub, true);
    assert.equal(node(g, ALPHA).truncated, true);
    assert.deepEqual(
      g.links.map((l) => `${l.source}>${l.target}:${l.mutual}`).sort(),
      [`${DEMO}>${ALPHA}:true`, `${DEMO}>${BETA}:false`].sort(),
    );
    assert.equal(link(g, ALPHA, BETA), undefined);
    assert.equal(g.links.filter((l) => l.source === ALPHA || l.target === ALPHA).length, 1);
  });

  it('전체', () => {
    const g = buildGraph(idx, { all: true }, 50);
    assert.equal(g.center, null);
    assert.equal(g.nodes.length, 6);
    assert.ok(g.nodes.every((n) => n.hop === -1 && !n.truncated));
    assert.equal(g.links.length, 4);
    assert.equal(g.links.filter((l) => l.mutual).length, 1);
  });

  it('링크는 source, target 순으로 안정 정렬된다', () => {
    const g = buildGraph(idx, { all: true }, 50);
    const keys = g.links.map((l) => `${l.source}\0${l.target}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  it('한글 경로 center·expand', () => {
    const rel = 'wiki/한글 노트.md';
    fs.writeFileSync(path.join(fx.root, rel), '---\ntype: concept\n---\n\n# 한글\n\n[[alpha]]\n');
    idx.update(rel);
    const g = buildGraph(idx, { center: rel, depth: 1, hubs: 'keep', expand: [] }, 50);
    assert.equal(g.nodes.length, 2);
    // 문턱 1 이면 alpha 는 허브다. expand 로 펼치면 beta·demo/README 가 든다.
    const closed = buildGraph(idx, { center: rel, depth: 2, hubs: 'keep', expand: [] }, 1);
    assert.deepEqual(paths(closed), [ALPHA, rel].sort());
    const open = buildGraph(idx, { center: rel, depth: 2, hubs: 'keep', expand: [ALPHA] }, 1);
    assert.ok(open.nodes.some((n) => n.path === BETA));
    assert.ok(open.nodes.some((n) => n.path === DEMO));
  });

  it('없는 중심은 throw', () => {
    assert.throws(() => buildGraph(idx, { center: 'raw/beta.md', depth: 2, hubs: 'keep', expand: [] }, 50), GraphError);
    assert.throws(() => buildGraph(idx, { center: 'wiki/none.md', depth: 2, hubs: 'keep', expand: [] }, 50), GraphError);
  });
});
