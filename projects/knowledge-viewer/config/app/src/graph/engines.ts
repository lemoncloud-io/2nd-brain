// 지도의 두 엔진: 3D(3d-force-graph·three.js) 와 2D(force-graph 캔버스).
// 공용 설정(노드 키·크기·색·간선·클릭·hover)은 configure 하나로 모으고, 엔진마다 다른 그리기는
// build3d(nodeObject.ts) 와 build2d(canvasObject.ts) 가 맡는다. GraphView 만 이 모듈을 불러 lazy 청크에 머문다.
import ForceGraph3D from '3d-force-graph';
import type { ForceGraph3DInstance } from '3d-force-graph';
import ForceGraph from 'force-graph';
import { BufferGeometry, Fog, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { Group, PerspectiveCamera } from 'three';
import type SpriteText from 'three-spritetext';

import type { Kind } from '../../shared/kind.ts';
import type { GraphLink } from '../app/types.ts';
import { createCamera2d } from './camera2d.ts';
import type { Fg2 } from './camera2d.ts';
import { createCamera3d } from './camera3d.ts';
import type { Trackball } from './camera3d.ts';
import { cullCanvasLabels, drawClusterLabels, drawNode, paintNodeArea } from './canvasObject.ts';
import { createDepthPass } from './depthPass.ts';
import type { ClusterKey } from './forces.ts';
import { HOVER_LINK_ALPHA, HOVER_LINK_WIDTH_SCALE, HOVER_OTHER_ALPHA, linkHover } from './interaction.ts';
import { KIND_OFF_ALPHA, activeKind, kindHighlight, kindLinkHighlight, labelRole } from './kind-highlight.ts';
import type { LabelMode } from './labels.ts';
import type { Positioned } from './merge.ts';
import type { MotionSettings } from './motion.ts';
import { buildNodeObject } from './nodeObject.ts';
import { ORBIT_MERIDIANS, ORBIT_OPACITY, ORBIT_PARALLELS, ORBIT_SEGMENTS, orbitGridPositions } from './orbit.ts';
import { withAlpha } from './palette.ts';
import { radiusOf, widthOf } from './scale.ts';

// 시뮬레이션이 노드에 좌표를 쓰고, 간선의 source·target 을 노드 객체로 바꾼다.
export type FgNode = Positioned;
export type FgLink = Omit<GraphLink, 'source' | 'target'> & { source: string | FgNode; target: string | FgNode };
type Fg3 = ForceGraph3DInstance<FgNode, FgLink>;
type GraphShape = { nodes: FgNode[]; links: FgLink[] };

/** 두 엔진이 같은 이름·같은 뜻으로 가진 메서드만. 공용 설정과 데이터 갈아 끼우기는 이것만 쓴다. */
export type CommonFg = {
  graphData(): GraphShape;
  graphData(data: GraphShape): unknown;
  backgroundColor(color: string): unknown;
  nodeId(id: string): unknown;
  nodeRelSize(size: number): unknown;
  nodeVal(fn: (n: FgNode) => number): unknown;
  nodeColor(fn: (n: FgNode) => string): unknown;
  linkWidth(): (l: FgLink) => number;
  linkWidth(fn: (l: FgLink) => number): unknown;
  linkColor(): (l: FgLink) => string;
  linkColor(fn: (l: FgLink) => string): unknown;
  onNodeClick(cb: (n: FgNode, ev: MouseEvent) => void): unknown;
  onNodeHover(cb: (n: FgNode | null, prev: FgNode | null) => void): unknown;
  cooldownTicks(ticks: number): unknown;
  width(w: number): unknown;
  height(h: number): unknown;
  d3Force(name: string, force?: unknown): unknown;
  d3ReheatSimulation(): unknown;
  enablePointerInteraction(enable: boolean): unknown;
  enableNodeDrag(enable: boolean): unknown;
};

/** 엔진 하나. restyle 은 노드 모양(크기·색·고리·제목)과 간선 색을 다시 칠한다 — 레이아웃을 다시 시작하지 않는다. */
export type Engine = {
  fg: CommonFg;
  restyle(): void;
  /** hover 가 바뀐 뒤 엔진별 표시(제목)를 고친다. */
  hover(n: FgNode | null, prev: FgNode | null): void;
  /** 제목 규칙(표시 설정·주요 노드 집합)이 바뀌었다. 노드 물체는 그대로 두고 제목만 다시 정한다. */
  relabel(): void;
  /** 카메라 움직임 설정(부드럽게·바로·감쇠). 엔진을 만든 직후와 설정이 바뀔 때 부른다. */
  motion(m: MotionSettings): void;
  /** 노드 좌표를 통째로 옮겼다 — 카메라도 같은 만큼 옮겨 화면은 그대로 둔다(2D 는 dz 를 무시한다). */
  shift(dx: number, dy: number, dz: number): void;
  /** 집 보기(중심 원점·노드 수에 맞는 거리/배율)로 부드럽게 간다. farStart 면 먼 데서 날아든다(처음 그릴 때·모드 바꿀 때). */
  goHome(nodeCount: number, o?: { farStart?: boolean }): void;
  /** 다음에 레이아웃이 멈추면 지도에 맞춘다(반경·허브 펼침 같은 사용자의 집합 변경 뒤). */
  fitOnStop(): void;
  /** 초기 보기(Space) — 중심 원점·기본 거리와 각도·2D 배율로 관성 전환. */
  reset(nodeCount: number): void;
  /** Shift 를 누른 동안: 노드 선택·호버·드래그 없이 카메라만 움직인다. 커서는 grab 이다. */
  setShift(held: boolean): void;
  /** 자동 회전(3D 전용 — 유휴 시 천천히 돈다). 2D 는 무시한다. */
  autoRotate(on: boolean): void;
  /**
   * 범례 종류 강조(Shared.kind)가 바뀌었다. 스타일만 다시 칠한다 — 레이아웃·물체는 그대로(refresh·reheat 없음).
   * 2D 는 노드 그리기·간선 색 접근자를 다시 넣어 한 번 다시 그리고, 3D 는 간선 색 접근자만 다시 넣는다(노드·제목은 depthPass 가 프레임마다 본다).
   */
  highlightKind(): void;
  /** 구 경위선 궤도 장식(orbit.ts)을 보이거나 숨긴다(3D 전용). 2D 는 무시한다. */
  orbit(on: boolean): void;
  dispose(): void;
};

/** 엔진이 그릴 때 읽는 값. 엔진은 모드가 바뀔 때만 다시 만들므로 바뀌는 값은 함수로 읽는다. */
export type Shared = {
  colors: Record<Kind, string>;
  center: () => string;
  hovered: () => string | null;
  /** 2D 클러스터 이름 글자색(--graph-label-2). */
  clusterColor: string;
  objs: Map<string, Group>;
  labels: Map<string, SpriteText>;
  /** 펼칠 수 있는(잘렸고 아직 펼치지 않은) 노드인가. 참이면 `+` 배지를 그린다. */
  plus: (n: FgNode) => boolean;
  /** 제목 표시 설정(주요만·전부·없음). */
  labelMode: () => LabelMode;
  /** 주요 노드(labels.ts selectMajor)의 경로. 제목을 기본으로 보이는 노드다. */
  major: () => ReadonlySet<string>;
  /** 호버한 노드의 이웃(연결 수 상위 몇 개) — 호버하는 동안 제목 후보다. */
  neighbors: (path: string) => readonly string[];
  /** 노드에 닿은 간선(데이터를 받을 때 interaction.linksByNode 로 한 번 만든다). 3D 호버 강조가 굵기를 바꿀 간선이다. */
  linksOf: (path: string) => readonly FgLink[];
  /** 지도 배경색. 3D 안개 색이다. */
  bg: string;
  /** 레이아웃이 멈췄다(onEngineStop). 엔진별 일(2D 화면 맞춤)보다 먼저 부른다. */
  onStop: () => void;
  /** 범례에서 강조한 종류(kind-highlight.ts). 노드 호버가 겹치면 엔진이 노드 호버를 우선한다. */
  kind: () => Kind | null;
  /** 2D 묶음 이름의 키. 그리지 않으면 null(cluster-mode.ts showClusterLabels — 제목 없음·묶음이 메타·임베딩이 아니면). */
  clusterLabels: () => ClusterKey | null;
  /** 궤도 장식의 선 색(--graph-label-2). 3D 만 읽는다 — 2D(미니 지도 포함)는 주지 않아도 된다. */
  orbitColor?: string;
  /** 궤도 장식의 반지름(orbit.ts orbitRadius). 지도를 그릴 때 정하고 3D 가 프레임마다 읽는다. 없거나 0 이면 그리지 않는다. */
  orbitRadius?: () => number;
};

export const endPath = (end: string | FgNode): string => (typeof end === 'string' ? end : end.path);

/**
 * Shift 를 누른 동안의 커서. 라이브러리는 호버한 노드가 있으면 캔버스에 `clickable`(cursor: pointer)을 두고, 호버를 끄면 그 class 를
 * 걷지 않는다 — 캔버스의 커서가 바깥 요소의 grab 을 덮으므로 캔버스에서 class 를 걷고 커서도 캔버스에 둔다.
 */
function grabCursor(canvas: HTMLElement, root: HTMLElement, held: boolean): void {
  if (held) canvas.classList.remove('clickable');
  canvas.style.cursor = held ? 'grab' : '';
  root.style.cursor = held ? 'grab' : '';
}

/**
 * 구 경위선 격자(orbit.ts)를 반지름 1 로 한 번 만든다 — 반지름은 물체의 scale 로 맞춘다(지오메트리를 다시 만들지 않는다).
 * 장면에 바로 둔다: 라이브러리의 레이캐스트(호버·클릭·드래그)는 그래프 묶음만 보므로 격자는 잡히지 않는다. raycast 도 비워 둔다.
 * 재질은 안개를 받는다(LineBasicMaterial 기본) — 뒤쪽 선은 배경색에 더 묻힌다. 깊이는 쓰지 않아 노드·간선을 가리지 않는다.
 */
function buildOrbitGrid(color: string): LineSegments<BufferGeometry, LineBasicMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(orbitGridPositions(1, ORBIT_MERIDIANS, ORBIT_PARALLELS, ORBIT_SEGMENTS), 3));
  const material = new LineBasicMaterial({ color, transparent: true, opacity: ORBIT_OPACITY, depthWrite: false });
  const grid = new LineSegments(geometry, material);
  grid.raycast = () => {};
  grid.renderOrder = -1;
  grid.visible = false;
  return grid;
}

