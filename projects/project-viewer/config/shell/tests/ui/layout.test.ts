import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { layoutGraph, sampleEdge } from '../../src/blocks/layout.ts';
import type { LaidNode } from '../../src/blocks/layout.ts';
import type { Bundle, GraphBlock } from '../../model/types.ts';

function block(partial: Partial<GraphBlock>): GraphBlock {
  return { type: 'graph', nodes: [], ...partial } as GraphBlock;
}

const sample = block({
  groups: [
    { id: 'g.in', label: '입력' },
    { id: 'g.mid', label: '가운데' },
    { id: 'g.out', label: '출력' },
  ],
  nodes: [
    { id: 'n1', label: '중간 파일', group: 'g.in' },
    { id: 'n2', label: '원본 문서', group: 'g.in' },
    { id: 'n3', label: '검사기', group: 'g.mid' },
    { id: 'n4', label: '수집기', group: 'g.mid' },
    { id: 'n5', label: '묶음', group: 'g.mid' },
    { id: 'n6', label: '단일 HTML', group: 'g.out' },
    { id: 'n7', label: '바깥 노드' },
  ],
  edges: [
    { from: 'n1', to: 'n3' },
    { from: 'n3', to: 'n5', label: '통과', style: 'dashed' },
    { from: 'n5', to: 'n6', both: true },
  ],
});

function overlaps(a: LaidNode, b: LaidNode): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test('어떤 두 노드도 겹치지 않는다', () => {
  for (const width of [1000, 640, 420, 260]) {
    const out = layoutGraph(sample, { width });
    for (let i = 0; i < out.nodes.length; i += 1) {
      for (let j = i + 1; j < out.nodes.length; j += 1) {
        assert.equal(
          overlaps(out.nodes[i]!, out.nodes[j]!),
          false,
          `폭 ${width}에서 ${out.nodes[i]!.id}와 ${out.nodes[j]!.id}가 겹친다`,
        );
      }
    }
  }
});

test('밴드는 groups 순서를 지키고 위에서 아래로 쌓인다', () => {
  const out = layoutGraph(sample, { width: 900 });
  assert.deepEqual(out.bands.map((b) => b.id), ['g.in', 'g.mid', 'g.out']);
  for (let i = 1; i < out.bands.length; i += 1) {
    assert.equal(
      out.bands[i]!.y >= out.bands[i - 1]!.y + out.bands[i - 1]!.h,
      true,
      '밴드가 세로로 겹친다',
    );
  }
});

test('노드는 자기 밴드 상자 안에 들어간다', () => {
  const out = layoutGraph(sample, { width: 900 });
  for (const node of out.nodes) {
    if (!node.group) continue;
    const band = out.bands.find((b) => b.id === node.group);
    assert.ok(band, `밴드를 찾지 못했다: ${node.group}`);
    assert.equal(node.x >= band.x, true, `${node.id}가 밴드 왼쪽으로 벗어났다`);
    assert.equal(node.x + node.w <= band.x + band.w + 0.001, true, `${node.id}가 밴드 오른쪽으로 벗어났다`);
    assert.equal(node.y >= band.y, true, `${node.id}가 밴드 위로 벗어났다`);
    assert.equal(node.y + node.h <= band.y + band.h + 0.001, true, `${node.id}가 밴드 아래로 벗어났다`);
  }
});

test('폭이 좁으면 같은 밴드 안에서 줄바꿈한다', () => {
  const wide = layoutGraph(sample, { width: 1000 });
  const narrow = layoutGraph(sample, { width: 240 });
  const rowsOf = (out: ReturnType<typeof layoutGraph>, group: string) =>
    new Set(out.nodes.filter((n) => n.group === group).map((n) => n.y)).size;
  assert.equal(rowsOf(wide, 'g.mid'), 1, '넓을 때는 한 줄이어야 한다');
  assert.equal(rowsOf(narrow, 'g.mid') > 1, true, '좁을 때 줄바꿈하지 않았다');
  assert.equal(narrow.height > wide.height, true, '줄바꿈했는데 전체 높이가 늘지 않았다');
});

