// graph 블록의 자동 레이아웃. 좌표를 yml에 적지 않기 위해(F11) 순수 함수로 계산하고 단위 테스트한다.
//
// 배치: 그룹을 밴드로 위에서 아래로 쌓고, 밴드 안에서 노드를 왼쪽부터 흘리다가 폭이 모자라면 줄을 바꾼다.
//       줄은 밴드 안에서 가운데 정렬한다. 그룹이 없는 노드는 밴드 밖 맨 아래 줄에 모은다.
// 배선: 선이 남의 상자를 관통하거나 라벨이 상자에 가리면 그림이 거짓말을 하므로,
//       (1) 이웃 사이 간격을 그 사이를 지나는 라벨이 들어갈 만큼 벌리고,
//       (2) 같은 줄의 비이웃은 줄 위로 휘게 하고,
//       (3) 줄을 건너는 선은 아래(위) 가장자리 중앙에서 3차 베지어로 잇되
//           남의 상자와 만나면 줄 사이의 빈 통로로, 그래도 안 되면 바깥 여백으로 우회한다.

import type { GraphBlock, GraphEdge, GraphNode } from '../../model/types.ts';

export interface LaidNode {
  id: string;
  label: string;
  group: string | null;
  tag?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidBand {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface EdgeSeg {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
}
export interface LabelBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidEdge {
  from: string;
  to: string;
  label?: string;
  style: 'solid' | 'dashed';
  both: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  segs: EdgeSeg[];
  d: string; // SVG path. segs와 같은 곡선이다 — 그린 것과 검사한 것이 어긋나지 않게
  labelBox?: LabelBox;
}
export interface GraphLayout {
  width: number;
  height: number;
  bands: LaidBand[];
  nodes: LaidNode[];
  edges: LaidEdge[];
}

const OUTER_PAD = 12;
const BAND_PAD = 12;
const BAND_HEADER = 24;
const ARC_SPACE = 30; // 같은 줄의 비이웃 엣지가 지나갈 줄 위쪽 통로
const BAND_GAP = 34;
const GAP_X = 16;
const GAP_Y = 42; // 줄 사이 — 라벨 한 줄이 들어갈 만큼
const NODE_H = 40;
const NODE_MIN_W = 96;
const NODE_MAX_W = 220;
const CHAR_PX = 7;
const LABEL_H = 16;
const LABEL_PAD = 6;
const LABEL_CLEAR = 14; // 이웃 사이 간격에서 라벨 양옆에 남길 여백
const PAIR_OFFSET = 15; // 같은 두 노드를 잇는 선이 여럿일 때 벌리는 간격
const MARGIN_X = OUTER_PAD + BAND_PAD / 2;

interface Pt {
  x: number;
  y: number;
}
interface Path {
  start: Pt;
  segs: EdgeSeg[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// 브라우저 측정 없이 결정적으로 폭을 정해야 같은 입력이면 같은 좌표가 나온다.
// 한글·한자·가나는 라틴 문자의 두 배 폭으로 센다.
export function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code > 0x1100 && code < 0xffdc ? 2 : 1;
  }
  return units;
}

export function labelTextWidth(text: string): number {
  return textUnits(text) * 6;
}

function labelBoxWidth(text: string): number {
  return labelTextWidth(text) + LABEL_PAD * 2;
}

function nodeWidth(label: string): number {
  return Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, Math.round(textUnits(label) * CHAR_PX) + 26));
}

// ── 곡선 ────────────────────────────────────────────────────────────────────

function segTo(c1: Pt, c2: Pt, p: Pt): EdgeSeg {
  return { c1x: round(c1.x), c1y: round(c1.y), c2x: round(c2.x), c2y: round(c2.y), x: round(p.x), y: round(p.y) };
}

function straight(a: Pt, b: Pt): Path {
  const c1 = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
  const c2 = { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 };
  return { start: { x: round(a.x), y: round(a.y) }, segs: [segTo(c1, c2, b)] };
}

