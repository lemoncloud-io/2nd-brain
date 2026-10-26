// 다시 받은 지도를 화면에 있던 지도와 합친다(순수). 3D 라이브러리는 노드 객체에 좌표·속도를 쓰고
// 물체를 객체 참조로 묶으므로, 같은 경로의 노드는 옛 객체를 그대로 쓴다.
import type { GraphLink, GraphNode, GraphResponse } from '../app/types.ts';

export type Positioned = GraphNode & { x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number };
export type MergeResult = { nodes: Positioned[]; links: GraphLink[]; changed: boolean; reheat: boolean };

/** 새 노드를 이웃 좌표에서 이만큼 안쪽으로 흩어 놓는다. */
const JITTER = 5;

// 라이브러리가 간선의 source·target 을 노드 객체로 바꿔 둔다. 어느 쪽이든 경로를 읽는다.
const endPath = (end: unknown): string =>
  typeof end === 'object' && end !== null && 'path' in end ? String((end as { path: unknown }).path) : String(end);
const linkKey = (l: GraphLink): string => `${endPath(l.source)}\0${endPath(l.target)}`;
const nodeSetKey = (nodes: readonly { path: string }[]): string => nodes.map((n) => n.path).sort().join('\n');
const linkSetKey = (links: readonly GraphLink[]): string => links.map(linkKey).sort().join('\n');
const jitter = (): number => (Math.random() * 2 - 1) * JITTER;

export function mergeGraph(prev: { nodes: Positioned[]; links: GraphLink[] } | null, next: GraphResponse): MergeResult {
  const links: GraphLink[] = next.links.map((l) => ({
    source: endPath(l.source),
    target: endPath(l.target),
    weight: l.weight,
    mutual: l.mutual,
  }));
  if (prev === null) return { nodes: next.nodes.map((n) => ({ ...n })), links, changed: true, reheat: true };

  const old = new Map(prev.nodes.map((n) => [n.path, n]));
  // 간선 순서대로 이웃을 모은다. "첫 이웃"은 응답 간선 순서를 따른다.
  const neighbors = new Map<string, string[]>();
  const addNeighbor = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list === undefined) neighbors.set(a, [b]);
    else list.push(b);
  };
  for (const l of links) {
    addNeighbor(l.source, l.target);
    addNeighbor(l.target, l.source);
  }

  const nodes = next.nodes.map((n): Positioned => {
    const o = old.get(n.path);
    if (o !== undefined) {
      // 좌표(x·y·z·fx·fy·fz)와 라이브러리 속성은 두고 문서 속성만 덮어쓴다.
      o.title = n.title;
      o.kind = n.kind;
      o.cluster = n.cluster;
      if (n.embedCluster === undefined) delete o.embedCluster;
      else o.embedCluster = n.embedCluster;
      o.hop = n.hop;
      o.in = n.in;
      o.out = n.out;
      o.hub = n.hub;
      o.truncated = n.truncated;
      return o;
    }
    const anchor = (neighbors.get(n.path) ?? []).map((p) => old.get(p)).find((p) => p !== undefined && p.x !== undefined);
    if (anchor === undefined) return { ...n };
    return { ...n, x: (anchor.x ?? 0) + jitter(), y: (anchor.y ?? 0) + jitter(), z: (anchor.z ?? 0) + jitter() };
  });

  const reheat = nodeSetKey(prev.nodes) !== nodeSetKey(nodes) || linkSetKey(prev.links) !== linkSetKey(links);
  const oldWeight = new Map(prev.links.map((l) => [linkKey(l), l.weight]));
  const changed = reheat || links.some((l) => oldWeight.get(linkKey(l)) !== l.weight);
  return { nodes, links, changed, reheat };
}
