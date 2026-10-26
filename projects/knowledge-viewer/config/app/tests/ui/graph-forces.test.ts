import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARGE_DISTANCE_MAX_PER_R,
  MASS_REF,
  applyCharge,
  applyCluster,
  applyClusterMode,
  clusterKeyOf,
  embedKey,
  applyIsolatedOrbit,
  centroids,
  clusterForce,
  isolatedRadius,
  massOf,
  readCharge,
} from '../../src/graph/forces.ts';

type N = { cluster: string; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number };

test('centroids: 클러스터별 평균 좌표와 개수를 낸다', () => {
  const c = centroids([
    { cluster: 'a', x: 0, y: 0, z: 0 },
    { cluster: 'a', x: 2, y: 2, z: 2 },
    { cluster: 'b', x: 9, y: 9, z: 9 },
  ]);
  assert.deepEqual(c.get('a'), { x: 1, y: 1, z: 1, n: 2 });
  assert.deepEqual(c.get('b'), { x: 9, y: 9, z: 9, n: 1 });
});

test('centroids: 좌표 없는 노드는 센서스에서 뺀다', () => {
  const c = centroids([{ cluster: 'a', x: 4, y: 4, z: 4 }, { cluster: 'a' }, { cluster: 'c' }]);
  assert.deepEqual(c.get('a'), { x: 4, y: 4, z: 4, n: 1 });
  assert.equal(c.has('c'), false);
});

test('centroids: z 가 없으면 0 으로 센다', () => {
  const c = centroids([{ cluster: 'a', x: 0, y: 0 }, { cluster: 'a', x: 2, y: 4 }]);
  assert.deepEqual(c.get('a'), { x: 1, y: 2, z: 0, n: 2 });
});

