// /api/graph 의 계산부. 중심에서 BFS 로 이웃을 펼치고, 허브 규칙과 간선 두 겹을 적용해 응답을 만든다.
// 순수 계산이다 — 색인(VaultIndex)만 읽고 디스크는 만지지 않는다.
import type { Kind } from '../shared/kind.ts';
import { EXCLUDED_DIRS } from '../shared/scope.ts';
import type { VaultIndex } from './index-store.ts';

/**
 * 지도에 넣을 문서인가 — lint 범위 밖 폴더(node_modules·.git·dist …)는 노드가 아니다. 색인이 이미 거르지만 지도 층에서 한 번 더 막는다
 * (사용자 요구 2026-10-23: 그래프에 node_modules 안의 것이 들어가면 안 된다). 캐시된 색인·링크 대상 경로가 섞여 들어와도 걸린다.
 */
export function inGraphScope(p: string): boolean {
  return !p.split('/').some((s) => EXCLUDED_DIRS.has(s));
}

export type GraphNode = {
  path: string;
  title: string;
  kind: Kind;
  cluster: string;
  /** 임베딩 군집 이름(`#3 · 제목`). 질의에 embed 가 있고 군집이 준비됐을 때만 싣는다(server/embeddings.ts). */
  embedCluster?: string;
  /** 중심에서 처음 닿은 홉. 전체 보기에서는 -1 이다. */
  hop: number;
  /** 전체 그래프 기준 연결 수(방향 있는 문서 쌍 단위). 화면에 보이는 수가 아니다. */
  in: number;
  out: number;
  hub: boolean;
  /** 이 노드 너머에 응답 밖 이웃이 있다(펼치지 않았다). */
  truncated: boolean;
};

export type GraphLink = { source: string; target: string; weight: number; mutual: boolean };

export type GraphResponse = {
  center: string | null;
  depth: number;
  hubThreshold: number;
  version: number;
  nodes: GraphNode[];
  links: GraphLink[];
};

export type GraphQuery = { center: string; depth: 1 | 2 | 3; hubs: 'keep' | 'expand'; expand: string[] } | { all: true };

/** 중심이 색인에 없을 때 던진다. 핸들러가 404 로 바꾼다. */
export class GraphError extends Error {}

/** a→b 링크 수와 b→a 링크 수의 합. */
export function linkCount(index: VaultIndex, a: string, b: string): number {
  const n = (from: string, to: string): number => index.backlinks(to).find((x) => x.path === from)?.count ?? 0;
  return n(a, b) + n(b, a);
}

/** a→b 방향 링크가 하나라도 있는가. */
const hasLink = (index: VaultIndex, a: string, b: string): boolean => index.backlinks(b).some((x) => x.path === a);

/** 들어오는 쪽과 나가는 쪽을 합친 이웃(중복 없음). */
function neighborsOf(index: VaultIndex, p: string): string[] {
  const set = new Set<string>(index.outgoing(p));
  for (const b of index.backlinks(p)) set.add(b.path);
  set.delete(p);
  return [...set];
}

/** embed 는 문서 → 임베딩 군집 이름이다. 주면 그 맵에 있는 노드에 embedCluster 를 싣는다. */
export function buildGraph(index: VaultIndex, q: GraphQuery, hubThreshold: number, embed: ReadonlyMap<string, string> | null = null): GraphResponse {
  const all = 'all' in q;
  const center = all ? null : q.center;
  if (center !== null && (!index.files.has(center) || !inGraphScope(center))) throw new GraphError('없는 문서다');
  const depth = all ? 0 : q.depth;
  const hubs = all ? 'expand' : q.hubs;
  const expand = all ? [] : q.expand;

  const isHub = (p: string): boolean => {
    const d = index.degree(p);
    return d.in + d.out > hubThreshold;
  };

  // 홉(처음 닿은 홉)과 허브에 닿은 부모. 전체 보기는 모든 문서가 노드다.
  const hop = new Map<string, number>();
  const parentOf = new Map<string, string>();
  if (all) {
    for (const p of index.files) if (inGraphScope(p)) hop.set(p, -1);
  } else if (center !== null) {
    hop.set(center, 0);
    let frontier = [center];
    // 프런티어가 빌 때까지 돈다. depth 를 넘은 홉에서는 expand 에 든 노드만 더 펼친다.
    for (let h = 0; frontier.length > 0; h += 1) {
      const next: string[] = [];
      for (const p of frontier) {
        // expand 에 든 노드는 홉과 상관없이 펼친다(마지막 홉이어도 한 홉 더). 아니면 depth 안에서
        // 중심이거나 비허브이거나, 허브라도 펼치라고 했을 때만 펼친다.
        const listed = expand.includes(p);
        if (!(listed || (h < depth && (p === center || !isHub(p) || hubs === 'expand')))) continue;
        for (const n of neighborsOf(index, p)) {
          if (hop.has(n) || !index.files.has(n) || !inGraphScope(n)) continue;
          hop.set(n, h + 1);
          parentOf.set(n, p);
          next.push(n);
        }
      }
      frontier = next;
    }
  }

  // 펼치지 않은 허브. 이 노드들의 간선은 BFS 가 지난 (부모, 허브) 쌍만 둔다.
  const unexpanded = new Set<string>();
  for (const p of hop.keys()) {
    if (!all && p !== center && isHub(p) && hubs !== 'expand' && !expand.includes(p)) unexpanded.add(p);
  }

  const nodes: GraphNode[] = [];
  for (const [p, h] of hop) {
    const d = index.degree(p);
    const ec = embed?.get(p);
    nodes.push({
      path: p,
      title: index.title(p),
      kind: index.kind(p),
      cluster: index.cluster(p),
      ...(ec === undefined ? {} : { embedCluster: ec }),
      hop: h,
      in: d.in,
      out: d.out,
      hub: isHub(p),
      truncated: !all && neighborsOf(index, p).some((n) => index.files.has(n) && !hop.has(n)),
    });
  }

  // 간선: 응답 노드 쌍 중 링크가 있는 것을 한 번씩만 본다.
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const p of hop.keys()) {
    for (const n of neighborsOf(index, p)) {
      if (!hop.has(n)) continue;
      const [a, b] = p < n ? [p, n] : [n, p];
      const key = `${a}\0${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (unexpanded.has(a) || unexpanded.has(b)) {
        const viaBfs = (unexpanded.has(b) && parentOf.get(b) === a) || (unexpanded.has(a) && parentOf.get(a) === b);
        if (!viaBfs) continue;
      }
      const ab = hasLink(index, a, b);
      const ba = hasLink(index, b, a);
      if (!ab && !ba) continue;
      let source: string;
      let target: string;
      if (ab && ba) {
        // 상호 링크는 중심에 가까운 쪽을 source 로 둔다(같으면 경로순).
        const ha = hop.get(a) ?? 0;
        const hb = hop.get(b) ?? 0;
        [source, target] = hb < ha ? [b, a] : [a, b];
      } else {
        [source, target] = ab ? [a, b] : [b, a];
      }
      links.push({ source, target, weight: linkCount(index, a, b), mutual: ab && ba });
    }
  }
  links.sort((x, y) => (x.source < y.source ? -1 : x.source > y.source ? 1 : x.target < y.target ? -1 : x.target > y.target ? 1 : 0));
  nodes.sort((x, y) => x.hop - y.hop || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  return { center, depth: all ? 0 : depth, hubThreshold, version: index.version, nodes, links };
}
