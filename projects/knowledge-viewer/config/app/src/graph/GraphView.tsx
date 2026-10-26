// 지도(링크 그래프). 3D·2D 두 엔진(engines.ts) 중 하나로 그린다.
// 그래프 라이브러리를 끌어오므로 App 이 lazy 로 불러 index 청크에 들어가지 않게 한다.
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type React from 'react';
import type { Group } from 'three';
import type SpriteText from 'three-spritetext';

import { KINDS } from '../../shared/kind.ts';
import type { Kind } from '../../shared/kind.ts';
import { ChangedEventsContext } from '../app/events.ts';
import type { GraphDepth, GraphMode, NavigateFn } from '../app/route.ts';
import type { GraphNode, GraphQuery } from '../app/types.ts';
import { build2d, build3d, configure, endPath } from './engines.ts';
import type { Engine, FgLink, FgNode, Shared } from './engines.ts';
import { applyCharge, applyClusterMode, applyIsolatedOrbit, applyRadial, clusterKeyOf, radiusFor, readCharge } from './forces.ts';
import { INITIAL_KEYS, isTypingTarget, keyStep, linksByNode } from './interaction.ts';
import { kindCounts, kindHover } from './kind-highlight.ts';
import type { KeyInput, KeyState } from './interaction.ts';
import { applyPins, releasePins } from './pins.ts';
import { GraphLegend } from './GraphControls.tsx';
import type { GraphHubs, GraphStats } from './GraphControls.tsx';
import { adjacencyOf, degreeOf, hoverNeighbors, selectMajor } from './labels.ts';
import type { LabelMode } from './labels.ts';
import type { MergeResult } from './merge.ts';
import { resolveMotion } from './motion.ts';
import type { DampingLevel, MotionMode, MotionSettings } from './motion.ts';
import type { RotateMode } from './autorotate.ts';
import { orbitRadius } from './orbit.ts';
import type { OrbitMode } from './orbit.ts';
import { effectiveClusterMode, showClusterLabels, type ClusterMode } from './cluster-mode.ts';
import { embeddingReady, embeddingStore, embeddingToken } from './embedding.ts';
import { labelPropagation } from './community.ts';
import { readColor, readVar } from './palette.ts';
import { useGraphData } from './useGraphData.ts';

type Props = {
  center: string;
  agent: boolean;
  /** 소스(src)는 주지 않는다 — App 의 navigate 가 지금 소스를 둔다. */
  navigate: NavigateFn;
  depth: GraphDepth;
  mode: GraphMode;
  all: boolean;
  hubs: GraphHubs;
  /** 제목 표시 — 주요 노드만(기본)·전부·없음. 호버한 노드의 제목은 언제나 보인다. */
  labels: LabelMode;
  /** 카메라 움직임 — 부드럽게(관성·전환, 기본)·바로. OS 의 prefers-reduced-motion 이면 바로다. */
  motion: MotionMode;
  /** 관성의 감쇠 강도(약·중·강). */
  damping: DampingLevel;
  /** 묶음(클러스터 힘) 기준 — 메타(기본)·커뮤니티·없음. */
  cluster: ClusterMode;
  /** 자동 회전(3D) — 자동·끔. */
  rotate: RotateMode;
  /** 구 경위선 궤도 장식(3D) — 켬·끔. */
  orbit: OrbitMode;
  /** 오른쪽 열(조절 패널의 범례)이 안 보이면 캔버스 위에 범례를 띄운다. 범례는 한 번에 하나만 보인다. */
  legendInCanvas: boolean;
  /** 그린 지도의 요약. 지도가 사라지면 null 이다. */
  onStats?: (stats: GraphStats | null) => void;
};

/** 같은 노드를 이 시간 안에 두 번 누르면 더블클릭(리더로 열기)이다. */
const DOUBLE_CLICK_MS = 300;
/** 펼칠 수 있는 노드에서 마우스가 떠나도 말풍선을 이만큼 남긴다 — "펼치기" 버튼까지 갈 시간이다. */
const TIP_GRACE_MS = 700;
const NO_EXPAND: string[] = [];
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** OS 가 움직임을 줄이라고 하는가. 바뀌면 따라간다. matchMedia 가 없으면(SSR·시험) 거짓이다. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** 노드 모양을 정하는 값. 이것이 바뀌면 다시 칠한다(제목·종류·연결 수·허브·홉·중심 여부·잘림·펼침 — 뒤 둘은 `+` 배지). */
const lookOf = (n: GraphNode, isCenter: boolean, expanded: boolean): string =>
  `${n.kind}|${n.in + n.out}|${n.hub}|${n.hop}|${isCenter}|${n.truncated}|${expanded}|${n.title}`;

