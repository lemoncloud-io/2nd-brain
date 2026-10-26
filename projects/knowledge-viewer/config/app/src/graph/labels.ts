// 어느 노드의 제목을 보일지(순수). 제목을 전부 그리면 겹쳐서 하나도 읽을 수 없다 — 기본은 "주요 노드만" 이고,
// 나머지는 마우스를 올렸을 때만 보인다. 주요 노드의 기준과 화면에서 겹치는 제목을 걷는 규칙이 여기 있다.
//
// 주요 노드 = (a) 중심 문서 (b) 허브(서버의 허브 규칙으로 이미 접힌 노드) (c) 연결 수(in+out) 상위 N.
// N = max(8, ceil(노드 수 × 4 %)), 상한 40 — 2홉 47 노드면 8, INDEX 2홉 546 노드면 22, 전체 보기 2,324 노드면 40 이다.
// 왜 4 %: 연결 수 상위 4 % 가 볼트의 "상위 1 % 57 · 상위 10 % 19" 사이에 들어 README·INDEX·큰 위키 글이 잡히고 보통 문서는 빠진다.
// 왜 상한 40: 겹침 제거를 거쳐도 한 화면에서 읽히는 제목은 수십 개다. 그 너머는 호버로 본다.
// 호버한 노드와 그 이웃(연결 수 상위 HOVER_NEIGHBORS 개)도 호버하는 동안 후보가 된다.
import type { GraphNode } from '../app/types.ts';

export type LabelMode = 'major' | 'all' | 'none';
export const LABEL_MODES: readonly { mode: LabelMode; label: string }[] = [
  { mode: 'major', label: '주요만' },
  { mode: 'all', label: '전부' },
  { mode: 'none', label: '없음' },
];
export const DEFAULT_LABEL_MODE: LabelMode = 'major';

export function isLabelMode(v: unknown): v is LabelMode {
  return v === 'major' || v === 'all' || v === 'none';
}

export const MAJOR_MIN = 8;
export const MAJOR_RATIO = 0.04;
export const MAJOR_MAX = 40;
/** 호버한 노드의 이웃 가운데 제목 후보로 올리는 수(연결 수 순). */
export const HOVER_NEIGHBORS = 12;

/** 연결 수 상위 몇 개를 주요 노드로 삼는가. */
export function majorLimit(count: number): number {
  return Math.min(MAJOR_MAX, Math.max(MAJOR_MIN, Math.ceil(count * MAJOR_RATIO)));
}

type Degreed = Pick<GraphNode, 'path' | 'in' | 'out' | 'hub'>;
export const degreeOf = (n: Pick<GraphNode, 'in' | 'out'>): number => n.in + n.out;

/** 주요 노드의 경로 집합. 중심('' 이면 없음)·허브·연결 수 상위 N. 동률은 경로 순으로 정해 매번 같은 집합이다. */
export function selectMajor(nodes: readonly Degreed[], center: string): Set<string> {
  const major = new Set<string>();
  if (center !== '') major.add(center);
  for (const n of nodes) if (n.hub) major.add(n.path);
  const top = [...nodes].sort((a, b) => degreeOf(b) - degreeOf(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const n of top.slice(0, majorLimit(nodes.length))) major.add(n.path);
  return major;
}

/** 간선에서 이웃 목록을 만든다. 끝이 노드 객체로 바뀐 간선도 받는다. */
export function adjacencyOf(links: readonly { source: string | { path: string }; target: string | { path: string } }[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const push = (a: string, b: string) => {
    const list = adj.get(a);
    if (list === undefined) adj.set(a, [b]);
    else list.push(b);
  };
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : l.source.path;
    const t = typeof l.target === 'string' ? l.target : l.target.path;
    push(s, t);
    push(t, s);
  }
  return adj;
}

/** 호버한 노드의 이웃 가운데 연결 수 상위 HOVER_NEIGHBORS 개. */
export function hoverNeighbors(path: string, adj: ReadonlyMap<string, string[]>, degree: (p: string) => number): string[] {
  const list = adj.get(path) ?? [];
  return [...new Set(list)].sort((a, b) => degree(b) - degree(a) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, HOVER_NEIGHBORS);
}

/**
 * 화면에 놓인 제목 하나. x·y 는 가운데(px), w·h 는 크기(px), rank 가 큰 쪽이 겹침에서 이긴다.
 * force 면 겹쳐도 늘 남고 다른 상자보다 먼저 자리를 잡는다 — 범례 종류 강조(kind-highlight.ts)의 "그 종류 제목 전부".
 */
export type LabelBox = { id: string; x: number; y: number; w: number; h: number; rank: number; force?: boolean };

/** 글자 폭 추정(px). 한글·한자·가나 같은 전각은 글자 높이만큼, 그 밖은 0.55 배다. 정확한 측정 대신 쓴다 — 겹침 판정에는 이만하면 된다. */
export function labelWidth(title: string, px: number): number {
  let w = 0;
  for (const ch of title) {
    const c = ch.codePointAt(0) ?? 0;
    const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60);
    w += wide ? px : 0.55 * px;
  }
  return w;
}

/**
 * 겹치는 제목을 걷는다. rank 큰 순서로 자리를 잡고, 이미 잡힌 격자 칸에 걸치는 제목은 버린다. 격자 칸은 cell px 다.
 * 왜 격자인가: 후보가 수천 개("전부")일 때도 선형이다. 칸 단위라 실제보다 조금 넉넉하게 걷는데, 겹침 직전까지 붙이는 것보다 낫다.
 */
export function cullOverlaps(boxes: readonly LabelBox[], cell = 16): Set<string> {
  const order = [...boxes].sort(
    (a, b) => Number(b.force === true) - Number(a.force === true) || b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const taken = new Set<string>();
  const kept = new Set<string>();
  for (const b of order) {
    const x0 = Math.floor((b.x - b.w / 2) / cell);
    const x1 = Math.floor((b.x + b.w / 2) / cell);
    const y0 = Math.floor((b.y - b.h / 2) / cell);
    const y1 = Math.floor((b.y + b.h / 2) / cell);
    let free = true;
    for (let y = y0; y <= y1 && free; y++) for (let x = x0; x <= x1; x++) if (taken.has(`${x},${y}`)) { free = false; break; }
    if (!free && b.force !== true) continue;
    kept.add(b.id);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) taken.add(`${x},${y}`);
  }
  return kept;
}
