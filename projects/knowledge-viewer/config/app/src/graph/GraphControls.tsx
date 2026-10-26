// 지도 조절 패널(오른쪽 열). 깊이·2D/3D·전체 보기는 주소가 상태이고, 허브 펼침은 세션 상태, 제목 표시는 브라우저 설정(prefs)이다 — 값은 App 이 갖는다.
// 그래프 라이브러리를 불러오지 않는다(index 청크에 들어간다). 범례도 여기 하나다 — 지도 캔버스는 오른쪽 열이 안 보일 때만 같은 범례를 띄운다.
// 범례의 종류에 마우스를 올리거나 포커스하면 그 종류를 강조한다(kind-highlight.ts 저장소 → GraphView). 두 범례가 같은 동작이다.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type React from 'react';

import type { Kind } from '../../shared/kind.ts';
import type { GraphDepth, GraphMode } from '../app/route.ts';
import { ROTATE_MODES } from './autorotate.ts';
import type { RotateMode } from './autorotate.ts';
import { clusterModes, effectiveClusterMode } from './cluster-mode.ts';
import type { ClusterMode } from './cluster-mode.ts';
import { embeddingDisabledReason, embeddingReady, embeddingStore } from './embedding.ts';
import { LABEL_MODES } from './labels.ts';
import type { LabelMode } from './labels.ts';
import { kindHover } from './kind-highlight.ts';
import { DAMPING_LEVELS, MOTION_MODES } from './motion.ts';
import type { DampingLevel, MotionMode } from './motion.ts';
import { ORBIT_MODES } from './orbit.ts';
import type { OrbitMode } from './orbit.ts';
import { colorVarOf } from './palette.ts';

export type GraphHubs = 'keep' | 'expand';
export type GraphControlValues = {
  depth: GraphDepth;
  mode: GraphMode;
  all: boolean;
  hubs: GraphHubs;
  labels: LabelMode;
  motion: MotionMode;
  damping: DampingLevel;
  /** 묶음(클러스터 힘) 기준. */
  cluster: ClusterMode;
  /** 자동 회전(3D). */
  rotate: RotateMode;
  /** 구 경위선 궤도 장식(3D). */
  orbit: OrbitMode;
};
/** 지도가 다 그린 뒤 알려 주는 요약. 범례가 쓴다. counts 는 종류별 노드 수다. */
export type GraphStats = { kinds: Kind[]; nodes: number; links: number; counts?: Partial<Record<Kind, number>> };

type Props = GraphControlValues & {
  onChange: (next: Partial<GraphControlValues>) => void;
  /** 지금 지도에 있는 문서 종류. */
  legend: Kind[];
  /** 지금 지도의 노드 수. 아직 그리지 않았으면 없다. */
  nodes?: number;
  /** 지금 지도의 간선 수. */
  links?: number;
};

const DEPTHS: readonly GraphDepth[] = [1, 2, 3];
const MODES: readonly { mode: GraphMode; label: string }[] = [
  { mode: '3d', label: '3D' },
  { mode: '2d', label: '2D' },
];

const subscribeKind = (fn: () => void) => kindHover.subscribe(fn);

/**
 * 문서 종류 범례. 조절 패널과(오른쪽 열이 숨었을 때) 지도 캔버스가 같이 쓴다. 종류마다 단추 하나 — 마우스를 올리거나 포커스하면
 * 그 종류를 강조하고, 범례를 벗어나면(포커스가 범례 밖으로 가면) 걷는다. 항목 사이를 옮길 때는 걷지 않고 바로 바꾼다
 * (걷고 다시 켜면 전체 보기에서 간선 색을 두 번 칠한다). counts 를 주면 종류 옆에 노드 수를 적는다.
 */
export function GraphLegend({
  kinds,
  counts,
  nodes,
  links,
  className,
}: {
  kinds: Kind[];
  counts?: Partial<Record<Kind, number>>;
  nodes?: number;
  links?: number;
  className: string;
}) {
  const active = useSyncExternalStore(subscribeKind, kindHover.get, () => null);
  // 이 범례가 켠 강조. 범례가 사라지면(오른쪽 열을 펴고 접을 때) mouseleave 가 오지 않으므로 걷는다.
  const ownRef = useRef(false);
  const set = (k: Kind | null) => {
    ownRef.current = k !== null;
    kindHover.set(k);
  };
  useEffect(
    () => () => {
      if (ownRef.current) kindHover.set(null);
    },
    [],
  );
  const onBlur = (e: React.FocusEvent<HTMLUListElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set(null);
  };
  return (
    <ul className={className} aria-label="문서 종류" onPointerLeave={() => set(null)} onBlur={onBlur}>
      {kinds.map((k) => {
        const n = counts?.[k];
        return (
          <li key={k}>
            <button
              type="button"
              className="graph-legend-item"
              data-active={active === k ? 'true' : undefined}
              aria-label={n === undefined ? `${k} 강조` : `${k} ${n}개 강조`}
              title={n === undefined ? k : `${k} · ${n}`}
              onPointerEnter={() => set(k)}
              onFocus={() => set(k)}
            >
              <span className="graph-swatch" style={{ background: `var(${colorVarOf(k)})` }} />
              <span className="graph-legend-name">{k}</span>
              {n === undefined ? null : <span className="graph-legend-n">{n}</span>}
            </button>
          </li>
        );
      })}
      {nodes === undefined ? null : <li className="graph-legend-count">
          노드 {nodes}
          {links === undefined ? null : ` · 간선 ${links}`}
        </li>}
    </ul>
  );
}