export function GraphView({ center, agent, navigate, depth, mode, all, hubs, labels, motion, damping, cluster, rotate, orbit, legendInCanvas, onStats }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // 노드 물체와 (만들어진) 제목. 3D 엔진만 쓴다.
  const objsRef = useRef(new Map<string, Group>());
  const labelsRef = useRef(new Map<string, SpriteText>());
  const kindsRef = useRef(new Map<string, Kind>());
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // 전체 보기에는 중심이 없다 — 고리·고정·강조 간선을 두지 않는다.
  const drawCenter = all ? '' : center;
  const centerRef = useRef(drawCenter);
  centerRef.current = drawCenter;
  const paramsRef = useRef({ depth, mode, all });
  paramsRef.current = { depth, mode, all };
  // 카메라 움직임 설정. 엔진은 모드가 바뀔 때만 다시 만들므로 ref 로 넘기고, 바뀌면 엔진에 알린다.
  const reducedMotion = useReducedMotion();
  const motionSettings: MotionSettings = resolveMotion(motion, damping, reducedMotion);
  const motionRef = useRef(motionSettings);
  motionRef.current = motionSettings;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  // 제목 규칙. 주요 노드 집합·이웃 목록·연결 수는 지도를 그릴 때 만들고, 엔진은 프레임마다(3D) 또는 그릴 때(2D) 읽는다.
  const labelModeRef = useRef(labels);
  labelModeRef.current = labels;
  // 임베딩 묶음 상태(⚙ 설정이 켜고 색인한다). 준비되면 질의에 표지를 실어 서버가 노드에 embedCluster 를 싣게 한다.
  const embedView = useSyncExternalStore(embeddingStore.subscribe, embeddingStore.get, embeddingStore.get);
  const embedToken = embeddingToken(embedView);
  // 지금 지도의 커뮤니티(라벨 전파). 데이터를 받을 때 한 번 센다 — 묶음 기준이 커뮤니티일 때 클러스터 힘이 읽는다.
  const communityRef = useRef<Map<string, string> | null>(null);
  const majorRef = useRef<ReadonlySet<string>>(new Set());
  const adjRef = useRef<ReadonlyMap<string, string[]>>(new Map());
  const degreeRef = useRef<ReadonlyMap<string, number>>(new Map());
  // 노드별로 닿은 간선 — 호버 강조가 굵기를 바꿀 간선(3D). 데이터를 받을 때 한 번 만든다.
  const linksOfRef = useRef<ReadonlyMap<string, readonly FgLink[]>>(new Map());
  const NO_LINKS: readonly FgLink[] = [];
  // 키 상태(Shift). 엔진에 알리고, 누르는 동안 말풍선·강조를 걷는다.
  const keysRef = useRef<KeyState>(INITIAL_KEYS);
  // 범례에서 강조한 종류(kind-highlight.ts 의 저장소 — 조절 패널 범례와 캔버스 범례가 같이 쓴다). 엔진은 그릴 때 읽는다.
  const kindRef = useRef<Kind | null>(kindHover.get());

  // 펼친 허브. 세션 상태다(주소에 쓰지 않는다). 중심이 바뀌면 비운다 — A→B→A 로 돌아와도 A 의 펼침은 살아나지 않는다.
  // 깊이·모드가 바뀔 때는 그대로 둔다. 중심과 같이 두고, 중심이 다르면 그리는 중에 비운다(effect 를 기다리면 옛 펼침으로 한 번 조회한다).
  const [expanded, setExpanded] = useState<{ center: string; paths: string[] }>({ center, paths: [] });
  if (expanded.center !== center) setExpanded({ center, paths: [] });
  const expand = expanded.center === center ? expanded.paths : NO_EXPAND;
  const expandRef = useRef(expand);
  expandRef.current = expand;
  // 사용자가 고른 집합 조건(반경·허브·펼침). 이것이 바뀌어 집합이 바뀌면 멈춘 뒤 지도에 맞춘다 — 파일 변경(SSE)으로 바뀐 집합은 보던 곳을 둔다.
  const queryKey = all ? 'all' : `${depth}|${hubs}|${expand.join(',')}`;
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const drawnQueryRef = useRef<string | null>(null);
  const centerPropRef = useRef(center);
  centerPropRef.current = center;
  const addExpand = useCallback((path: string) => {
    const c = centerPropRef.current;
    setExpanded((s) => {
      const base = s.center === c ? s.paths : [];
      return base.includes(path) ? s : { center: c, paths: [...base, path] };
    });
  }, []);
  const addExpandRef = useRef(addExpand);
  addExpandRef.current = addExpand;

  const events = useContext(ChangedEventsContext);
  const query: GraphQuery = { ...(all ? { all: true as const } : { center, depth, hubs, expand }), ...(embedToken === undefined ? {} : { embed: embedToken }) };
  const { data, error, missing } = useGraphData(query, events);
  // 실제로 쓰는 묶음 기준. 임베딩을 골랐어도 군집이 없으면(꺼짐·Ollama 없음·색인 전·옛 응답) 메타로 조용히 돌아간다.
  const hasEmbed = embeddingReady(embedView) && (data?.nodes.some((n) => n.embedCluster !== undefined) ?? false);
  const effCluster = effectiveClusterMode(cluster, hasEmbed);
  const clusterRef = useRef(effCluster);
  clusterRef.current = effCluster;
  const loading = data === null && error === null && !missing;
  const [stats, setStats] = useState<GraphStats | null>(null);

  // 말풍선. hover 는 엔진이 알려 준 노드, tip 은 말풍선에 보이는 노드다 — 펼칠 수 있는 노드는 마우스가 떠나도 잠시 남는다.
  const [tip, setTipState] = useState<GraphNode | null>(null);
  const tipNodeRef = useRef<GraphNode | null>(null);
  const hoverRef = useRef<GraphNode | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const cancelHide = () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  };
  const setTip = (n: GraphNode | null) => {
    tipNodeRef.current = n;
    setTipState(n);
  };
  // 말풍선을 유예 없이 걷는다(Shift 를 누를 때). 엔진 effect 가 ref 로 부른다.
  const hideTipRef = useRef(() => {});
  hideTipRef.current = () => {
    cancelHide();
    setTip(null);
  };
  // 펼칠 수 있는 노드: 잘렸고, 전체 보기가 아니고, 아직 펼치지 않았다. 말풍선 유예·버튼·Shift+클릭이 모두 이것을 쓴다.
  const canExpand = (n: GraphNode): boolean => n.truncated && !paramsRef.current.all && !expandRef.current.includes(n.path);
  const onHoverRef = useRef((_n: GraphNode | null) => {});
  onHoverRef.current = (n) => {
    hoverRef.current = n;
    cancelHide();
    const shown = tipNodeRef.current;
    if (n !== null) setTip(n);
    else if (shown !== null && canExpand(shown)) hideTimerRef.current = window.setTimeout(() => setTip(null), TIP_GRACE_MS);
    else setTip(null);
  };

  // 이미 그린 병합 결과와 그때의 노드 모양. 엔진을 새로 만들면 비운다.
  const drawnRef = useRef<MergeResult | null>(null);
  const looksRef = useRef(new Map<string, string>());
  // 엔진이 처음 준 반발 세기. 전체 보기에서 약하게 바꾼 뒤 다른 지도로 돌아올 때 되돌린다. 엔진을 새로 만들면 비운다.
  const chargeRef = useRef<ReturnType<typeof readCharge>>(null);
  // 궤도 장식의 반지름. 집합이 바뀌어 힘을 다시 걸 때 정한다. 엔진을 새로 만들면 비운다(첫 그림이 다시 정한다).
  const orbitRadiusRef = useRef(0);
  // 지난번에 그린 지도의 중심('' 은 전체 보기). 같은 중심에서 집합만 바뀌었는지 가른다.
  const drawnCenterRef = useRef<string | null>(null);
  // 집합이 바뀌어 잠시 고정한 노드. 레이아웃이 멈추면(onEngineStop) 푼다.
  const pinnedRef = useRef(new Set<string>());

  // 엔진은 모드마다 하나다. 모드가 바뀌면 옛 엔진을 부수고 다른 엔진을 만든다. 중심이 바뀌면 데이터만 갈아 끼운다.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const colors = Object.fromEntries(KINDS.map((k) => [k, readColor(k, el)])) as Record<Kind, string>;
    const shared: Shared = {
      colors,
      center: () => centerRef.current,
      hovered: () => hoverRef.current?.path ?? null,
      clusterColor: readVar('--graph-label-2', el),
      objs: objsRef.current,
      labels: labelsRef.current,
      plus: (n) => canExpand(n),
      labelMode: () => labelModeRef.current,
      major: () => majorRef.current,
      neighbors: (path) => hoverNeighbors(path, adjRef.current, (p) => degreeRef.current.get(p) ?? 0),
      linksOf: (path) => linksOfRef.current.get(path) ?? NO_LINKS,
      bg: readVar('--graph-bg', el),
      kind: () => kindRef.current,
      clusterLabels: () =>
        showClusterLabels(labelModeRef.current, clusterRef.current) ? clusterKeyOf(clusterRef.current, communityRef.current) : null,
      orbitColor: readVar('--graph-label-2', el),
      orbitRadius: () => orbitRadiusRef.current,
      // 집합 변경 때 고정한 노드를 레이아웃이 멈춘 뒤 푼다. 중심의 고정(0,0,0)은 두고, 우리가 고정한 노드만 푼다.
      onStop: () => {
        const fg = engineRef.current?.fg;
        if (fg !== undefined) releasePins(fg.graphData().nodes, centerRef.current, pinnedRef.current);
      },
    };
    const engine = mode === '2d' ? build2d(el, shared) : build3d(el, shared);
    engine.motion(motionRef.current);
    engineRef.current = engine;
    drawnRef.current = null;
    looksRef.current = new Map();
    chargeRef.current = null;
    orbitRadiusRef.current = 0;
    drawnCenterRef.current = null;
    pinnedRef.current.clear();

    // 한 번 누르면 그 노드로 중심을 옮기고, 같은 노드를 곧바로 한 번 더 누르면 리더로 연다.
    // 중심 이동은 더블클릭 창이 닫힌 뒤에 한다 — 바로 옮기면 노드가 자리를 떠서 두 번째 클릭이 빗나간다.
    // Shift+클릭은 잘린 허브를 펼친다(말풍선의 "펼치기"와 같다).
    let lastClick: { path: string; t: number; timer: number } | null = null;
    const onClick = (n: FgNode, ev: MouseEvent) => {
      if (ev.shiftKey) {
        // 앞서 누른 보통 클릭의 중심 이동이 기다리고 있으면 취소한다 — 펼치려던 지도가 옮겨 가지 않게.
        if (lastClick !== null) window.clearTimeout(lastClick.timer);
        lastClick = null;
        if (canExpand(n)) addExpandRef.current(n.path);
        return;
      }
      const now = performance.now();
      if (lastClick !== null && lastClick.path === n.path && now - lastClick.t < DOUBLE_CLICK_MS) {
        window.clearTimeout(lastClick.timer);
        lastClick = null;
        navigateRef.current(n.path);
        return;
      }
      if (lastClick !== null) window.clearTimeout(lastClick.timer);
      const timer = window.setTimeout(() => {
        lastClick = null;
        // 깊이·모드는 그대로 두고 중심만 옮긴다. 전체 보기에서 누르면 그 노드 중심의 지도로 간다.
        const p = paramsRef.current;
        if (n.path !== centerRef.current) navigateRef.current(n.path, undefined, undefined, { view: 'graph', depth: p.depth, mode: p.mode });
      }, DOUBLE_CLICK_MS);
      lastClick = { path: n.path, t: now, timer };
    };

    configure(engine.fg, {
      bg: readVar('--graph-bg', el),
      accent: readVar('--graph-accent', el),
      colors,
      center: () => centerRef.current,
      kinds: () => kindsRef.current,
      // 3D 전체 보기(간선 9천여 개)는 간선을 원기둥 대신 선으로 그린다. 중심 지도는 가중치 굵기를 둔다.
      thin: () => mode === '3d' && paramsRef.current.all,
      hovered: () => hoverRef.current?.path ?? null,
      kind: () => kindRef.current,
      onClick,
      onHover: (n, prev) => {
        // 엔진별 표시를 고치기 전에 hover 를 적는다 — 2D 는 다시 그릴 때 이 값을 읽는다.
        onHoverRef.current(n);
        engine.hover(n, prev);
        el.style.cursor = n === null ? '' : 'pointer';
      },
    });

    // 가운데 열 크기를 따라간다.
    const ro = new ResizeObserver(() => {
      engine.fg.width(el.clientWidth);
      engine.fg.height(el.clientHeight);
    });
    ro.observe(el);

    // 키: Shift 를 누른 동안 카메라만 움직이고(노드 없는 셈), Space 는 초기 보기로 관성 전환. 입력 상자에 포커스가 있으면 글자다.
    // 마우스 이벤트의 shiftKey 로도 맞춘다 — 창 밖에서 Shift 를 떼면 keyup 이 안 온다.
    const applyKeys = (input: KeyInput) => {
      const prev = keysRef.current;
      const { state, reset } = keyStep(prev, input);
      if (state.shift !== prev.shift) {
        keysRef.current = state;
        if (state.shift) {
          // 호버 중이던 노드의 말풍선·강조를 걷는다. 라이브러리는 hoverObj 만 비우고 onHover 를 부르지 않는다.
          onHoverRef.current(null);
          hideTipRef.current();
          engine.hover(null, hoverRef.current);
        }
        engine.setShift(state.shift);
      }
      if (reset) engine.reset(engine.fg.graphData().nodes.length);
    };
    const typing = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement ? isTypingTarget(t.tagName, t.isContentEditable) : false;
    const onKeyDown = (ev: KeyboardEvent) => {
      const isTyping = typing(ev.target);
      if (!isTyping && (ev.key === ' ' || ev.key === 'Spacebar')) ev.preventDefault();
      applyKeys({ type: 'keydown', key: ev.key, typing: isTyping });
    };
    const onKeyUp = (ev: KeyboardEvent) => applyKeys({ type: 'keyup', key: ev.key, typing: typing(ev.target) });
    const onBlur = () => applyKeys({ type: 'blur' });
    const onPointer = (ev: PointerEvent) => applyKeys({ type: 'pointer', shiftKey: ev.shiftKey });
    // 범례 종류 강조. 범례에 들어오면 남아 있던 노드 호버(라이브러리는 캔버스를 떠나도 hover 를 풀지 않는다)를 걷는다 —
    // 노드 호버가 있으면 노드 호버가 이기므로, 걷지 않으면 마지막으로 지나친 노드 때문에 범례 강조가 안 보인다.
    // 다시 그리기는 스타일만(engine.highlightKind) — refresh·reheat 를 부르지 않는다.
    const offKind = kindHover.subscribe((k) => {
      kindRef.current = k;
      if (k !== null && hoverRef.current !== null) {
        const prev = hoverRef.current;
        onHoverRef.current(null);
        hideTipRef.current();
        engine.hover(null, prev as FgNode);
      }
      engine.highlightKind();
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    // 캡처 단계에서 — 캔버스의 라이브러리 리스너(노드 드래그·호버)보다 먼저 Shift 를 반영해야 그 pointerdown 이 노드를 잡지 않는다.
    el.addEventListener('pointermove', onPointer, true);
    el.addEventListener('pointerdown', onPointer, true);

    return () => {
      offKind();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointermove', onPointer, true);
      el.removeEventListener('pointerdown', onPointer, true);
      keysRef.current = INITIAL_KEYS;
      ro.disconnect();
      if (lastClick !== null) window.clearTimeout(lastClick.timer);
      engine.dispose();
      engineRef.current = null;
      objsRef.current.clear();
      labelsRef.current.clear();
      // _destructor 는 캔버스를 남긴다. 다시 마운트될 때 둘이 겹치지 않게 비운다.
      el.replaceChildren();
    };
  }, [mode]);

  // 중심·모드·전체 보기가 바뀌면 말풍선을 걷는다(옛 지도의 노드다).
  useEffect(() => {
    hoverRef.current = null;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    tipNodeRef.current = null;
    setTipState(null);
  }, [center, mode, all]);

  // 제목 표시 설정이 바뀌면 제목만 다시 정한다(3D 는 프레임마다 읽으므로 2D 만 다시 그린다).
  useEffect(() => {
    engineRef.current?.relabel();
  }, [labels]);

  // 움직임 설정이 바뀌면 엔진에 알린다(엔진을 새로 만들 때는 만들면서 넣는다).
  useEffect(() => {
    engineRef.current?.motion(motionSettings);
  }, [motionSettings.smooth, motionSettings.damping, motionSettings.transitionMs]);

  // 자동 회전 — 엔진을 새로 만들 때(모드 전환)와 설정이 바뀔 때. 2D 엔진은 무시한다.
  useEffect(() => {
    engineRef.current?.autoRotate(rotate === 'auto');
  }, [rotate, mode]);

  // 궤도 장식 — 엔진을 새로 만들 때(모드 전환)와 설정이 바뀔 때. 2D 엔진은 무시한다.
  useEffect(() => {
    engineRef.current?.orbit(orbit === 'on');
  }, [orbit, mode]);

  // 묶음 기준이 바뀌면 힘만 바꿔 끼우고 레이아웃을 살짝 데운다 — 그린 지도가 새 기준으로 다시 모인다.
  useEffect(() => {
    const fg = engineRef.current?.fg;
    if (fg === undefined || drawnRef.current === null) return;
    applyClusterMode(fg, effCluster, communityRef.current);
    fg.d3ReheatSimulation?.();
  }, [effCluster]);

  // 지도가 사라지면 범례 요약도 걷는다.
  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      onStatsRef.current?.(null);
    },
    [],
  );

  // 받은 지도를 그린다. 같은 경로의 노드는 merge 가 옛 객체를 그대로 넘기므로 좌표가 남는다.
  // 엔진 effect 보다 뒤에 있어 모드가 바뀐 같은 커밋에서 새 엔진에 처음부터 그린다.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) return;
    const fg = engine.fg;
    if (data === null) {
      // 첫 조회부터 실패했다. 옛 중심의 지도를 남기지 않는다.
      if (error !== null || missing) fg.graphData({ nodes: [], links: [] });
      return;
    }
    if (data === drawnRef.current) return;
    const first = drawnRef.current === null;
    drawnRef.current = data;
    const c = centerRef.current;
    // 남아 있는 노드의 모양이 바뀌었는가(제목·종류·연결 수·허브). merge 가 노드 객체를 고쳐 쓰므로 객체끼리는 비교할 수 없어 값을 적어 둔다.
    // 3D 라이브러리는 노드 객체가 같으면 물체를 다시 만들지 않는다 — 다시 데울 때(reheat)도 남은 노드는 따로 다시 칠해야 한다.
    const ex = expandRef.current;
    const looks = new Map(data.nodes.map((n) => [n.path, lookOf(n, n.path === c, ex.includes(n.path))]));
    const old = looksRef.current;
    const restyle = !first && [...looks].some(([p, l]) => old.has(p) && old.get(p) !== l);
    looksRef.current = looks;
    kindsRef.current = new Map(data.nodes.map((n) => [n.path, n.kind]));
    // 주요 노드(중심·허브·연결 수 상위)와 호버 이웃 조회에 쓰는 표. 집합이 그대로여도 연결 수가 바뀌면 상위가 바뀐다.
    majorRef.current = selectMajor(data.nodes, c);
    adjRef.current = adjacencyOf(data.links);
    linksOfRef.current = linksByNode(data.links as FgLink[]);
    degreeRef.current = new Map(data.nodes.map((n) => [n.path, degreeOf(n)]));
    // 커뮤니티는 집합이 바뀔 때 한 번 센다(간선 수에 선형). 묶음 기준이 커뮤니티가 아니어도 세 둔다 — 바꿀 때 바로 쓰게.
    communityRef.current = labelPropagation(
      data.nodes.map((n) => n.path),
      data.links.map((l) => ({ source: l.source, target: l.target, weight: l.weight })),
    );
    const counts = kindCounts(data.nodes);
    const next: GraphStats = {
      kinds: KINDS.filter((k) => counts.has(k)),
      nodes: data.nodes.length,
      links: data.links.length,
      counts: Object.fromEntries(counts) as Partial<Record<Kind, number>>,
    };
    setStats(next);
    onStatsRef.current?.(next);
    // 집합도 가중치도 그대로면 모양만 다시 칠한다(모양도 그대로면 아무것도 하지 않는다).
    if (!first && !data.reheat && !data.changed) {
      if (restyle) engine.restyle();
      return;
    }
    // 같은 중심(또는 전체 보기)에서 집합만 바뀌었다(깊이·허브·펼침·파일 변경). 남은 노드는 지금 자리에 잠시 고정해
    // 다시 데워도 흔들리지 않게 한다 — 새 노드만 자리를 찾는다. 레이아웃이 멈추면 shared.onStop 이 푼다.
    // 첫 그림과 중심(전체 보기) 변경은 처음부터 놓는다. 중심은 어느 쪽이든 원점에 고정한다.
    const sameCenter = !first && drawnCenterRef.current === c;
    drawnCenterRef.current = c;
    const userChangedSet = drawnQueryRef.current !== null && drawnQueryRef.current !== queryKeyRef.current;
    drawnQueryRef.current = queryKeyRef.current;
    // 중심이 바뀌었고 새 중심이 옛 지도에 있던 노드면(노드 클릭·검색), 그 노드가 지금 자리에서 원점으로 점프하지 않게
    // 지도 전체를 그만큼 옮기고 카메라도 같이 옮긴다 — 화면은 그대로다. 그 뒤 카메라가 집 보기로 미끄러지며 새 중심이 가운데로 온다.
    if (!first && !sameCenter && c !== '') {
      const target = data.nodes.find((n) => n.path === c);
      if (target !== undefined && target.x !== undefined && target.y !== undefined) {
        const dx = -target.x;
        const dy = -target.y;
        const dz = -(target.z ?? 0);
        for (const n of data.nodes) {
          if (n.x === undefined || n.y === undefined) continue;
          n.x += dx;
          n.y += dy;
          if (n.z !== undefined) n.z += dz;
        }
        engine.shift(dx, dy, dz);
      }
    }
    applyPins(data.nodes, c, old, { sameCenter, reheat: data.reheat }, pinnedRef.current);
    // 사라진 노드의 물체·제목은 버린다. 남은 노드는 라이브러리가 물체를 다시 만들지 않으므로 그대로 둔다.
    const alive = new Set(data.nodes.map((n) => n.path));
    for (const p of [...objsRef.current.keys()]) if (!alive.has(p)) objsRef.current.delete(p);
    for (const p of [...labelsRef.current.keys()]) if (!alive.has(p)) labelsRef.current.delete(p);
    if (first || data.reheat) {
      const R = radiusFor(data.nodes.length);
      // 궤도 장식의 반지름: 중심 지도는 가장 바깥 홉 껍질을 감싸고, 전체 보기는 고립 노드 궤도 그 자리다.
      let hops = 0;
      for (const n of data.nodes) if (n.hop > hops) hops = n.hop;
      orbitRadiusRef.current = orbitRadius(R, paramsRef.current.all, hops);
      // 중심 지도는 홉 껍질(radial), 전체 보기는 고립 노드 바깥 궤도(orbit)다. 쓰지 않는 쪽 힘은 걷는다
      // (두 라이브러리 모두 d3 simulation.force(name, null) 이 그 힘을 지운다).
      if (paramsRef.current.all) {
        fg.d3Force('radial', null);
        applyIsolatedOrbit(fg, R);
      } else {
        fg.d3Force('orbit', null);
        applyRadial(fg, R);
      }
      applyClusterMode(fg, clusterRef.current, communityRef.current);
      // 반발 = 엔진 처음 값 × 연결 수 질량(로그). 노드가 많은 전체 보기는 다시 절반. 처음 값은 이 엔진에서 한 번만 읽어 둔다.
      chargeRef.current ??= readCharge(fg);
      applyCharge(fg, data.nodes.length, chargeRef.current, R);
      // 라이브러리가 간선 끝을 노드 객체로 바꾸므로 merge 가 매번 새 간선 객체를 준다.
      // graphData 가 레이아웃을 alpha 1 로 다시 시작한다(따로 reheat 하지 않는다). 같은 중심이면 남은 노드는 위에서 고정했다.
      fg.graphData({ nodes: data.nodes, links: data.links as FgLink[] });
      if (restyle) engine.restyle();
      // 카메라: 첫 그림(엔진을 새로 만든 뒤 — 모드 전환 포함)은 먼 데서 날아들고, 중심이 바뀌면 집 보기로 미끄러지고,
      // 같은 중심에서 사용자가 집합을 바꿨으면 레이아웃이 멈춘 뒤 맞춘다. 파일 변경으로 바뀐 집합은 카메라를 두지 않는다.
      if (first) engine.goHome(data.nodes.length, { farStart: true });
      else if (!sameCenter) engine.goHome(data.nodes.length);
      else if (userChangedSet) engine.fitOnStop();
    } else {
      // 가중치만 바뀌었다. graphData 를 다시 주면 라이브러리가 레이아웃을 alpha 1 로 새로 시작해 노드가 흔들린다.
      // 그래서 지금 그려진 간선 객체에 값만 옮기고, 같은 굵기 함수를 다시 넣어 간선만 다시 칠한다.
      const byKey = new Map(data.links.map((l) => [`${l.source}\0${l.target}`, l]));
      for (const l of fg.graphData().links) {
        const n = byKey.get(`${endPath(l.source)}\0${endPath(l.target)}`);
        if (n === undefined) continue;
        l.weight = n.weight;
        l.mutual = n.mutual;
      }
      fg.linkWidth(fg.linkWidth());
      if (restyle) engine.restyle();
    }
  }, [data, error, missing, mode]);

  // 말풍선은 마우스를 따라간다. 다시 그리지 않고 위치만 옮긴다. 노드를 떠난 뒤에는 멈춰 "펼치기"를 누를 수 있게 한다.
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (hoverRef.current === null) return;
    const el = tipRef.current;
    const box = e.currentTarget.getBoundingClientRect();
    if (el) el.style.transform = `translate(${e.clientX - box.left + 14}px, ${e.clientY - box.top + 14}px)`;
  };

  const expandable = tip !== null && canExpand(tip);

  return (
    <div className="graph-wrap" onPointerMove={onPointerMove} data-agent={agent ? 'claude' : undefined} data-mode={mode}>
      <div ref={rootRef} className="graph-root" />
      {loading ? (
        <p className="notice graph-status">지도를 불러오는 중…</p>
      ) : missing ? (
        <p className="notice graph-status">중심 문서가 없다: {center}</p>
      ) : error !== null ? (
        <p className="notice graph-status">{error}</p>
      ) : null}
      <div
        ref={tipRef}
        className={expandable ? 'graph-tooltip graph-tooltip-actionable' : 'graph-tooltip'}
        hidden={tip === null}
        onPointerEnter={cancelHide}
        onPointerLeave={() => {
          if (hoverRef.current === null) setTip(null);
        }}
      >
        {tip === null ? null : (
          <>
            <strong>{tip.title}</strong>
            <span>
              {tip.kind} · in {tip.in} / out {tip.out}
            </span>
            <span className="graph-tooltip-cluster">{tip.cluster}</span>
            {tip.embedCluster === undefined ? null : <span className="graph-tooltip-cluster">임베딩 {tip.embedCluster}</span>}
            {expandable ? (
              <button
                type="button"
                className="graph-tooltip-expand"
                title="잘린 이웃을 더 불러온다(Shift+클릭도 같다)"
                onClick={() => {
                  addExpand(tip.path);
                  setTip(null);
                }}
              >
                펼치기
              </button>
            ) : null}
          </>
        )}
      </div>
      {legendInCanvas && stats !== null && data !== null && error === null ? (
        <GraphLegend kinds={stats.kinds} counts={stats.counts} nodes={stats.nodes} links={stats.links} className="graph-legend" />
      ) : null}
    </div>
  );
}

// React.lazy 는 기본 내보내기를 받는다.
export default GraphView;