test('그룹 없는 노드는 밴드 밖 맨 아래에 놓인다', () => {
  const out = layoutGraph(sample, { width: 900 });
  const loose = out.nodes.find((n) => n.id === 'n7');
  assert.ok(loose);
  assert.equal(loose.group, null);
  const lastBand = out.bands[out.bands.length - 1]!;
  assert.equal(loose.y >= lastBand.y + lastBand.h, true, '그룹 없는 노드가 밴드보다 위에 있다');
  for (const band of out.bands) {
    assert.equal(
      loose.y < band.y + band.h && band.y < loose.y + loose.h,
      false,
      '그룹 없는 노드가 밴드와 세로로 겹친다',
    );
  }
});

test('노드가 0개여도 좌표 계산이 터지지 않는다', () => {
  const out = layoutGraph(block({ nodes: [] }), { width: 600 });
  assert.deepEqual(out.nodes, []);
  assert.deepEqual(out.bands, []);
  assert.deepEqual(out.edges, []);
  assert.equal(out.width > 0, true);
  assert.equal(out.height > 0, true);
});

test('같은 입력이면 같은 좌표가 나온다(순수 함수)', () => {
  const a = layoutGraph(sample, { width: 700 });
  const b = layoutGraph(sample, { width: 700 });
  assert.deepEqual(a, b);
});

test('엣지는 노드 가장자리에서 시작해 가장자리에서 끝난다', () => {
  const out = layoutGraph(sample, { width: 900 });
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  assert.equal(out.edges.length, 3);
  for (const edge of out.edges) {
    const from = byId.get(edge.from)!;
    const to = byId.get(edge.to)!;
    const inside = (n: LaidNode, x: number, y: number) =>
      x > n.x + 0.001 && x < n.x + n.w - 0.001 && y > n.y + 0.001 && y < n.y + n.h - 0.001;
    assert.equal(inside(from, edge.x1, edge.y1), false, `${edge.from} 안쪽에서 선이 시작한다`);
    assert.equal(inside(to, edge.x2, edge.y2), false, `${edge.to} 안쪽에서 선이 끝난다`);
  }
  const dashed = out.edges.find((e) => e.from === 'n3');
  assert.equal(dashed?.style, 'dashed');
  assert.equal(dashed?.label, '통과');
  assert.equal(out.edges.find((e) => e.from === 'n5')?.both, true);
});

test('끊긴 엣지는 그리지 않는다(검사기가 먼저 막지만 화면이 죽지 않아야 한다)', () => {
  const out = layoutGraph(
    block({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] }),
    { width: 600 },
  );
  assert.deepEqual(out.edges, []);
});

// ── 수정 라운드 1: 그래프 가독성 ──────────────────────────────────────────────
// 라벨이 노드에 가리거나 엣지가 남의 상자를 관통하면 그림이 거짓말을 한다.

const denseGraph = block({
  groups: [
    { id: 'g.a', label: '앞단' },
    { id: 'g.b', label: '가운데' },
    { id: 'g.c', label: '뒷단' },
  ],
  nodes: [
    { id: 'a1', label: '입력 수집기', group: 'g.a' },
    { id: 'a2', label: '형식 검사', group: 'g.a' },
    { id: 'a3', label: '중복 제거', group: 'g.a' },
    { id: 'a4', label: '분배기', group: 'g.a' },
    { id: 'b1', label: '규칙 엔진', group: 'g.b' },
    { id: 'b2', label: '점수 계산', group: 'g.b' },
    { id: 'b3', label: '외부 조회', group: 'g.b' },
    { id: 'b4', label: '재시도 큐', group: 'g.b' },
    { id: 'b5', label: '집계기', group: 'g.b' },
    { id: 'c1', label: '저장소', group: 'g.c' },
    { id: 'c2', label: '보고서', group: 'g.c' },
    { id: 'x1', label: '지표 수집' },
  ],
  edges: [
    { from: 'a1', to: 'a2', label: '요청' },
    { from: 'a2', to: 'a3' },
    { from: 'a1', to: 'a4', label: '우회' },
    { from: 'a1', to: 'b1' },
    { from: 'a2', to: 'b3', label: '조회' },
    { from: 'a4', to: 'b5' },
    { from: 'b1', to: 'b2', label: '검사' },
    { from: 'b1', to: 'b5' },
    { from: 'b2', to: 'c1' },
    { from: 'b5', to: 'c2', label: '적재' },
    { from: 'c1', to: 'c2' },
    { from: 'c2', to: 'a1', label: '되돌림' },
    { from: 'a1', to: 'c2', style: 'dashed' },
    { from: 'x1', to: 'b3', style: 'dashed', both: true },
  ],
});