// 꺾은선을 그대로 잇는다(우회로의 마지막 보루 — 절대 부풀지 않는다).
function linearPath(points: Pt[]): Path {
  const segs: EdgeSeg[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    segs.push(
      segTo(
        { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
        { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
        b,
      ),
    );
  }
  return { start: { x: round(points[0]!.x), y: round(points[0]!.y) }, segs };
}

// 꺾은선의 모서리를 둥글린다(Catmull-Rom → 3차 베지어). 장력을 낮춰 부풀림을 줄인다.
function smoothPath(points: Pt[]): Path {
  const t = 1 / 8;
  const segs: EdgeSeg[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    segs.push(
      segTo(
        { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t },
        { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t },
        p2,
      ),
    );
  }
  return { start: { x: round(points[0]!.x), y: round(points[0]!.y) }, segs };
}

function pathD(path: Path): string {
  let d = `M ${path.start.x} ${path.start.y}`;
  for (const s of path.segs) d += ` C ${s.c1x} ${s.c1y} ${s.c2x} ${s.c2y} ${s.x} ${s.y}`;
  return d;
}

function cubicAt(p0: Pt, s: EdgeSeg, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x,
    y: u * u * u * p0.y + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y,
  };
}

function samplePath(path: Path, n: number): Pt[] {
  const out: Pt[] = [];
  const count = path.segs.length;
  for (let i = 0; i <= n; i += 1) {
    const g = (i / n) * count;
    const k = Math.min(count - 1, Math.floor(g));
    const seg = path.segs[k]!;
    const prev = k === 0 ? path.start : { x: path.segs[k - 1]!.x, y: path.segs[k - 1]!.y };
    out.push(cubicAt(prev, seg, g - k));
  }
  return out;
}

// 화면 코드와 테스트가 같은 곡선을 본다. n등분이면 표본은 n+1개다.
export function sampleEdge(edge: LaidEdge, n = 20): Pt[] {
  return samplePath({ start: { x: edge.x1, y: edge.y1 }, segs: edge.segs }, n);
}

// ── 겹침 판정 ───────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function pointInside(rect: Rect, p: Pt, margin: number): boolean {
  return (
    p.x > rect.x + margin && p.x < rect.x + rect.w - margin && p.y > rect.y + margin && p.y < rect.y + rect.h - margin
  );
}

function pathHitsNode(path: Path, nodes: LaidNode[], skip: Set<string>): boolean {
  const points = samplePath(path, 48);
  return nodes.some((node) => !skip.has(node.id) && points.some((p) => pointInside(node, p, 1)));
}

// ── 배치 ────────────────────────────────────────────────────────────────────

interface Flowed {
  rows: LaidNode[][];
  height: number;
}

function flow(
  nodes: GraphNode[],
  originX: number,
  originY: number,
  innerWidth: number,
  group: string | null,
  gapBetween: (a: string, b: string) => number,
): Flowed {
  const rows: LaidNode[][] = [];
  let row: LaidNode[] = [];
  let cursor = 0;

  for (const node of nodes) {
    const w = nodeWidth(node.label);
    const prev = row[row.length - 1];
    const gap = prev === undefined ? 0 : gapBetween(prev.id, node.id);
    if (prev !== undefined && cursor + gap + w > innerWidth) {
      rows.push(row);
      row = [];
      cursor = 0;
    }
    const lead = row.length === 0 ? 0 : gapBetween(row[row.length - 1]!.id, node.id);
    row.push({
      id: node.id,
      label: node.label,
      group,
      ...(node.tag === undefined ? {} : { tag: node.tag }),
      x: originX + cursor + lead,
      y: 0,
      w,
      h: NODE_H,
    });
    cursor += lead + w;
  }
  if (row.length > 0) rows.push(row);

  // 줄마다 가운데 정렬하고 세로 위치를 준다.
  rows.forEach((line, k) => {
    const left = line[0]!.x;
    const right = line[line.length - 1]!.x + line[line.length - 1]!.w;
    const shift = Math.round((innerWidth - (right - left)) / 2);
    const y = originY + k * (NODE_H + GAP_Y);
    for (const node of line) {
      node.x += shift;
      node.y = y;
    }
  });

  const height = rows.length === 0 ? 0 : rows.length * NODE_H + (rows.length - 1) * GAP_Y;
  return { rows, height };
}

// ── 배선 ────────────────────────────────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

interface Corridors {
  rowTops: number[];
  // 줄과 줄 사이(그리고 맨 위·맨 아래)의 빈 통로 중앙 y
  below: (rowTop: number) => number;
  above: (rowTop: number) => number;
  nearest: (y: number) => number;
}

function buildCorridors(nodes: LaidNode[], height: number): Corridors {
  const rowTops = [...new Set(nodes.map((n) => n.y))].sort((a, b) => a - b);
  const centers: number[] = [];
  centers.push(rowTops.length === 0 ? height / 2 : rowTops[0]! - ARC_SPACE / 2);
  for (let i = 1; i < rowTops.length; i += 1) {
    centers.push((rowTops[i - 1]! + NODE_H + rowTops[i]!) / 2);
  }
  centers.push(rowTops.length === 0 ? height / 2 : rowTops[rowTops.length - 1]! + NODE_H + BAND_PAD);

  return {
    rowTops,
    below: (rowTop) => centers[rowTops.indexOf(rowTop) + 1] ?? rowTop + NODE_H + BAND_PAD,
    above: (rowTop) => centers[rowTops.indexOf(rowTop)] ?? rowTop - ARC_SPACE / 2,
    nearest: (y) => centers.reduce((best, c) => (Math.abs(c - y) < Math.abs(best - y) ? c : best), centers[0]!),
  };
}