/** 두 엔진에 같은 설정을 건다. 힘(radial·cluster)은 노드 수를 보고 다시 데울 때 건다. */
export function configure(
  fg: CommonFg,
  o: {
    bg: string;
    accent: string;
    colors: Record<Kind, string>;
    center: () => string;
    kinds: () => Map<string, Kind>;
    /** 참이면 간선을 굵기 없는 선(THREE.Line)으로 그린다 — 3D 전체 보기. 굵기가 있으면 간선마다 원기둥 물체다. */
    thin: () => boolean;
    /** 호버한 노드. 닿은 간선은 강조색·굵게, 나머지는 흐리게 그린다. 2D 는 프레임마다, 3D 는 호버가 바뀔 때 다시 칠한다. */
    hovered: () => string | null;
    /** 범례에서 강조한 종류. 두 끝이 그 종류가 아닌 간선은 흐리게 그린다. 노드 호버가 있으면 노드 호버가 이긴다. */
    kind: () => Kind | null;
    onClick: (n: FgNode, ev: MouseEvent) => void;
    onHover: (n: FgNode | null, prev: FgNode | null) => void;
  },
): void {
  fg.backgroundColor(o.bg);
  fg.nodeId('path');
  fg.nodeRelSize(1);
  fg.nodeVal((n) => radiusOf(n.in + n.out));
  fg.nodeColor((n) => o.colors[n.kind]);
  // 2D 는 굵기 접근자를 프레임마다 읽으므로 호버 강조(×2)를 여기서 준다. 3D 는 굵기 변경이 지오메트리 재생성이라 물체의 scale 로 한다(build3d.hover).
  fg.linkWidth((l) => (o.thin() ? 0 : widthOf(l.weight) * (linkHover(l, o.hovered()) === 'on' ? HOVER_LINK_WIDTH_SCALE : 1)));
  // 간선 색은 출발 문서의 종류로 정한다. 간선의 source 가 아직 문자열일 수 있어 경로로 찾는다.
  // 호버 중: 닿은 간선은 강조색(불투명), 나머지는 흐리게.
  fg.linkColor((l) => {
    const h = linkHover(l, o.hovered());
    if (h === 'on') return withAlpha(o.accent, HOVER_LINK_ALPHA);
    const c = o.center();
    const base = endPath(l.source) === c || endPath(l.target) === c ? o.accent : o.colors[o.kinds().get(endPath(l.source)) ?? 'other'];
    if (h === 'off') return withAlpha(base, HOVER_OTHER_ALPHA);
    // 범례 종류 강조(노드 호버가 없을 때만 — 위에서 h 가 none 이다).
    const k = kindLinkHighlight(o.kinds().get(endPath(l.source)), o.kinds().get(endPath(l.target)), activeKind(o.kind(), o.hovered()));
    if (k === 'off') return withAlpha(base, KIND_OFF_ALPHA);
    return base === o.accent ? o.accent : withAlpha(base, 0.4);
  });
  fg.onNodeClick(o.onClick);
  fg.onNodeHover(o.onHover);
  fg.cooldownTicks(120);
}