export function GraphControls({ depth, mode, all, hubs, labels, motion, damping, cluster, rotate, orbit, onChange, legend, nodes, links }: Props) {
  // 임베딩 묶음: 서버가 쓸 수 있다고 알릴 때만 선택지가 나오고, 켜고 색인해 군집이 준비돼야 고를 수 있다. 아니면 메타가 찍힌다.
  const embed = useSyncExternalStore(embeddingStore.subscribe, embeddingStore.get, embeddingStore.get);
  const embedOff = embeddingDisabledReason(embed);
  const shownCluster = effectiveClusterMode(cluster, embeddingReady(embed));
  return (
    <div className="graph-controls">
      {/* 전체 보기는 중심이 없어 깊이·허브 펼침이 쓰이지 않는다. */}
      <fieldset className="graph-controls-row" disabled={all}>
        <legend>반경</legend>
        {DEPTHS.map((d) => (
          <label key={d}>
            <input type="radio" name="graph-depth" value={d} checked={depth === d} onChange={() => onChange({ depth: d })} />
            {d}
          </label>
        ))}
      </fieldset>
      <div className="graph-controls-row" role="group" aria-label="그리기 방식">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className="graph-mode"
            aria-pressed={mode === m.mode}
            onClick={() => mode !== m.mode && onChange({ mode: m.mode })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="graph-controls-check">
        <input type="checkbox" checked={all} onChange={(e) => onChange({ all: e.target.checked })} />
        전체 보기
      </label>
      <label className="graph-controls-check">
        <input
          type="checkbox"
          checked={hubs === 'expand'}
          disabled={all}
          onChange={(e) => onChange({ hubs: e.target.checked ? 'expand' : 'keep' })}
        />
        허브 펼침
      </label>
      {/* 묶음: 메타(종류·폴더)가 기본. 커뮤니티는 링크로 찾은 묶음(라벨 전파), 임베딩은 본문 임베딩 군집(선택), 없음은 힘을 걷는다. 색은 늘 종류다. */}
      <fieldset className="graph-controls-row">
        <legend>묶음</legend>
        {clusterModes(embed.available).map((m) => {
          const off = m.mode === 'embedding' ? embedOff : null;
          return (
            <label key={m.mode} title={off ?? m.title}>
              <input
                type="radio"
                name="graph-cluster"
                value={m.mode}
                checked={shownCluster === m.mode}
                disabled={off !== null}
                onChange={() => onChange({ cluster: m.mode })}
              />
              {m.label}
            </label>
          );
        })}
      </fieldset>
      {/* 제목은 기본으로 주요 노드(중심·허브·연결 수 상위)만 보인다. 나머지는 마우스를 올리면 보인다. */}
      <fieldset className="graph-controls-row">
        <legend>제목</legend>
        {LABEL_MODES.map((m) => (
          <label key={m.mode}>
            <input type="radio" name="graph-labels" value={m.mode} checked={labels === m.mode} onChange={() => onChange({ labels: m.mode })} />
            {m.label}
          </label>
        ))}
      </fieldset>
      {/* 카메라 움직임: 부드럽게(관성·전환)가 기본이다. 바로는 입력을 그대로 따른다(OS 의 움직임 줄이기 설정도 바로다). */}
      <fieldset className="graph-controls-row">
        <legend>움직임</legend>
        {MOTION_MODES.map((m) => (
          <label key={m.mode}>
            <input type="radio" name="graph-motion" value={m.mode} checked={motion === m.mode} onChange={() => onChange({ motion: m.mode })} />
            {m.label}
          </label>
        ))}
      </fieldset>
      {/* 감쇠 강도: 약할수록 손을 놓은 뒤 오래 미끄러진다. 바로 모드에서는 쓰이지 않는다. */}
      <fieldset className="graph-controls-row" disabled={motion === 'instant'}>
        <legend>감쇠</legend>
        {DAMPING_LEVELS.map((d) => (
          <label key={d.level} title={`프레임마다 속도 × ${d.damping}`}>
            <input type="radio" name="graph-damping" value={d.level} checked={damping === d.level} onChange={() => onChange({ damping: d.level })} />
            {d.label}
          </label>
        ))}
      </fieldset>
      {/* 자동 회전: 손을 놓고 있으면 3D 지도가 천천히 돈다. 입력·호버·전환 중엔 멈추고, 2D·바로 모드에선 쓰이지 않는다. */}
      <fieldset className="graph-controls-row" disabled={mode === '2d' || motion === 'instant'} title={mode === '2d' ? '3D 에서만' : undefined}>
        <legend>회전</legend>
        {ROTATE_MODES.map((m) => (
          <label key={m.mode}>
            <input type="radio" name="graph-rotate" value={m.mode} checked={rotate === m.mode} onChange={() => onChange({ rotate: m.mode })} />
            {m.label}
          </label>
        ))}
      </fieldset>
      {/* 궤도 장식: 노드 뭉치 바깥의 희미한 구 경위선(3D). 데이터와 무관한 장식이다. */}
      <fieldset className="graph-controls-row" disabled={mode === '2d'} title={mode === '2d' ? '3D 에서만' : undefined}>
        <legend>궤도</legend>
        {ORBIT_MODES.map((m) => (
          <label key={m.mode}>
            <input type="radio" name="graph-orbit" value={m.mode} checked={orbit === m.mode} onChange={() => onChange({ orbit: m.mode })} />
            {m.label}
          </label>
        ))}
      </fieldset>
      <GraphLegend kinds={legend} nodes={nodes} links={links} className="graph-controls-legend" />
    </div>
  );
}