const sampleBundlePath = fileURLToPath(new URL('../fixtures/sample-bundle.json', import.meta.url));
const sampleBundle = JSON.parse(readFileSync(sampleBundlePath, 'utf8')) as Bundle;
const sampleGraph = sampleBundle.viewer.pages
  .flatMap((p) => p.blocks)
  .find((b): b is GraphBlock => b.type === 'graph')!;

const CASES: [string, GraphBlock][] = [
  ['sample-bundle', sampleGraph],
  ['빽빽한 입력(노드 12 · 엣지 14)', denseGraph],
];
const WIDTHS = [1440, 800];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function inside(rect: Rect, p: { x: number; y: number }): boolean {
  const m = 0.5;
  return p.x > rect.x + m && p.x < rect.x + rect.w - m && p.y > rect.y + m && p.y < rect.y + rect.h - m;
}

test('엣지 라벨 상자는 어떤 노드 상자와도 겹치지 않는다', () => {
  for (const [name, graph] of CASES) {
    for (const width of WIDTHS) {
      const out = layoutGraph(graph, { width });
      const labelled = out.edges.filter((e) => e.label !== undefined);
      assert.equal(labelled.length > 0, true, `${name}: 라벨 달린 엣지가 없어 검사가 무의미하다`);
      for (const edge of labelled) {
        const box = edge.labelBox;
        assert.ok(box, `${name} ${width}px: ${edge.from}→${edge.to} 라벨 상자가 없다`);
        for (const node of out.nodes) {
          assert.equal(
            rectsOverlap(box, node),
            false,
            `${name} ${width}px: 라벨 "${edge.label}"이 노드 ${node.id}에 가린다`,
          );
        }
      }
    }
  }
});

test('엣지 경로는 출발·도착이 아닌 노드를 관통하지 않는다', () => {
  for (const [name, graph] of CASES) {
    for (const width of WIDTHS) {
      const out = layoutGraph(graph, { width });
      for (const edge of out.edges) {
        const samples = sampleEdge(edge, 20);
        assert.equal(samples.length, 21, '20등분이면 표본은 21개다');
        for (const node of out.nodes) {
          if (node.id === edge.from || node.id === edge.to) continue;
          for (const point of samples) {
            assert.equal(
              inside(node, point),
              false,
              `${name} ${width}px: ${edge.from}→${edge.to} 선이 노드 ${node.id}를 지난다`,
            );
          }
        }
      }
    }
  }
});

test('같은 두 노드 사이의 정·역방향 엣지는 서로 다른 경로로 그려진다', () => {
  for (const width of WIDTHS) {
    const out = layoutGraph(denseGraph, { width });
    const forward = out.edges.find((e) => e.from === 'c2' && e.to === 'a1');
    const backward = out.edges.find((e) => e.from === 'a1' && e.to === 'c2');
    assert.ok(forward, '정방향 엣지가 없다');
    assert.ok(backward, '역방향 엣지가 없다');
    const f = sampleEdge(forward, 20);
    const b = sampleEdge(backward, 20);
    // 방향이 반대이므로 뒤집어 비교한다. 뒤집어도 같으면 완전히 겹쳐 그려진 것이다.
    const same = f.every((p, i) => {
      const q = b[b.length - 1 - i]!;
      return Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;
    });
    assert.equal(same, false, `${width}px: 정·역방향 엣지가 같은 자리에 겹쳐 있다`);
  }
});

test('밴드 안에서 노드 줄은 가운데 정렬된다', () => {
  const out = layoutGraph(denseGraph, { width: 1440 });
  for (const band of out.bands) {
    const rows = new Map<number, LaidNode[]>();
    for (const node of out.nodes.filter((n) => n.group === band.id)) {
      const list = rows.get(node.y) ?? [];
      list.push(node);
      rows.set(node.y, list);
    }
    for (const [y, list] of rows) {
      const left = Math.min(...list.map((n) => n.x));
      const right = Math.max(...list.map((n) => n.x + n.w));
      const leftGap = left - band.x;
      const rightGap = band.x + band.w - right;
      assert.equal(
        Math.abs(leftGap - rightGap) <= 2,
        true,
        `${band.id} y=${y} 줄이 한쪽으로 몰려 있다 (왼쪽 ${leftGap}, 오른쪽 ${rightGap})`,
      );
    }
  }
});