/**
 * 3D 엔진. 노드는 three.js 물체(nodeObject.ts)이고 제목은 주요 노드만 빌드 때 만들고, 나머지는 처음 보일 때(호버·겹침 제거 통과) 만든다.
 * 깊이감: 장면에 선형 안개를 두고(간선이 뒤로 갈수록 배경에 섞인다), 프레임마다 depthPass 가 노드의 크기·불투명도·제목 표시를 정한다.
 */
export function build3d(el: HTMLElement, s: Shared): Engine {
  const fg = new ForceGraph3D(el) as unknown as Fg3;
  const labelOn = (n: FgNode): boolean => s.labelMode() === 'all' || (s.labelMode() === 'major' && s.major().has(n.path));
  // 자동 회전은 노드를 호버하는 동안과 범례 종류를 강조하는 동안 멈춘다 — 돌면서 말풍선·제목을 읽을 수 없다.
  const cam = createCamera3d({
    camera: () => fg.camera() as PerspectiveCamera,
    controls: () => fg.controls() as Trackball,
    paused: () => s.hovered() !== null || s.kind() !== null,
  });
  let fitPending = false;
  // Shift 를 누른 동안 노드 물체를 레이어 1 로 옮긴다. 카메라는 두 레이어를 다 그리지만 레이캐스터(호버·DragControls)는 레이어 0 만
  // 보므로 노드가 없는 셈이 된다 — 라이브러리가 DragControls 를 내주지 않아 이것이 막는 길이다.
  let shiftHeld = false;
  const NODE_LAYER_SHIFT = 1;
  fg.camera().layers.enable(NODE_LAYER_SHIFT);
  const setLayer = (obj: Group, held: boolean) => obj.traverse((o) => o.layers.set(held ? NODE_LAYER_SHIFT : 0));
  // 호버로 굵게 한 간선 물체. 호버가 바뀌면 되돌린다. O(차수) — 전체를 돌지 않는다.
  let thick: FgLink[] = [];
  const scaleLinks = (links: readonly FgLink[], k: number) => {
    for (const l of links) {
      const obj = (l as { __lineObj?: { type: string; scale: { x: number; y: number } } }).__lineObj;
      // 원기둥(Mesh)만 — 굵기 0 의 선(Line)은 좌표가 절대값이라 scale 로 굵어지지 않는다.
      if (obj === undefined || obj.type !== 'Mesh') continue;
      obj.scale.x = k;
      obj.scale.y = k;
    }
  };
  fg.showNavInfo(false)
    .nodeThreeObject((n) => {
      const { obj, label } = buildNodeObject(n, s.colors[n.kind], n.path === s.center(), s.plus(n), labelOn(n));
      if (shiftHeld) setLayer(obj, true);
      s.objs.set(n.path, obj);
      // 물체를 다시 만들면 옛 물체에 붙인 hover 제목도 버린다.
      if (label !== null) s.labels.set(n.path, label);
      else s.labels.delete(n.path);
      return obj;
    })
    .nodeThreeObjectExtend(false)
    .linkOpacity(1)
    .onEngineStop(() => {
      s.onStop();
      if (!fitPending) return;
      fitPending = false;
      cam.goHome(fg.graphData().nodes.length);
    });
  // 안개의 near·far 는 depthPass 가 프레임마다 거리 분포에 맞춘다.
  const scene = fg.scene();
  scene.fog = new Fog(s.bg, 1, 1e9);
  // 궤도 장식. 장면에 고정이라 자동 회전(카메라만 돈다) 때 같이 돌아 보인다. 켬/끔은 orbit(), 반지름은 프레임마다 s.orbitRadius.
  const grid = buildOrbitGrid(s.orbitColor ?? s.clusterColor);
  let gridOn = false;
  scene.add(grid);
  const pass = createDepthPass({
    scene: () => fg.scene(),
    camera: () => fg.camera(),
    width: () => fg.width(),
    height: () => fg.height(),
    objs: s.objs,
    labels: s.labels,
    center: s.center,
    hovered: s.hovered,
    labelMode: s.labelMode,
    major: s.major,
    neighbors: s.neighbors,
    kind: s.kind,
  });
  // 프레임마다 한 자리: 카메라 전환(관성 계수·스프링)을 먼저 옮기고, 그 카메라로 깊이를 잰다.
  scene.onBeforeRender = () => {
    cam.frame(performance.now());
    const r = s.orbitRadius?.() ?? 0;
    grid.visible = gridOn && r > 0;
    if (grid.visible && grid.scale.x !== r) grid.scale.setScalar(r);
    pass();
  };
  return {
    fg: fg as unknown as CommonFg,
    // 같은 함수를 다시 넣으면 라이브러리가 노드 물체를 모두 새로 만든다. graphData 를 주지 않으므로 레이아웃(alpha)은 그대로다.
    restyle() {
      fg.nodeThreeObject(fg.nodeThreeObject());
      fg.linkColor(fg.linkColor());
    },
    // 제목의 보임은 depthPass 가 프레임마다 정한다(호버한 노드는 늘 보인다). 간선 강조만 여기서: 색은 접근자를 다시 넣어
    // 라이브러리가 재질을 바꾸고(색별 공유 재질, 간선 수만큼 포인터 교체), 굵기는 닿은 간선의 물체 scale 로.
    hover(n) {
      scaleLinks(thick, 1);
      thick = n === null ? [] : [...s.linksOf(n.path)];
      scaleLinks(thick, HOVER_LINK_WIDTH_SCALE);
      fg.linkColor(fg.linkColor());
    },
    relabel() {},
    // 노드 재질·제목은 depthPass 가 다음 프레임에 s.kind 를 읽어 바꾼다. 간선 색만 접근자를 다시 넣는다(호버와 같은 길).
    highlightKind() {
      fg.linkColor(fg.linkColor());
    },
    motion: (m) => cam.setMotion(m),
    shift: (dx, dy, dz) => cam.shift(dx, dy, dz),
    goHome: (n, o) => cam.goHome(n, o),
    fitOnStop() {
      fitPending = true;
    },
    reset: (n) => cam.reset(n),
    autoRotate: (on) => cam.setAutoRotate(on),
    orbit(on) {
      gridOn = on;
    },
    setShift(held) {
      if (held === shiftHeld) return;
      shiftHeld = held;
      // 호버·클릭을 끊고(라이브러리가 hoverObj 를 비운다) 노드를 레이캐스트에서 치운다.
      fg.enablePointerInteraction(!held);
      for (const obj of s.objs.values()) setLayer(obj, held);
      for (const label of s.labels.values()) label.layers.set(held ? NODE_LAYER_SHIFT : 0);
      grabCursor(fg.renderer().domElement, el, held);
    },
    dispose() {
      cam.dispose();
      scene.onBeforeRender = () => {};
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
      // 지도↔문서를 오가면 WebGL 문맥이 쌓인다(브라우저 한도 약 16개). 부수기 전에 문맥을 놓는다.
      try {
        fg.renderer().forceContextLoss();
      } catch {
        // 렌더러가 이미 없거나 문맥을 잃었다.
      }
      fg._destructor();
    },
  };
}

