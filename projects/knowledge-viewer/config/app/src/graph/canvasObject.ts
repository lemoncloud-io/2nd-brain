// 2D 지도(force-graph 캔버스)의 노드·클러스터 그리기. 3D 의 nodeObject.ts 와 같은 규칙을 캔버스로 옮긴다.
// 중심: 흰 고리. 허브: 빈 고리. 펼칠 수 있는(잘린) 노드: 고리 오른쪽 위에 작은 `+`. 제목은 주요 노드(labels.ts, 부르는 쪽이 정한다)와 hover 노드만.
// 크기·투명도는 scale.ts 를 같이 쓴다. 2D 에는 깊이가 없어 깊이감(depth.ts)은 쓰지 않는다.
// 좌표는 그래프 좌표다 — 확대 배율(globalScale)로 나눠 화면에서 같은 굵기·글자 크기로 보이게 한다.
import type { GraphNode } from '../app/types.ts';
import { centroids, metaKey } from './forces.ts';
import type { ClusterKey } from './forces.ts';
import { KIND_OFF_ALPHA } from './kind-highlight.ts';
import { cullOverlaps, degreeOf, labelWidth } from './labels.ts';
import type { LabelBox } from './labels.ts';
import { LABEL_COLOR, LABEL_FONT, LABEL_PX } from './nodeObject.ts';
import { opacityOf, radiusOf } from './scale.ts';

const CLUSTER_PX = 10;
const PLUS_PX = 11;

type CanvasNode = GraphNode & { x?: number; y?: number };

/** 노드 하나를 그린다(nodeCanvasObjectMode 'replace'). */
export function drawNode(
  n: CanvasNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  o: {
    color: string;
    isCenter: boolean;
    hovered: boolean;
    plus: boolean;
    /** 제목을 늘 보이는(주요) 노드인가. */
    label: boolean;
    /** 범례 종류 강조에서 다른 종류 — 원·고리·제목을 KIND_OFF_ALPHA 로 흐리게. */
    dim?: boolean;
  },
): void {
  if (n.x === undefined || n.y === undefined) return;
  const r = radiusOf(n.in + n.out);
  // 화면 1px 을 그래프 좌표로. 고리 틈·굵기·글자는 이것으로만 잰다(확대해도 화면에서 같다).
  const px = 1 / globalScale;
  const f = o.dim === true ? KIND_OFF_ALPHA : 1;
  ctx.save();
  ctx.globalAlpha = opacityOf(n.hop) * f;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.globalAlpha = f;
  if (o.isCenter) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 3 * px, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (n.hub) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 3 * px, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (o.plus) {
    // 잘린 이웃이 남았다(펼치기·Shift+클릭으로 더 불러온다). 고리 바깥 오른쪽 위에 둔다.
    ctx.font = `bold ${PLUS_PX * px}px ${LABEL_FONT}`;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('+', n.x + r + 3 * px, n.y - r + 2 * px);
  }
  if (o.hovered || o.label) {
    ctx.font = `${LABEL_PX * px}px ${LABEL_FONT}`;
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(n.title, n.x, n.y + r + 5 * px);
  }
  ctx.restore();
}

/**
 * 이번 프레임에 제목을 그릴 노드(onRenderFramePre). 후보(주요 노드·hover)를 화면 좌표로 옮겨 겹치는 것을 걷는다(labels.ts).
 * 제목은 노드 위에 붙으므로 상자도 글자 높이만큼 올린다. hover 와 중심은 늘 이긴다.
 */
export function cullCanvasLabels(
  nodes: readonly CanvasNode[],
  toScreen: (x: number, y: number) => { x: number; y: number },
  globalScale: number,
  o: {
    center: string;
    hovered: string | null;
    candidate: (n: CanvasNode) => boolean;
    /** 겹쳐도 늘 남길 노드(범례 종류 강조의 그 종류). 없으면 없다. */
    force?: (n: CanvasNode) => boolean;
  },
): Set<string> {
  const boxes: LabelBox[] = [];
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const isHover = n.path === o.hovered;
    const force = o.force?.(n) === true;
    if (!isHover && !force && !o.candidate(n)) continue;
    const p = toScreen(n.x, n.y);
    boxes.push({
      id: n.path,
      x: p.x,
      y: p.y + radiusOf(n.in + n.out) * globalScale + 5 + LABEL_PX / 2,
      w: labelWidth(n.title, LABEL_PX),
      h: LABEL_PX * 1.4,
      rank: isHover ? Number.POSITIVE_INFINITY : n.path === o.center ? Number.MAX_SAFE_INTEGER : degreeOf(n),
      force,
    });
  }
  return cullOverlaps(boxes);
}

/** 노드가 눌리는 영역. 기본 영역(√nodeVal)은 그린 원보다 작아 같은 반지름의 원으로 바꾼다. */
export function paintNodeArea(n: CanvasNode, paint: string, ctx: CanvasRenderingContext2D): void {
  if (n.x === undefined || n.y === undefined) return;
  ctx.fillStyle = paint;
  ctx.beginPath();
  // 여유 1 은 그래프 좌표다(작은 노드도 누르기 쉽게). 그린 고리와 달리 화면 배율을 따르지 않아도 된다.
  ctx.arc(n.x, n.y, radiusOf(n.in + n.out) + 1, 0, 2 * Math.PI);
  ctx.fill();
}

/** 클러스터 이름을 무게중심에 쓴다(onRenderFramePost). 노드 하나뿐인 클러스터는 건너뛴다. 색은 `--graph-label-2` 값, 이름은 keyOf(기본 메타 키)다. */
export function drawClusterLabels(
  nodes: readonly CanvasNode[],
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  color: string,
  keyOf: ClusterKey = metaKey,
): void {
  ctx.save();
  ctx.font = `${CLUSTER_PX / globalScale}px ${LABEL_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [key, c] of centroids(nodes, keyOf)) {
    if (c.n < 2) continue;
    ctx.fillText(key, c.x, c.y);
  }
  ctx.restore();
}
