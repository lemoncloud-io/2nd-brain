// 그래프 힘 설정. 순수 모듈이다 — 그래프 객체는 d3Force 하나만 가진 것으로 본다.
import { forceRadial } from 'd3-force-3d';
import type { ManyBodyForce } from 'd3-force-3d';

import type { ClusterMode } from './cluster-mode.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 홉 하나의 껍질 반지름. 노드가 많을수록 넓히되 [80, 160] 으로 자른다. */
export function radiusFor(nodeCount: number): number {
  return clamp(80 + nodeCount * 0.15, 80, 160);
}

/**
 * 홉 n 인 노드를 원점에서 n·R 거리의 껍질로 끄는 방사 힘을 'radial' 이름으로 건다. 중심(hop 0)은 원점이다.
 * 전체 보기의 hop -1 은 껍질이 없다 — 반지름 0·세기 0 으로 둔다. NaN 반지름은 안 된다:
 * 틱의 `k = (반지름 - r) * 세기 * alpha / r` 에서 `NaN * 0` 도 NaN 이라 속도가 NaN 이 된다.
 */
export function applyRadial(fg: { d3Force(name: string, force?: unknown): unknown }, R: number): void {
  fg.d3Force(
    'radial',
    forceRadial<{ hop: number }>((n) => (n.hop < 0 ? 0 : n.hop * R), 0, 0, 0).strength((n) => (n.hop < 0 ? 0 : 0.8)),
  );
}

/** 전체 보기에서 고립 노드(in+out 이 0)가 앉는 바깥 궤도의 반지름. 연결된 노드는 null — 궤도 힘을 받지 않는다. */
export function isolatedRadius(node: { in: number; out: number }, R: number): number | null {
  return node.in + node.out === 0 ? 3 * R : null;
}

/**
 * 고립 노드만 원점에서 3R 거리의 바깥 궤도로 끄는 방사 힘을 'orbit' 이름으로 건다(전체 보기 전용).
 * 연결된 노드는 반지름 0·세기 0 이다 — 반지름이 NaN 이면 안 되는 이유는 applyRadial 과 같다.
 */
export function applyIsolatedOrbit(fg: { d3Force(name: string, force?: unknown): unknown }, R: number): void {
  fg.d3Force(
    'orbit',
    forceRadial<{ in: number; out: number }>((n) => isolatedRadius(n, R) ?? 0, 0, 0, 0).strength((n) =>
      isolatedRadius(n, R) === null ? 0 : 0.9,
    ),
  );
}

type ChargeStrength = (node: object, i: number, nodes: object[]) => number;
type ForceHost = { d3Force(name: string, force?: unknown): unknown };

/**
 * 노드 질량 — 연결 수를 로그로 누른 값(물리 엔진 설계 #933 § 매핑). FA2 의 `deg + 1` 을 그대로 쓰면 INDEX(270)가 중앙값(6)의 40 배라
 * 구가 뭉개진다. 로그는 2~7 범위에 머문다: 0 → 1, 6 → 2.9, 57 → 5.1, 270 → 6.6.
 */
export function massOf(degree: number): number {
  return 1 + Math.log(1 + Math.max(0, degree));
}
/** 중앙값 연결 수(6)의 질량. 반발은 이 값으로 나눠 중앙값 노드가 엔진 기본 세기를 받게 한다. */
export const MASS_REF = massOf(6);
/** 반발이 닿는 최대 거리 — 홉 껍질 반지름의 배수. 멀리 있는 쌍을 끊어 Barnes–Hut 비용을 줄이고 구 바깥으로 튀는 것을 막는다. */
export const CHARGE_DISTANCE_MAX_PER_R = 2.5;

/** 그린 지도가 이 노드 수를 넘으면 반발을 약하게 한다(전체 보기뿐 아니라 깊이 3 중심 지도도 같다). */
export const WEAK_CHARGE_FROM = 500;

/** 엔진이 처음 준 반발 세기 접근자. 약하게 바꾸기 전에 한 번 읽어 두었다가 되돌릴 때 쓴다. */
export function readCharge(fg: ForceHost): ChargeStrength | null {
  const charge = fg.d3Force('charge') as ManyBodyForce<object> | undefined;
  return charge === undefined ? null : charge.strength();
}

type Degreed = { in?: number; out?: number };

/**
 * 반발 = 엔진 처음 값(base) × 질량(연결 수의 로그) / 중앙값 질량. 허브가 이웃을 밀어 자기 자리를 넓힌다(#933 권고 "A + D").
 * 노드가 많으면(WEAK_CHARGE_FROM 초과) 다시 절반. base 가 없으면 건드리지 않는다. R 을 주면 그 2.5 배 밖의 쌍은 끊는다.
 * 엔진마다 처음 값이 다르다 — 3D(three-forcegraph)는 -60, 2D(force-graph, d3 기본)는 -30.
 */