test('clusterForce: 같은 클러스터 노드를 무게중심으로 끈다', () => {
  const nodes: N[] = [
    { cluster: 'a', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { cluster: 'a', x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  ];
  const f = clusterForce();
  f.initialize(nodes);
  f(1);
  assert.equal(nodes[0]!.vx, 0.75);
  assert.equal(nodes[1]!.vx, -0.75);
  assert.equal(nodes[0]!.vy, 0);
  assert.equal(nodes[0]!.vz, 0);
});

test('clusterForce: alpha 에 비례하고 매 tick 무게중심을 다시 센다', () => {
  const nodes: N[] = [
    { cluster: 'a', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { cluster: 'a', x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  ];
  const f = clusterForce();
  f.initialize(nodes);
  f(0.5);
  assert.equal(nodes[0]!.vx, 0.375);
  nodes[1]!.x = 20; // 좌표가 바뀌면 다음 호출은 새 무게중심(10)을 쓴다.
  nodes[0]!.vx = 0;
  f(1);
  assert.equal(nodes[0]!.vx, 1.5);
});

test('clusterForce: 혼자인 클러스터·좌표 없는 노드는 속도를 건드리지 않는다', () => {
  const nodes: N[] = [
    { cluster: 'solo', x: 3, y: 3, z: 3, vx: 0, vy: 0, vz: 0 },
    { cluster: 'solo2' },
  ];
  const f = clusterForce();
  f.initialize(nodes);
  f(1);
  assert.equal(nodes[0]!.vx, 0);
  assert.equal('vx' in nodes[1]!, false);
});

test('clusterForce: 2D 노드(z·vz 없음)에 z·vz 를 만들지 않는다', () => {
  const nodes: N[] = [
    { cluster: 'a', x: 0, y: 0, vx: 0, vy: 0 },
    { cluster: 'a', x: 10, y: 10, vx: 0, vy: 0 },
  ];
  const f = clusterForce();
  f.initialize(nodes);
  f(1);
  assert.equal(nodes[0]!.vx, 0.75);
  assert.equal(nodes[0]!.vy, 0.75);
  assert.equal('z' in nodes[0]!, false);
  assert.equal('vz' in nodes[0]!, false);
});

test('applyCluster: cluster 이름으로 힘을 건다', () => {
  const calls: [string, unknown][] = [];
  applyCluster({ d3Force: (name: string, force?: unknown) => (calls.push([name, force]), undefined) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], 'cluster');
  assert.equal(typeof calls[0]![1], 'function');
});

test('isolatedRadius: 연결이 없는 노드만 3R 궤도, 나머지는 null', () => {
  assert.equal(isolatedRadius({ in: 0, out: 0 }, 100), 300);
  assert.equal(isolatedRadius({ in: 1, out: 0 }, 100), null);
  assert.equal(isolatedRadius({ in: 0, out: 2 }, 100), null);
});

test('applyIsolatedOrbit: orbit 이름으로 힘을 걸고 연결된 노드는 세기 0 이다', () => {
  const calls: [string, unknown][] = [];
  applyIsolatedOrbit({ d3Force: (name: string, force?: unknown) => (calls.push([name, force]), undefined) }, 100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], 'orbit');
  const f = calls[0]![1] as { radius(): (n: object) => number; strength(): (n: object) => number };
  assert.equal(f.radius()({ in: 0, out: 0 }), 300);
  assert.equal(f.strength()({ in: 0, out: 0 }), 0.9);
  assert.equal(f.radius()({ in: 2, out: 1 }), 0);
  assert.equal(f.strength()({ in: 2, out: 1 }), 0);
});

/** forceManyBody 꼴 가짜 호스트. strength() 는 접근자를 돌려주고 strength(값) 은 값을 상수로 바꾼다. */
function fakeChargeHost(initial: number) {
  let fn: (n: object, i: number, nodes: object[]) => number = () => initial;
  const charge = {
    strength(next?: number | typeof fn) {
      if (next === undefined) return fn;
      fn = typeof next === 'function' ? next : () => next;
      return charge;
    },
  };
  const host = { d3Force: (name: string) => (name === 'charge' ? charge : undefined) };
  // 중앙값 연결 수(6)의 노드로 읽는다 — 질량 배수가 1 이라 base 가 그대로 나온다.
  return { host, now: () => fn({ in: 3, out: 3 }, 0, []) };
}

test('readCharge·applyCharge: 500 이하는 처음 값, 초과는 절반, 줄면 처음 값으로 되돌린다', () => {
  for (const initial of [-60, -30, -120]) {
    const { host, now } = fakeChargeHost(initial);
    const base = readCharge(host);
    assert.equal(base!({}, 0, []), initial);
    applyCharge(host, 500, base);
    assert.equal(now(), initial);
    applyCharge(host, 501, base);
    assert.equal(now(), initial / 2);
    applyCharge(host, 120, base);
    assert.equal(now(), initial);
  }
});

test('readCharge·applyCharge: 반발 힘이 없으면 아무것도 하지 않는다', () => {
  const host = { d3Force: () => undefined };
  assert.equal(readCharge(host), null);
  applyCharge(host, 900, null);
});

test('massOf: 연결 수의 로그 — 0 은 1, 중앙값 6 은 약 2.9, INDEX 270 은 약 6.6', () => {
  assert.equal(massOf(0), 1);
  assert.ok(Math.abs(massOf(6) - 2.946) < 0.01);
  assert.ok(Math.abs(massOf(270) - 6.602) < 0.01);
  assert.equal(massOf(-5), 1, '음수는 0 으로');
  assert.equal(MASS_REF, massOf(6));
});

test('applyCharge: 세기 = base × 질량 / 중앙값 질량, 500 초과면 절반, R 을 주면 distanceMax 2.5R', () => {
  let strength: ((n: object, i: number, nodes: object[]) => number) | null = null;
  let distanceMax: number | null = null;
  const charge = {
    strength(fn?: unknown) {
      if (fn === undefined) return strength;
      strength = fn as typeof strength;
      return charge;
    },
    distanceMax(d: number) {
      distanceMax = d;
      return charge;
    },
  };
  const fg = { d3Force: (name: string) => (name === 'charge' ? charge : undefined) };
  const base = () => -30;
  applyCharge(fg, 10, base, 100);
  const at = (deg: number) => strength!({ in: deg, out: 0 }, 0, []);
  assert.ok(Math.abs(at(6) - -30) < 1e-9, '중앙값 연결 수는 base 그대로');
  assert.ok(at(0) > -30 && at(0) < 0, '고립 노드는 약하게');
  assert.ok(at(270) < -60, '허브는 세게');
  assert.equal(distanceMax, CHARGE_DISTANCE_MAX_PER_R * 100);
  applyCharge(fg, 501, base);
  assert.ok(Math.abs(at(6) - -15) < 1e-9, '노드가 많으면 절반');
});

test('clusterForce: keyOf 로 묶음 기준을 바꾼다 — 커뮤니티 맵', () => {
  const community = new Map([
    ['a', 'g1'],
    ['b', 'g1'],
    ['c', 'g2'],
  ]);
  const nodes: (N & { path: string })[] = [
    { path: 'a', cluster: 'k', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { path: 'b', cluster: 'k', x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    { path: 'c', cluster: 'k', x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  ];
  const f = clusterForce(1, (n) => community.get((n as { path: string }).path) ?? 'none');
  f.initialize(nodes);
  f(1);
  assert.ok(nodes[0]!.vx! > 0 && nodes[1]!.vx! < 0, 'a·b 는 서로 당긴다');
  assert.equal(nodes[2]!.vx, 0, 'c 는 혼자라 안 움직인다(메타 cluster 가 같아도)');
});

test('applyClusterMode: none 은 힘을 걷고, meta·community 는 cluster 이름으로 건다', () => {
  const calls: [string, unknown][] = [];
  const fg = { d3Force: (name: string, force?: unknown) => void calls.push([name, force]) };
  applyClusterMode(fg, 'none', null);
  assert.deepEqual(calls[0], ['cluster', null]);
  applyClusterMode(fg, 'meta', null);
  assert.equal(calls[1]![0], 'cluster');
  assert.equal(typeof calls[1]![1], 'function');
  applyClusterMode(fg, 'community', new Map([['a', 'g']]));
  assert.equal(typeof calls[2]![1], 'function');
});

test('임베딩 묶음: embedCluster 로 모으고, 군집이 없는 노드는 자기 경로(혼자라 당기지 않는다)', () => {
  assert.equal(embedKey({ path: 'a.md', cluster: 'concept:wiki', embedCluster: '#2 · A' }), '#2 · A');
  assert.equal(embedKey({ path: 'n.md', cluster: 'concept:wiki' }), 'n.md');
  assert.equal(clusterKeyOf('embedding', null), embedKey);
  assert.equal(clusterKeyOf('meta', null)({ path: 'a.md', cluster: 'k', embedCluster: '#1 · X' }), 'k');
  const calls: [string, unknown][] = [];
  applyClusterMode({ d3Force: (name: string, force?: unknown) => void calls.push([name, force]) }, 'embedding', null);
  assert.equal(calls[0]![0], 'cluster');
  assert.equal(typeof calls[0]![1], 'function');
});
