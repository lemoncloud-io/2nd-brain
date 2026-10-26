// 오른쪽 열 패널 "연결 지도". 지금 문서의 1홉 이웃을 높이 200 px 의 2D 캔버스로 그린다.
// registry.ts 가 이 파일을 정적으로 불러 index 청크에 들어간다. 그래서 그래프 라이브러리(engines.ts·forces.ts)는
// 여기서 정적으로 부르지 않고, 캔버스를 만들 때 동적 import 로 불러 lazy 청크에 남긴다. 타입만은 정적으로 불러도 된다(지워진다).
import { useContext, useEffect, useRef, useState } from 'react';

import { KINDS } from '../../shared/kind.ts';
import type { Kind } from '../../shared/kind.ts';
import { ChangedEventsContext } from '../app/events.ts';
import { IconExpand } from '../app/icons.tsx';
import type { NavigateFn } from '../app/route.ts';
import type { GraphQuery } from '../app/types.ts';
import type { Engine, FgLink, FgNode } from '../graph/engines.ts';
import { selectMajor } from '../graph/labels.ts';
import type { MergeResult } from '../graph/merge.ts';
import { readColor, readVar } from '../graph/palette.ts';
import { useGraphData } from '../graph/useGraphData.ts';
import { panelState } from './graphPanelState.ts';

type Props = { path: string; agent: boolean; navigate: NavigateFn };

type Mods = { engines: typeof import('../graph/engines.ts'); forces: typeof import('../graph/forces.ts') };

export function GraphPanel({ path, agent, navigate }: Props) {
  const events = useContext(ChangedEventsContext);
  // 패널은 늘 1홉이고 허브를 자르지 않으며 펼치지 않는다.
  const query: GraphQuery = { center: path, depth: 1, hubs: 'keep', expand: [] };
  const { data, res, error, missing } = useGraphData(query, events);
  const state = panelState({ data, res, path, missing, error });
  // 그래프 라이브러리를 못 불러왔거나 엔진을 못 만들었다. 그때의 경로와 같이 둬서 다른 문서로 가면 걷힌다.
  const [loadError, setLoadError] = useState<{ path: string; message: string } | null>(null);
  const failed = loadError !== null && loadError.path === path ? loadError.message : null;
  const notice = failed !== null ? `지도를 불러오지 못했다: ${failed}` : state.notice;

  // 에이전트 모드는 캔버스 없이 한 줄만 쓴다.
  // 지금은 에이전트 모드에서 오른쪽 열이 숨어(App 이 패널을 그리지 않는다) 이 분기는 그것이 바뀔 때만 쓰인다.
  if (agent) return <p className="graph-panel-count">{state.notice ?? `1홉 ${state.count}`}</p>;

  // "크게 보기"는 미니 지도 안 오른쪽 아래의 아이콘 단추다. 캔버스 div 의 자식이 아니라 형제다 — 엔진이 그 div 의 내용을 통째로 비운다.
  return (
    <div className="graph-panel">
      <div className="graph-panel-map">
        <MiniMap path={path} data={state.current ? data : null} navigate={navigate} onError={setLoadError} />
        {notice === null ? null : <p className="notice graph-panel-status">{notice}</p>}
        <button
          type="button"
          className="icon-btn graph-panel-open"
          aria-label="크게 보기"
          title="크게 보기"
          onClick={() => navigate(path, undefined, undefined, 'graph')}
        >
          <IconExpand />
        </button>
      </div>
    </div>
  );
}

