import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyRadial, radiusFor } from '../../src/graph/forces.ts';
import { colorVarOf, withAlpha } from '../../src/graph/palette.ts';
import { opacityOf, radiusOf, widthOf } from '../../src/graph/scale.ts';

const near = (actual: number, expected: number, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('radiusOf: 2 + 1.2√deg 를 [2, 14] 로 자른다', () => {
  near(radiusOf(6), 4.94);
  near(radiusOf(57), 11.06);
  assert.equal(radiusOf(270), 14);
  assert.equal(radiusOf(0), 2);
});

test('widthOf: 0.4·weight 를 [0.4, 3] 으로 자른다', () => {
  assert.equal(widthOf(1), 0.4);
  near(widthOf(3), 1.2);
  assert.equal(widthOf(8), 3);
});

test('opacityOf: 홉별 투명도, 범위 밖은 0.45, 전체 보기(-1)는 0.6', () => {
  assert.equal(opacityOf(0), 1);
  assert.equal(opacityOf(3), 0.45);
  assert.equal(opacityOf(7), 0.45);
  assert.equal(opacityOf(-1), 0.6);
});

test('radiusFor: 80 + 0.15·노드 수 를 [80, 160] 으로 자른다', () => {
  near(radiusFor(47), 87.05);
  assert.equal(radiusFor(2314), 160);
});

test('colorVarOf: 종류별 CSS 변수 이름', () => {
  assert.equal(colorVarOf('idea'), '--graph-idea');
});

test('withAlpha: hex 색에 투명도를 붙인 rgba, hex 가 아니면 그대로', () => {
  assert.equal(withAlpha('#5b9cf0', 0.4), 'rgba(91, 156, 240, 0.4)');
  assert.equal(withAlpha('#888', 0.4), 'rgba(136, 136, 136, 0.4)');
  assert.equal(withAlpha('teal', 0.4), 'teal');
});

test('applyRadial: hop -1(전체 보기) 노드는 힘 0, 속도가 NaN 이 되지 않는다', () => {
  let force: ((alpha: number) => void) & { initialize?: (nodes: unknown[], ...args: unknown[]) => void } = () => {};
  applyRadial(
    {
      d3Force(name: string, f?: unknown) {
        assert.equal(name, 'radial');
        force = f as typeof force;
        return undefined;
      },
    },
    100,
  );
  const nodes = [
    { hop: -1, x: 10, y: 20, z: 30, vx: 0, vy: 0, vz: 0 },
    { hop: 1, x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  ];
  force.initialize?.(nodes, Math.random, 3);
  force(1);
  assert.deepEqual([nodes[0].vx, nodes[0].vy, nodes[0].vz], [0, 0, 0]);
  // hop 1 노드는 원점에서 R(100) 껍질 쪽으로 밀린다.
  assert.ok(Number.isFinite(nodes[1].vx) && nodes[1].vx > 0);
});