function sideCenters(node: LaidNode, dx: number, off: number): { s: Pt } {
  return { s: { x: dx > 0 ? node.x + node.w : node.x, y: node.y + node.h / 2 + off } };
}

function routeEdge(
  from: LaidNode,
  to: LaidNode,
  off: number,
  rowMates: LaidNode[],
  nodes: LaidNode[],
  corridors: Corridors,
  width: number,
): Path {
  const skip = new Set([from.id, to.id]);

  if (from.y === to.y) {
    const left = from.x < to.x ? from : to;
    const right = from.x < to.x ? to : from;
    const blocked = rowMates.some(
      (n) => n.id !== from.id && n.id !== to.id && n.x > left.x && n.x + n.w < right.x + right.w,
    );
    if (!blocked) {
      // 이웃끼리는 사이 간격을 그대로 가로지른다. 간격은 라벨이 들어갈 만큼 벌려 두었다.
      const a = sideCenters(from, to.x - from.x, off).s;
      const b = sideCenters(to, from.x - to.x, off).s;
      return straight(a, b);
    }
    // 비이웃은 줄 위로 휘어 남의 상자를 넘어간다.
    const lift = ARC_SPACE * 1.25 + Math.abs(off);
    const a = { x: from.x + from.w / 2 + off, y: from.y };
    const b = { x: to.x + to.w / 2 + off, y: to.y };
    return { start: { x: round(a.x), y: round(a.y) }, segs: [segTo({ x: a.x, y: a.y - lift }, { x: b.x, y: b.y - lift }, b)] };
  }

  const down = to.y > from.y;
  const a = { x: from.x + from.w / 2 + off, y: down ? from.y + from.h : from.y };
  const b = { x: to.x + to.w / 2 + off, y: down ? to.y : to.y + to.h };

  // 1) 곧장 잇는 3차 베지어
  const mid = (a.y + b.y) / 2;
  const direct: Path = {
    start: { x: round(a.x), y: round(a.y) },
    segs: [segTo({ x: a.x, y: mid }, { x: b.x, y: mid }, b)],
  };
  if (!pathHitsNode(direct, nodes, skip)) return direct;

  // 2) 줄 사이의 빈 통로로 우회
  const corridorY = down ? corridors.below(from.y) : corridors.above(from.y);
  const viaCorridor = smoothPath([a, { x: a.x, y: corridorY }, { x: b.x, y: corridorY }, b]);
  if (!pathHitsNode(viaCorridor, nodes, skip)) return viaCorridor;

  // 3) 바깥 여백으로 크게 돈다. 노드가 없는 자리라 반드시 통한다.
  const cA = down ? corridors.below(from.y) : corridors.above(from.y);
  const cB = down ? corridors.above(to.y) : corridors.below(to.y);
  const marginX = (a.x + b.x) / 2 < width / 2 ? MARGIN_X : width - MARGIN_X;
  const points = [a, { x: a.x, y: cA }, { x: marginX, y: cA }, { x: marginX, y: cB }, { x: b.x, y: cB }, b];
  const viaMargin = smoothPath(points);
  if (!pathHitsNode(viaMargin, nodes, skip)) return viaMargin;
  return linearPath(points);
}