export function applyCharge(fg: ForceHost, nodeCount: number, base: ChargeStrength | null, R?: number): void {
  const charge = fg.d3Force('charge') as ManyBodyForce<object> | undefined;
  if (charge === undefined || base === null) return;
  const weak = nodeCount > WEAK_CHARGE_FROM ? 0.5 : 1;
  charge.strength((n, i, nodes) => {
    const d = n as Degreed;
    return (base(n, i, nodes) * weak * massOf((d.in ?? 0) + (d.out ?? 0))) / MASS_REF;
  });
  if (R !== undefined && typeof charge.distanceMax === 'function') charge.distanceMax(CHARGE_DISTANCE_MAX_PER_R * R);
}

/**
 * 묶음(클러스터 힘)의 기준은 cluster-mode.ts(순수) — 메타 = 서버가 준 cluster 키, 커뮤니티 = community.ts,
 * 임베딩 = 서버가 준 embedCluster(본문 임베딩 k-means), 없음 = 힘을 걷는다.
 */
/** 묶음 모드별 인력. 커뮤니티는 링크로 정의된 묶음이라 더 세게 당겨야 덩어리가 보인다. 임베딩 군집은 링크와 무관해 그 사이다. */
export const CLUSTER_STRENGTH: Record<Exclude<ClusterMode, 'none'>, number> = { meta: 0.15, community: 0.3, embedding: 0.2 };

/** 클러스터 힘이 읽고 쓰는 노드 모양. 2D 라이브러리는 z·vz 를 주지 않는다. */
type ClusterNode = {
  path?: string;
  cluster: string;
  embedCluster?: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};
/** 노드의 묶음 키. 기본은 서버가 준 cluster 다. */
export type ClusterKey = (node: ClusterNode) => string;
export const metaKey: ClusterKey = (n) => n.cluster;
/** 임베딩 군집 이름. 군집이 없는 노드(색인 뒤에 생긴 문서)는 자기 경로 — 혼자라 당기지 않는다. */
export const embedKey: ClusterKey = (n) => n.embedCluster ?? n.path ?? n.cluster;

/** 묶음 모드의 키. 커뮤니티는 community 맵(없는 노드는 자기 경로)이다. 없음은 메타 키를 돌려준다(힘을 걸지 않으므로 이름에만 쓰인다). */
export function clusterKeyOf(mode: ClusterMode, community: ReadonlyMap<string, string> | null): ClusterKey {
  if (mode === 'community') return (n) => community?.get(n.path ?? '') ?? n.path ?? n.cluster;
  if (mode === 'embedding') return embedKey;
  return metaKey;
}

/** 클러스터별 무게중심과 노드 수. 좌표(x·y)가 없는 노드는 세지 않고, z 가 없으면 0 으로 본다. */
export function centroids(nodes: readonly ClusterNode[], keyOf: ClusterKey = metaKey): Map<string, { x: number; y: number; z: number; n: number }> {
  const out = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const key = keyOf(node);
    const c = out.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
    c.x += node.x;
    c.y += node.y;
    c.z += node.z ?? 0;
    c.n += 1;
    out.set(key, c);
  }
  for (const c of out.values()) {
    c.x /= c.n;
    c.y /= c.n;
    c.z /= c.n;
  }
  return out;
}

/**
 * 같은 cluster 노드를 무게중심으로 끄는 d3 꼴 힘. 매 tick 무게중심을 다시 센다(노드 수백이라 충분하다).
 * 혼자인 클러스터는 무게중심이 자기 자신이라 당김이 0 이다 — 건너뛴다.
 * z·vz 가 없는 노드(2D)에는 z 쪽 속도를 만들지 않는다.
 */
export function clusterForce(strength = 0.15, keyOf: ClusterKey = metaKey): ((alpha: number) => void) & { initialize: (nodes: ClusterNode[]) => void } {
  let nodes: ClusterNode[] = [];
  const force = (alpha: number): void => {
    const cs = centroids(nodes, keyOf);
    const k = strength * alpha;
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const c = cs.get(keyOf(node));
      if (c === undefined || c.n < 2) continue;
      node.vx = (node.vx ?? 0) + (c.x - node.x) * k;
      node.vy = (node.vy ?? 0) + (c.y - node.y) * k;
      if (node.z !== undefined) node.vz = (node.vz ?? 0) + (c.z - node.z) * k;
    }
  };
  force.initialize = (next: ClusterNode[]): void => {
    nodes = next;
  };
  return force;
}

/** 클러스터 힘을 'cluster' 이름으로 건다. keyOf 가 묶음 기준이다(기본 메타). */
export function applyCluster(fg: { d3Force(name: string, force?: unknown): unknown }, strength?: number, keyOf?: ClusterKey): void {
  fg.d3Force('cluster', clusterForce(strength, keyOf));
}

/** 묶음 모드대로 힘을 건다: 메타는 cluster 키, 커뮤니티는 community 맵(없는 노드는 자기 경로), 임베딩은 embedCluster, 없음은 힘을 걷는다. */
export function applyClusterMode(
  fg: { d3Force(name: string, force?: unknown): unknown },
  mode: ClusterMode,
  community: ReadonlyMap<string, string> | null,
): void {
  if (mode === 'none') {
    fg.d3Force('cluster', null);
    return;
  }
  applyCluster(fg, CLUSTER_STRENGTH[mode], clusterKeyOf(mode, community));
}
