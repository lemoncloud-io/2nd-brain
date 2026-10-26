// 범례 종류 강조 — 노드·간선 판정, 제목 후보 합치기, 노드 호버 우선, 저장소(순수).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Kind } from '../../shared/kind.ts';
import { HOVER_OTHER_ALPHA } from '../../src/graph/interaction.ts';
import {
  KIND_OFF_ALPHA,
  activeKind,
  createKindHoverStore,
  kindHighlight,
  kindCounts,
  kindLinkHighlight,
  labelRole,
} from '../../src/graph/kind-highlight.ts';
import { cullOverlaps } from '../../src/graph/labels.ts';

const nodes: { path: string; kind: Kind }[] = [
  { path: 'wiki/a.md', kind: 'concept' },
  { path: 'wiki/b.md', kind: 'concept' },
  { path: 'wiki/t.md', kind: 'tool' },
  { path: 'docs/d.md', kind: 'doc' },
];

test('흐린 톤은 노드 호버의 나머지 톤과 같다', () => {
  assert.equal(KIND_OFF_ALPHA, HOVER_OTHER_ALPHA);
  assert.equal(KIND_OFF_ALPHA, 0.25);
});

test('kindHighlight: 강조가 없으면 전부 none', () => {
  for (const n of nodes) assert.equal(kindHighlight(n, null), 'none');
});

test('kindHighlight: 같은 종류는 on, 다른 종류는 off', () => {
  assert.equal(kindHighlight(nodes[0], 'concept'), 'on');
  assert.equal(kindHighlight(nodes[1], 'concept'), 'on');
  assert.equal(kindHighlight(nodes[2], 'concept'), 'off');
  assert.equal(kindHighlight(nodes[3], 'concept'), 'off');
});

test('kindHighlight: 노드 호버가 있으면 노드 호버가 이긴다 — 종류 강조는 none', () => {
  assert.equal(activeKind('concept', 'wiki/t.md'), null);
  assert.equal(activeKind('concept', null), 'concept');
  for (const n of nodes) assert.equal(kindHighlight(n, 'concept', 'wiki/t.md'), 'none');
});

test('kindLinkHighlight: 두 끝이 모두 그 종류일 때만 on', () => {
  assert.equal(kindLinkHighlight('concept', 'concept', null), 'none');
  assert.equal(kindLinkHighlight('concept', 'concept', 'concept'), 'on');
  assert.equal(kindLinkHighlight('concept', 'tool', 'concept'), 'off');
  assert.equal(kindLinkHighlight('tool', 'doc', 'concept'), 'off');
  assert.equal(kindLinkHighlight(undefined, 'concept', 'concept'), 'off');
});

test('labelRole: 강조가 없으면 기본 후보 판정 그대로', () => {
  assert.equal(labelRole(nodes[0], true, null), 'candidate');
  assert.equal(labelRole(nodes[0], false, null), 'skip');
});

test('labelRole: 라벨 후보가 그 종류 전부를 포함한다 — 기본 후보가 아니어도 force', () => {
  // 선별에서 빠진(base 거짓) 노드도 그 종류면 전부 force 다
  const roles = nodes.map((n) => labelRole(n, n.path === 'docs/d.md', 'concept'));
  assert.deepEqual(roles, ['force', 'force', 'skip', 'candidate']);
  const forced = nodes.filter((_n, i) => roles[i] === 'force').map((n) => n.path);
  assert.deepEqual(forced, nodes.filter((n) => n.kind === 'concept').map((n) => n.path));
});

test('labelRole: 노드 호버가 있으면 기본 후보만(노드 호버 우선)', () => {
  assert.equal(labelRole(nodes[0], false, 'concept', 'wiki/t.md'), 'skip');
  assert.equal(labelRole(nodes[0], true, 'concept', 'wiki/t.md'), 'candidate');
});

test('kindCounts: 종류별 노드 수', () => {
  const c = kindCounts(nodes);
  assert.equal(c.get('concept'), 2);
  assert.equal(c.get('tool'), 1);
  assert.equal(c.get('idea'), undefined);
});

test('cullOverlaps: force 상자는 겹쳐도 전부 남고, 다른 상자보다 먼저 자리를 잡는다', () => {
  const kept = cullOverlaps([
    { id: 'big', x: 0, y: 0, w: 40, h: 10, rank: 1e9 },
    { id: 'k1', x: 0, y: 0, w: 40, h: 10, rank: 1, force: true },
    { id: 'k2', x: 2, y: 0, w: 40, h: 10, rank: 0, force: true },
  ]);
  assert.ok(kept.has('k1'));
  assert.ok(kept.has('k2'));
  assert.ok(!kept.has('big'), '강제 상자가 먼저 자리를 잡아 겹치는 보통 상자는 걷힌다');
});

test('저장소: 같은 값은 알리지 않고, 끊으면 더 듣지 않는다', () => {
  const s = createKindHoverStore();
  const seen: (Kind | null)[] = [];
  const off = s.subscribe((k) => seen.push(k));
  s.set('tool');
  s.set('tool');
  s.set(null);
  off();
  s.set('doc');
  assert.deepEqual(seen, ['tool', null]);
  assert.equal(s.get(), 'doc');
});
