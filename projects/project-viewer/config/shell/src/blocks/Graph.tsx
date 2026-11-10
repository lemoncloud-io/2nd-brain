// graph 블록. 좌표와 배선은 layout.ts(순수)가 계산하고 여기서는 그리기만 한다.
// 그리는 순서가 곧 레이어다: 밴드 → 선 → 노드 → 라벨. 라벨이 노드 위에 와야 글자가 잘리지 않는다.
// 그림과 같은 내용을 텍스트 목록으로 병행 제공한다(화면 낭독기·그림을 못 보는 환경).

import { useEffect, useRef, useState } from 'react';

import type { GraphBlock } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';
import { describeGraph, labelTextWidth, layoutGraph, textUnits } from './layout.ts';

function useElementWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? fallback);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width];
}

// 상자보다 긴 이름은 잘라 준다. 폭 계산 기준은 layout.ts와 같다.
function clip(label: string, boxWidth: number): string {
  const budget = Math.floor((boxWidth - 18) / 7);
  let used = 0;
  let out = '';
  for (const ch of label) {
    used += textUnits(ch);
    if (used > budget) return `${out}…`;
    out += ch;
  }
  return out;
}

export function Graph({
  block,
  selectedId,
  onSelect,
}: {
  block: GraphBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [ref, width] = useElementWidth(880);
  const layout = layoutGraph(block, { width: Math.max(260, width - 20) });
  const alt = describeGraph(block);

  return (
    <div className="graph" ref={ref}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={block.title ? `${block.title} 그림` : '구조 그림'}
      >
        <defs>
          <marker id="gv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--line-strong)" />
          </marker>
          <marker id="gv-arrow-back" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M8,0 L0,4 L8,8 z" fill="var(--line-strong)" />
          </marker>
        </defs>

        {layout.bands.map((band) => (
          <g key={band.id}>
            <rect className="graph__band" x={band.x} y={band.y} width={band.w} height={band.h} rx={6} />
            <text className="graph__bandLabel" x={band.x + 10} y={band.y + 16}>
              {band.label}
            </text>
          </g>
        ))}

        {layout.edges.map((edge, i) => (
          <path
            key={`e${i}`}
            className="graph__edge"
            d={edge.d}
            strokeWidth={1.4}
            strokeDasharray={edge.style === 'dashed' ? '5 4' : undefined}
            markerEnd="url(#gv-arrow)"
            markerStart={edge.both ? 'url(#gv-arrow-back)' : undefined}
          />
        ))}

        {layout.nodes.map((node) => (
          <g
            key={node.id}
            className="graph__node"
            role="button"
            tabIndex={0}
            aria-current={selectedId === node.id ? 'true' : undefined}
            aria-label={node.label}
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
          >
            <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={6} />
            <text x={node.x + node.w / 2} y={node.y + node.h / 2 + 5} textAnchor="middle">
              {clip(node.label, node.w)}
            </text>
          </g>
        ))}

        {layout.edges.map((edge, i) =>
          edge.labelBox ? (
            <g key={`l${i}`}>
              <rect
                className="graph__edgeLabelBg"
                x={edge.labelBox.x}
                y={edge.labelBox.y}
                width={edge.labelBox.w}
                height={edge.labelBox.h}
                rx={3}
              />
              <text
                className="graph__edgeLabel"
                x={edge.labelBox.x + edge.labelBox.w / 2}
                y={edge.labelBox.y + edge.labelBox.h - 4}
                textAnchor="middle"
                textLength={labelTextWidth(edge.labelBox.text)}
                lengthAdjust="spacingAndGlyphs"
              >
                {edge.labelBox.text}
              </text>
            </g>
          ) : null,
        )}
      </svg>

      <details className="graph__alt">
        <summary>같은 내용을 글로 보기 ({alt.length}개 노드)</summary>
        <ul className="graph__altList">
          {alt.map((entry) => (
            <li key={entry.nodeId}>
              <button type="button" className="cellbtn" onClick={() => onSelect(entry.nodeId)}>
                <Inline text={entry.label} refs={false} />
              </button>
              {entry.group ? <span className="muted"> · {entry.group}</span> : null}
              {entry.links.length > 0 ? <span className="muted"> · {entry.links.join(', ')}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