function placeLabel(path: Path, text: string, nodes: LaidNode[], corridors: Corridors): LabelBox {
  const w = labelBoxWidth(text);
  const points = samplePath(path, 40);
  const order = [20, 18, 22, 16, 24, 14, 26, 12, 28, 10, 30];
  for (const i of order) {
    for (const dy of [0, -17, 17, -30, 30]) {
      const c = points[i]!;
      const box = { x: c.x - w / 2, y: c.y - LABEL_H / 2 + dy, w, h: LABEL_H };
      if (!nodes.some((n) => overlaps(box, n))) {
        return { text, x: round(box.x), y: round(box.y), w: round(w), h: LABEL_H };
      }
    }
  }
  // 어디에도 못 놓으면 가장 가까운 빈 통로에 둔다. 통로에는 노드가 없다.
  const c = points[20]!;
  const y = corridors.nearest(c.y);
  return { text, x: round(c.x - w / 2), y: round(y - LABEL_H / 2), w: round(w), h: LABEL_H };
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export function layoutGraph(block: GraphBlock, opts?: { width?: number }): GraphLayout {
  const width = Math.max(240, Math.round(opts?.width ?? 880));
  const bandWidth = width - OUTER_PAD * 2;
  const innerWidth = Math.max(NODE_MIN_W, bandWidth - BAND_PAD * 2);

  const declared = block.groups ?? [];
  const known = new Set(declared.map((g) => g.id));
  const nodes = block.nodes ?? [];
  const edges = block.edges ?? [];

  // 이웃 사이 간격은 그 사이를 지나갈 라벨이 들어갈 만큼 벌린다.
  const gapNeed = new Map<string, number>();
  for (const edge of edges) {
    if (edge.label === undefined) continue;
    const key = pairKey(edge.from, edge.to);
    const need = labelBoxWidth(edge.label) + LABEL_CLEAR;
    gapNeed.set(key, Math.max(gapNeed.get(key) ?? 0, need));
  }
  const gapBetween = (a: string, b: string) => Math.max(GAP_X, gapNeed.get(pairKey(a, b)) ?? 0);

  const bands: LaidBand[] = [];
  const laid: LaidNode[] = [];
  let y = OUTER_PAD;

  for (const group of declared) {
    const members = nodes.filter((n) => n.group === group.id);
    if (members.length === 0) continue; // 빈 밴드는 그리지 않는다
    const { rows, height } = flow(
      members,
      OUTER_PAD + BAND_PAD,
      y + BAND_HEADER + ARC_SPACE,
      innerWidth,
      group.id,
      gapBetween,
    );
    const bandHeight = BAND_HEADER + ARC_SPACE + height + BAND_PAD;
    bands.push({ id: group.id, label: group.label, x: OUTER_PAD, y, w: bandWidth, h: bandHeight });
    for (const row of rows) laid.push(...row);
    y += bandHeight + BAND_GAP;
  }

  // group이 없거나 선언되지 않은 그룹을 가리키는 노드는 밴드 밖에 둔다(검사기가 후자는 먼저 막는다).
  const loose = nodes.filter((n) => n.group === undefined || !known.has(n.group));
  if (loose.length > 0) {
    const { rows, height } = flow(loose, OUTER_PAD, y + ARC_SPACE, Math.max(NODE_MIN_W, bandWidth), null, gapBetween);
    for (const row of rows) laid.push(...row);
    y += ARC_SPACE + height + BAND_GAP;
  }

  const height = laid.length === 0 ? OUTER_PAD * 2 : y - BAND_GAP + OUTER_PAD;
  const byId = new Map(laid.map((n) => [n.id, n]));
  const corridors = buildCorridors(laid, height);

  // 같은 두 노드를 잇는 선이 여럿이면 좌우로 벌려 겹치지 않게 한다.
  const pairCount = new Map<string, number>();
  const drawable: { edge: GraphEdge; from: LaidNode; to: LaidNode }[] = [];
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || from === to) continue; // 끊긴 엣지로 화면이 죽지 않게 한다
    drawable.push({ edge, from, to });
    const key = pairKey(edge.from, edge.to);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const out: LaidEdge[] = [];
  for (const { edge, from, to } of drawable) {
    const key = pairKey(edge.from, edge.to);
    const total = pairCount.get(key)!;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const off = total === 1 ? 0 : (k - (total - 1) / 2) * PAIR_OFFSET;

    const rowMates = laid.filter((n) => n.y === from.y);
    const path = routeEdge(from, to, off, rowMates, laid, corridors, width);
    const last = path.segs[path.segs.length - 1]!;

    out.push({
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      style: edge.style ?? 'solid',
      both: edge.both === true,
      x1: path.start.x,
      y1: path.start.y,
      x2: last.x,
      y2: last.y,
      segs: path.segs,
      d: pathD(path),
      ...(edge.label === undefined ? {} : { labelBox: placeLabel(path, edge.label, laid, corridors) }),
    });
  }

  return { width, height, bands, nodes: laid, edges: out };
}

// 그림과 같은 내용을 텍스트로 병행 제공하기 위한 요약(화면 낭독기용).
export function describeGraph(block: GraphBlock): { nodeId: string; label: string; group: string | null; links: string[] }[] {
  const labelOf = new Map(block.nodes.map((n) => [n.id, n.label]));
  const groupOf = new Map((block.groups ?? []).map((g) => [g.id, g.label]));
  return block.nodes.map((node) => {
    const links: string[] = [];
    for (const edge of block.edges ?? []) {
      const tail = edge.label ? ` (${edge.label})` : '';
      if (edge.from === node.id) links.push(`→ ${labelOf.get(edge.to) ?? edge.to}${tail}`);
      else if (edge.to === node.id && edge.both) links.push(`→ ${labelOf.get(edge.from) ?? edge.from}${tail}`);
      else if (edge.to === node.id) links.push(`← ${labelOf.get(edge.from) ?? edge.from}${tail}`);
    }
    return {
      nodeId: node.id,
      label: node.label,
      group: node.group === undefined ? null : groupOf.get(node.group) ?? node.group,
      links,
    };
  });
}