/**
 * 2D 엔진. 노드는 캔버스 원+고리(canvasObject.ts), 그린 뒤 클러스터 이름을 무게중심에 쓴다.
 * 제목은 프레임 앞(onRenderFramePre)에서 후보(주요 노드·hover) 가운데 화면에서 겹치지 않는 것만 고른다. 깊이감은 없다(2D).
 */
export function build2d(el: HTMLElement, s: Shared): Engine {
  const fg = new ForceGraph<FgNode, FgLink>(el);
  const labelOn = (n: FgNode): boolean => s.labelMode() === 'all' || (s.labelMode() === 'major' && s.major().has(n.path));
  const cam = createCamera2d(fg as unknown as Fg2, el);
  let shown = new Set<string>();
  fg.nodeCanvasObjectMode(() => 'replace')
    .onRenderFramePre((_ctx, k) => {
      shown = cullCanvasLabels(fg.graphData().nodes, (x, y) => fg.graph2ScreenCoords(x, y), k, {
        center: s.center(),
        hovered: s.hovered(),
        candidate: labelOn,
        force: (n) => labelRole(n, false, s.kind(), s.hovered()) === 'force',
      });
    })
    .nodeCanvasObject((n, ctx, k) =>
      drawNode(n, ctx, k, {
        color: s.colors[n.kind],
        isCenter: n.path === s.center(),
        hovered: n.path === s.hovered(),
        plus: s.plus(n),
        label: shown.has(n.path),
        dim: kindHighlight(n, s.kind(), s.hovered()) === 'off',
      }),
    )
    .nodePointerAreaPaint((n, paint, ctx) => paintNodeArea(n, paint, ctx))
    .onRenderFramePost((ctx, k) => {
      const key = s.clusterLabels();
      if (key !== null) drawClusterLabels(fg.graphData().nodes, ctx, k, s.clusterColor, key);
    });
  // 2D 의 기본 확대는 노드 수로만 정해 바깥 껍질이 잘린다. 첫 레이아웃이 멈추면 한 번 화면에 맞춘다(그 뒤는 사용자의 확대를 둔다 —
  // 파일 변경(SSE)마다 맞추면 보던 곳을 뺏는다). 사용자가 집합을 바꿨을 때(fitOnStop)는 다시 맞춘다.
  let fitted = false;
  let fitPending = false;
  // 멈춤 알림(s.onStop)을 먼저 부르고 이어서 맞춘다 — 하나의 onEngineStop 에 같이 건다.
  fg.onEngineStop(() => {
    s.onStop();
    if ((fitted && !fitPending) || fg.graphData().nodes.length === 0) return;
    fitted = true;
    fitPending = false;
    cam.fit(40);
  });
  // 캔버스는 노드 값을 매 프레임 읽는다. 같은 그리기 함수를 다시 넣으면 한 번 다시 그리기만 한다(레이아웃은 그대로).
  const redraw = () => {
    fg.nodeCanvasObject(fg.nodeCanvasObject());
  };
  return {
    fg: fg as unknown as CommonFg,
    restyle() {
      redraw();
      fg.linkColor(fg.linkColor());
    },
    hover: redraw,
    relabel: redraw,
    highlightKind() {
      redraw();
      fg.linkColor(fg.linkColor());
    },
    motion: (m) => cam.setMotion(m),
    shift: (dx, dy) => cam.shift(dx, dy),
    goHome: (n, o) => cam.goHome(n, o),
    fitOnStop() {
      fitPending = true;
    },
    reset: (n) => cam.reset(n),
    autoRotate() {},
    orbit() {},
    setShift(held) {
      // 노드 드래그는 제스처마다, 호버는 프레임마다 이 값을 읽는다 — 바로 듣는다. 클릭은 호버한 물체가 없으면 안 난다.
      fg.enableNodeDrag(!held);
      fg.enablePointerInteraction(!held);
      const canvas = el.querySelector('canvas');
      if (canvas !== null) grabCursor(canvas, el, held);
    },
    dispose() {
      cam.dispose();
      fg._destructor();
    },
  };
}
