// 단계 흐름 그림. 순서·상태·선후는 flowlayout.ts(순수)가 정하고 여기서는 그리기만 한다.
// 최상위 단계(마일스톤)는 위쪽 가로 한 줄 파이프라인이다. 칸은 폭이 모자라면 먼저 작은 칸(최소 120px)으로
// 줄고, 그래도 모자라면 그 줄만 가로로 굴러간다(첫 화면은 지금 단계를 가운데에). 하위 단계는 파이프라인 아래
// 전체 폭의 "<부모> 묶음" 칸에 폭에 맞춰 줄을 바꾸며 깔리고, 부모 칸에서 내려오는 짧은 선으로 이어진다.
// after는 선 대신 각 칸의 "← 먼저" 표지로 보이고, 마우스를 올리면 앞뒤 단계가 함께 밝아진다.
// 움직임(진행 중 선의 흐름·진행 중 단계의 숨 쉬는 테·엇갈린 등장)은 prefers-reduced-motion이면 모두 멈춘다.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Bundle, StagesBlock } from '../../model/types.ts';
import { statusLabel, statusMarks } from './StatusBadge.tsx';
import { buildFlow, centerScroll, describeNode, plain, relatedTo, subtitle } from './flowlayout.ts';
import type { FlowNode } from './flowlayout.ts';

const STAGGER_MS = 60;

function Bar({ node }: { node: FlowNode }): React.ReactElement | null {
  const { done, total } = node.progress;
  if (total === 0) return null;
  return (
    <span className="flow__bar">
      <span className="flow__track" aria-hidden="true">
        <span className={`flow__fill flow__fill--${node.tone}`} style={{ width: `${Math.round((done / total) * 1000) / 10}%` }} />
      </span>
      <span className="flow__count">
        {done}/{total}
      </span>
    </span>
  );
}

function Deps({ node }: { node: FlowNode }): React.ReactElement | null {
  if (node.deps.length === 0) return null;
  return (
    <span className="flow__deps" aria-hidden="true">
      {node.deps.map((d) => (
        <span key={d.id} className={`flow__dep flow__dep--${d.state}`} title={d.state === 'done' ? '먼저 끝나야 함 — 끝남' : '먼저 끝나야 함 — 남음'}>
          ← {d.short}
        </span>
      ))}
    </span>
  );
}

function NodeButton({
  node,
  label,
  marks,
  hl,
  dim,
  selected,
  onEnter,
  onLeave,
  onPick,
}: {
  node: FlowNode;
  label: string;
  marks: { pulse: boolean; struck: boolean };
  hl: boolean;
  dim: boolean;
  selected: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPick: () => void;
}): React.ReactElement {
  const main = node.level === 0;
  const cls = [
    main ? 'flow__node' : 'flow__kid',
    `flow__tone--${node.tone}`,
    `flow__state--${node.state}`,
    node.current ? 'is-current' : '',
    marks.struck ? 'is-struck' : '',
    hl ? 'is-hl' : '',
    dim ? 'is-dim' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const sub = subtitle(node.stage);
  return (
    <button
      type="button"
      className={cls}
      style={{ animationDelay: `${node.order * STAGGER_MS}ms` }}
      aria-label={describeNode(node, label)}
      aria-current={selected ? 'true' : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onPick}
    >
      <span className="flow__head">
        <span className="flow__short">{plain(node.stage.short ?? node.stage.title)}</span>
        <span className={`flow__pill flow__pill--${node.tone}${marks.pulse ? ' flow__pill--pulse' : ''}`}>{label}</span>
      </span>
      {sub ? <span className="flow__sub">{sub}</span> : null}
      <Deps node={node} />
      <Bar node={node} />
    </button>
  );
}

export function StageFlow({
  bundle,
  block,
  selectedId,
  onPick,
}: {
  bundle: Bundle;
  block: StagesBlock;
  selectedId: string | null;
  onPick: (id: string) => void;
}): React.ReactElement {
  const model = useMemo(() => buildFlow(block, bundle.status), [block, bundle]);
  const [hover, setHover] = useState<string | null>(null);
  const rel = hover === null ? null : relatedTo(model, hover);

  const scroller = useRef<HTMLDivElement>(null);
  // 파이프라인이 넘치면 첫 화면에서 지금 단계가 보이게 한 번만 굴린다(서버 렌더에서는 돌지 않는다)
  useLayoutEffect(() => {
    const box = scroller.current;
    const now = box?.querySelector<HTMLElement>('.flow__stop.is-now');
    if (!box || !now) return;
    box.scrollLeft = centerScroll(now.offsetLeft, now.offsetWidth, box.clientWidth, box.scrollWidth);
  }, [model.currentId]);

  const button = (node: FlowNode) => (
    <NodeButton
      key={node.id}
      node={node}
      label={statusLabel(bundle.status[node.id])}
      marks={statusMarks(bundle.status[node.id])}
      hl={rel?.nodes.has(node.id) ?? false}
      dim={rel !== null && !rel.nodes.has(node.id)}
      selected={selectedId === node.id}
      onEnter={() => setHover(node.id)}
      onLeave={() => setHover((h) => (h === node.id ? null : h))}
      onPick={() => onPick(node.id)}
    />
  );

  return (
    <div className={`flow${rel ? ' flow--hover' : ''}`}>
      <div className="flow__board">
        <div className="flow__scroll" ref={scroller}>
          <ol
            className={`flow__pipe${model.groups.length > 0 ? ' flow__pipe--groups' : ''}`}
            style={{ '--flow-n': model.stops.length } as React.CSSProperties}
            aria-label={block.title ? `${block.title} 흐름` : '단계 흐름'}
          >
            {model.stops.map((stop) => (
              <li
                key={stop.node.id}
                className={`flow__stop${stop.node.current ? ' is-now' : ''}${stop.kids.length > 0 ? ' flow__stop--group' : ''}`}
              >
                {stop.node.current ? (
                  <span className="flow__now" aria-hidden="true">
                    지금 ▼
                  </span>
                ) : null}
                {button(stop.node)}
                {stop.rail ? (
                  <span
                    className={`flow__rail flow__rail--${stop.rail.state}${rel?.rails.has(stop.rail.id) ? ' is-hl' : ''}`}
                    aria-hidden="true"
                  />
                ) : null}
                {stop.kids.length > 0 ? (
                  <span
                    className={`flow__notch flow__notch--${stop.node.tone}${rel?.nodes.has(stop.node.id) ? ' is-hl' : ''}`}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        {model.groups.map((stop) => (
          <div
            key={stop.node.id}
            className={`flow__lane flow__lane--${stop.node.tone}${rel?.nodes.has(stop.node.id) ? ' is-hl' : ''}`}
            role="group"
            aria-label={stop.label}
          >
            <span className="flow__laneLabel" aria-hidden="true">
              {stop.label}
            </span>
            <div className="flow__kids">{stop.kids.map(button)}</div>
          </div>
        ))}
      </div>
      <div className="flow__legend" aria-hidden="true">
        <span className="flow__key flow__key--done">끝난 구간</span>
        <span className="flow__key flow__key--doing">진행 중</span>
        <span className="flow__key flow__key--todo">남은 구간</span>
        <span className="flow__key flow__key--dep">← 먼저 끝나야 할 단계(초록 끝남 · 호박 남음)</span>
      </div>
    </div>
  );
}
