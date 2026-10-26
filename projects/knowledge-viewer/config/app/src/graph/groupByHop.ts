// 지도 응답을 홉별로 묶는다(순수). 에이전트 모드의 텍스트 목록이 쓴다.
import type { GraphNode, GraphResponse } from '../app/types.ts';

export type HopGroup = { hop: number; nodes: GraphNode[] };

/** 경로의 코드 단위 순. 로캘에 따라 달라지지 않는다. */
const byPath = (a: GraphNode, b: GraphNode): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** 홉 안 순서: 연결이 많은 노드가 먼저, 같으면 경로 순. */
const byDegree = (a: GraphNode, b: GraphNode): number => b.in + b.out - (a.in + a.out) || byPath(a, b);

/**
 * 중심 노드와 홉별 묶음을 돌려준다. 홉은 오름차순이다.
 * 전체 보기(`center === null`)는 모든 홉이 -1 이므로 중심 없이 한 묶음이 된다.
 */
export function groupByHop(res: GraphResponse): { center: GraphNode | null; hops: HopGroup[] } {
  const center = res.center === null ? null : (res.nodes.find((n) => n.path === res.center) ?? null);
  const byHop = new Map<number, GraphNode[]>();
  for (const n of res.nodes) {
    if (center !== null && n.path === center.path) continue;
    const list = byHop.get(n.hop);
    if (list === undefined) byHop.set(n.hop, [n]);
    else list.push(n);
  }
  const hops = [...byHop.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hop, nodes]) => ({ hop, nodes: nodes.sort(byDegree) }));
  return { center, hops };
}

/** 중심과 `path` 사이 간선의 가중치. 어느 방향이든 좋고, 없거나 중심이 없으면 0. */
export function weightTo(res: GraphResponse, path: string): number {
  if (res.center === null) return 0;
  for (const l of res.links) {
    if ((l.source === res.center && l.target === path) || (l.source === path && l.target === res.center)) return l.weight;
  }
  return 0;
}
