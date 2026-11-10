import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Stage, StagesBlock, StatusView, Tone } from '../../model/types.ts';
import {
  buildFlow,
  centerScroll,
  describeNode,
  groupStages,
  hasStageLinks,
  relatedTo,
  segmentState,
  stageProgress,
  plain,
  stageState,
  subtitle,
} from '../../src/blocks/flowlayout.ts';

function sv(tone: Tone, done = false, label = 'x'): StatusView {
  return { status: label, label, tone, done, origin: 'ledger', evidence: [] };
}
function block(stages: Stage[]): StagesBlock {
  return { type: 'stages', stages };
}

// 마일스톤 M0~M4, M4 아래 B0~B3. B3는 B1 다음.
const stages: Stage[] = [
  { id: 'M0', title: 'M0 범위', short: 'M0', items: [{ id: 'M0.c1', label: 'a' }] },
  { id: 'M1', title: 'M1 조사', short: 'M1' },
  { id: 'M2', title: 'M2 설계', short: 'M2', items: [{ id: 'M2.c1', label: 'a' }, { id: 'M2.c2', label: 'b' }] },
  { id: 'B0', title: 'B0 하네스', short: 'B0', parent: 'M4' },
  { id: 'M4', title: 'M4 실행', short: 'M4' },
  { id: 'B1', title: 'B1 패키징', short: 'B1', parent: 'M4' },
  { id: 'B2', title: 'B2 의존성', short: 'B2', parent: 'M4' },
  { id: 'B3', title: 'B3 통합', short: 'B3', parent: 'M4', after: ['B1'] },
];
const status: Record<string, StatusView> = {
  M0: sv('green', true),
  'M0.c1': sv('green', true),
  M1: sv('green', true),
  M2: sv('blue'),
  'M2.c1': sv('green', true),
  M4: sv('blue'),
  B0: sv('green', true),
  B1: sv('green', true),
  B2: sv('amber'),
  B3: sv('muted'),
};

test('parent·after가 하나도 없으면 묶음·흐름을 켜지 않는다', () => {
  assert.equal(hasStageLinks(block([{ id: 'S1', title: 'a' }, { id: 'S2', title: 'b' }])), false);
  assert.equal(hasStageLinks(block([{ id: 'S1', title: 'a' }, { id: 'S2', title: 'b', after: [] }])), false);
  assert.equal(hasStageLinks(block([{ id: 'S1', title: 'a' }, { id: 'S2', title: 'b', after: ['S1'] }])), true);
  assert.equal(hasStageLinks(block(stages)), true);
});

test('stageState는 done 플래그와 tone으로만 판정한다', () => {
  assert.equal(stageState(sv('green', true)), 'done');
  assert.equal(stageState(sv('green', false)), 'todo');
  assert.equal(stageState(sv('blue')), 'doing');
  assert.equal(stageState(sv('amber')), 'doing');
  assert.equal(stageState(sv('red')), 'blocked');
  assert.equal(stageState(sv('muted')), 'todo');
  assert.equal(stageState(undefined), 'todo');
  assert.equal(stageState({ ...sv('blue'), origin: 'none' }), 'todo');
});

test('groupStages는 최상위 순서를 지키고 하위 단계를 부모 아래 원래 순서로 모은다', () => {
  const g = groupStages(stages);
  assert.deepEqual(
    g.map((x) => [x.stage.id, x.children.map((c) => c.id)]),
    [
      ['M0', []],
      ['M1', []],
      ['M2', []],
      ['M4', ['B0', 'B1', 'B2', 'B3']],
    ],
  );
});

test('끊긴 parent는 최상위로 남아 사라지지 않는다', () => {
  const g = groupStages([{ id: 'A', title: 'a', parent: 'Z' }]);
  assert.deepEqual(g.map((x) => x.stage.id), ['A']);
});