/** 캔버스. 엔진은 중심(path)마다 새로 만든다 — 노드가 적어 다시 놓아도 싸고, 첫 레이아웃 뒤 화면 맞춤도 새로 한다. */
function MiniMap({
  path,
  data,
  navigate,
  onError,
}: {
  path: string;
  data: MergeResult | null;
  navigate: NavigateFn;
  onError: (e: { path: string; message: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ engine: Engine; mods: Mods } | null>(null);
  const drawnRef = useRef<MergeResult | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const kindsRef = useRef(new Map<string, Kind>());
  // 제목을 늘 보이는 노드(중심·허브·연결 수 상위). 그릴 때 만든다. 패널에는 제목 표시 설정이 없다 — 늘 "주요만"이다.
  const majorRef = useRef<ReadonlySet<string>>(new Set());
  // 엔진이 준비될 때마다 올린다. 그리기 effect 가 이 값을 보고 다시 돈다.
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    // 동적 import 가 끝나기 전에 패널이 사라지거나 중심이 바뀌면 아무것도 만들지 않는다.
    let live = true;
    let engine: Engine | null = null;
    let ro: ResizeObserver | null = null;
    let hovered: string | null = null;
    void Promise.all([import('../graph/engines.ts'), import('../graph/forces.ts')]).then(([engines, forces]) => {
      if (!live) return;
      const colors = Object.fromEntries(KINDS.map((k) => [k, readColor(k, el)])) as Record<Kind, string>;
      const e = engines.build2d(el, {
        colors,
        center: () => path,
        hovered: () => hovered,
        clusterColor: readVar('--graph-label-2', el),
        // 미니 지도는 1홉이라 묶음 이름을 쓰지 않는다.
        clusterLabels: () => null,
        objs: new Map(),
        labels: new Map(),
        // 패널은 펼치지 않는다(펼치기는 "크게 보기"의 지도) — `+` 배지를 그리지 않는다. 집합 변경 고정도 쓰지 않는다.
        plus: () => false,
        labelMode: () => 'major',
        major: () => majorRef.current,
        neighbors: () => [],
        linksOf: () => [],
        bg: readVar('--graph-bg', el),
        onStop: () => {},
        // 미니 지도는 범례 종류 강조를 따르지 않는다(범례는 큰 지도의 것이다).
        kind: () => null,
      });
      engine = e;
      engines.configure(e.fg, {
        bg: readVar('--graph-bg', el),
        accent: readVar('--graph-accent', el),
        colors,
        center: () => path,
        kinds: () => kindsRef.current,
        thin: () => false,
        hovered: () => hovered,
        kind: () => null,
        // 누르면 리더로 그 문서를 연다. 펼치기·중심 이동은 "크게 보기"의 지도가 맡는다.
        onClick: (n: FgNode) => navigateRef.current(n.path),
        onHover: (n, prev) => {
          hovered = n?.path ?? null;
          e.hover(n, prev);
          el.style.cursor = n === null ? '' : 'pointer';
          el.title = n === null ? '' : n.title;
        },
      });
      // 오른쪽 열 폭을 따라간다.
      ro = new ResizeObserver(() => {
        e.fg.width(el.clientWidth);
        e.fg.height(el.clientHeight);
      });
      ro.observe(el);
      engineRef.current = { engine: e, mods: { engines, forces } };
      drawnRef.current = null;
      setReady((r) => r + 1);
    }).catch((err: unknown) => {
      // 청크를 못 받았거나 build2d·configure 가 던졌다. 빈 캔버스로 두지 않고 안내문을 띄운다.
      // configure 에서 던졌으면 엔진은 이미 있다 — 정리 함수가 부순다.
      if (!live) return;
      onErrorRef.current({ path, message: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      live = false;
      ro?.disconnect();
      engine?.dispose();
      engineRef.current = null;
      drawnRef.current = null;
      // _destructor 는 캔버스를 남긴다. 다음 엔진의 캔버스와 겹치지 않게 비운다.
      el.replaceChildren();
      el.style.cursor = '';
      el.title = '';
    };
  }, [path]);

  // 받은 지도를 그린다. GraphView 의 그리기를 줄인 것이다(중심 고정·방사·클러스터 힘, 가중치만 바뀌면 간선만 다시 칠하기).
  useEffect(() => {
    const cur = engineRef.current;
    if (cur === null) return;
    const { engine, mods } = cur;
    const fg = engine.fg;
    if (data === null) {
      if (drawnRef.current !== null) fg.graphData({ nodes: [], links: [] });
      drawnRef.current = null;
      return;
    }
    if (data === drawnRef.current) return;
    const first = drawnRef.current === null;
    drawnRef.current = data;
    majorRef.current = selectMajor(data.nodes, path);
    kindsRef.current = new Map(data.nodes.map((n) => [n.path, n.kind]));
    if (!first && !data.reheat && !data.changed) {
      engine.restyle();
      return;
    }
    for (const n of data.nodes) {
      if (n.path === path) {
        n.fx = 0;
        n.fy = 0;
      } else if (n.fx !== undefined) {
        delete n.fx;
        delete n.fy;
      }
    }
    if (first || data.reheat) {
      mods.forces.applyRadial(fg, mods.forces.radiusFor(data.nodes.length));
      mods.forces.applyCluster(fg);
      fg.graphData({ nodes: data.nodes, links: data.links as FgLink[] });
      fg.d3ReheatSimulation();
      engine.restyle();
    } else {
      // 가중치만 바뀌었다. 레이아웃을 다시 시작하지 않고 그려진 간선에 값만 옮긴다.
      const byKey = new Map(data.links.map((l) => [`${l.source}\0${l.target}`, l]));
      for (const l of fg.graphData().links) {
        const n = byKey.get(`${mods.engines.endPath(l.source)}\0${mods.engines.endPath(l.target)}`);
        if (n === undefined) continue;
        l.weight = n.weight;
        l.mutual = n.mutual;
      }
      fg.linkWidth(fg.linkWidth());
      engine.restyle();
    }
  }, [data, path, ready]);

  return <div ref={rootRef} className="graph-panel-canvas" />;
}