test('진행 집계: 자기 항목 우선, 없으면 하위 단계', () => {
  const g = groupStages(stages);
  const m2 = g[2]!;
  const m4 = g[3]!;
  assert.deepEqual(stageProgress(m2.stage, m2.children, status), { done: 1, total: 2, from: 'items' });
  assert.deepEqual(stageProgress(m4.stage, m4.children, status), { done: 2, total: 4, from: 'children' });
  assert.deepEqual(stageProgress(g[1]!.stage, [], status), { done: 0, total: 0, from: 'none' });
});

test('구간 상태: 들어가는 단계가 끝났으면 done, 진행 중이면 doing, 아니면 todo', () => {
  assert.equal(segmentState('done'), 'done');
  assert.equal(segmentState('doing'), 'doing');
  assert.equal(segmentState('todo'), 'todo');
  assert.equal(segmentState('blocked'), 'todo');
});

test('buildFlow: 파이프라인은 최상위 단계 순서, 지금 단계는 끝나지 않은 첫 최상위 단계', () => {
  const M = buildFlow(block(stages), status);
  assert.deepEqual(M.stops.map((r) => r.node.id), ['M0', 'M1', 'M2', 'M4']);
  assert.equal(M.currentId, 'M2');
  assert.deepEqual(M.nodes.filter((n) => n.current).map((n) => n.id), ['M2']);
  // 보이는 순서 = 초점 순서: 파이프라인 전부(왼쪽 → 오른쪽), 그다음 아래 묶음 칸
  assert.deepEqual(M.nodes.map((n) => n.id), ['M0', 'M1', 'M2', 'M4', 'B0', 'B1', 'B2', 'B3']);
  assert.deepEqual(M.nodes.map((n) => n.order), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('buildFlow: 묶음 칸이 둘이면 파이프라인 뒤에 부모 순서대로, 하위 단계는 그 뒤', () => {
  const two: Stage[] = [
    { id: 'A', title: 'A', short: 'A' },
    { id: 'a1', title: 'a1', parent: 'A' },
    { id: 'B', title: 'B', short: 'B' },
    { id: 'b1', title: 'b1', parent: 'B' },
    { id: 'C', title: 'C', short: 'C' },
  ];
  const M = buildFlow(block(two), {});
  assert.deepEqual(M.nodes.map((n) => n.id), ['A', 'B', 'C', 'a1', 'b1']);
  assert.deepEqual(M.groups.map((g) => [g.label, g.kids.map((k) => k.id)]), [
    ['A 묶음', ['a1']],
    ['B 묶음', ['b1']],
  ]);
});

test('buildFlow: 하위 단계는 부모의 묶음 칸에 원래 순서로, 칸 이름은 "<부모> 묶음"', () => {
  const M = buildFlow(block(stages), status);
  const m4 = M.stops[3]!;
  assert.deepEqual(M.groups, [m4]);
  assert.equal(m4.label, 'M4 묶음');
  assert.deepEqual(m4.kids.map((k) => [k.id, k.level, k.parent]), [
    ['B0', 1, 'M4'],
    ['B1', 1, 'M4'],
    ['B2', 1, 'M4'],
    ['B3', 1, 'M4'],
  ]);
  assert.equal(M.stops[0]!.label, undefined);
  assert.deepEqual(m4.node.progress, { done: 2, total: 4, from: 'children' });
});

test('buildFlow: 파이프라인 선은 이웃 최상위 단계 사이에만, 상태는 들어가는 단계로', () => {
  const M = buildFlow(block(stages), status);
  assert.deepEqual(
    M.stops.map((r) => r.rail && [r.rail.id, r.rail.state]),
    [['rail:M0>M1', 'done'], ['rail:M1>M2', 'doing'], ['rail:M2>M4', 'doing'], undefined],
  );
});

test('buildFlow: after는 선이 아니라 칸의 표지 — 끝났으면 done, 아니면 blocking, 뒤 단계도 안다', () => {
  const M = buildFlow(block(stages), status);
  const b3 = M.nodes.find((n) => n.id === 'B3')!;
  assert.deepEqual(b3.deps, [{ id: 'B1', short: 'B1', state: 'done' }]);
  assert.deepEqual(M.nodes.find((n) => n.id === 'B1')!.dependents, ['B3']);
  const blocked = buildFlow(block(stages), { ...status, B1: sv('blue') });
  assert.equal(blocked.nodes.find((n) => n.id === 'B3')!.deps[0]!.state, 'blocking');
  // 끊긴 id와 자기 자신은 표지로 만들지 않는다
  const odd = buildFlow(block([{ id: 'A', title: 'a', after: ['A', 'Z'] }]), {});
  assert.deepEqual(odd.nodes[0]!.deps, []);
});

test('relatedTo: 부모·하위 단계·after 앞뒤·파이프라인 이웃', () => {
  const M = buildFlow(block(stages), status);
  const b3 = relatedTo(M, 'B3');
  assert.deepEqual([...b3.nodes].sort(), ['B1', 'B3', 'M4']);
  assert.equal(b3.rails.size, 0);
  const b1 = relatedTo(M, 'B1');
  assert.deepEqual([...b1.nodes].sort(), ['B1', 'B3', 'M4']);
  const m4 = relatedTo(M, 'M4');
  assert.deepEqual([...m4.nodes].sort(), ['B0', 'B1', 'B2', 'B3', 'M2', 'M4']);
  assert.deepEqual([...m4.rails], ['rail:M2>M4']);
  assert.deepEqual([...relatedTo(M, 'nope').nodes], ['nope']);
});

test('centerScroll: 넘치지 않으면 0, 넘치면 지금 칸을 가운데에 두되 양 끝을 넘지 않는다', () => {
  assert.equal(centerScroll(500, 120, 800, 800), 0);
  assert.equal(centerScroll(500, 120, 800, 700), 0);
  // 칸 가운데 560 - 보이는 폭 절반 200 = 360
  assert.equal(centerScroll(500, 120, 400, 1000), 360);
  // 왼쪽 끝 칸은 0에서 멈춘다
  assert.equal(centerScroll(16, 120, 400, 1000), 0);
  // 오른쪽 끝 칸은 최대치(1000 - 400)에서 멈춘다
  assert.equal(centerScroll(860, 120, 400, 1000), 600);
});

test('describeNode: 이름 · 상태 · 진행 · 지금 · 먼저', () => {
  const M = buildFlow(block(stages), status);
  assert.equal(describeNode(M.nodes.find((n) => n.id === 'M2')!, '진행 중'), 'M2 설계 · 진행 중 · 항목 1/2 · 지금 단계');
  assert.equal(describeNode(M.nodes.find((n) => n.id === 'M4')!, '진행 중'), 'M4 실행 · 진행 중 · 하위 단계 2/4');
  assert.equal(describeNode(M.nodes.find((n) => n.id === 'B3')!, '미착수'), 'B3 통합 · 미착수 · 먼저: B1(끝남)');
});

test('subtitle·plain', () => {
  assert.equal(subtitle({ id: 'a', title: 'M2 설계', short: 'M2' }), '설계');
  assert.equal(subtitle({ id: 'a', title: 'B2 의존성 — 제거', short: 'B2' }), '의존성 — 제거');
  assert.equal(subtitle({ id: 'a', title: '배포 최적화', short: '배포' }), '최적화');
  assert.equal(subtitle({ id: 'a', title: 'Lambda 배포', short: '배포' }), 'Lambda 배포');
  assert.equal(subtitle({ id: 'a', title: '제목만' }), '');
  assert.equal(subtitle({ id: 'a', title: 'B1 패키징 — `exports`·**싱글턴**', short: 'B1' }), '패키징 — exports·싱글턴');
  assert.equal(plain('a `b` **c** d'), 'a b c d');
});
