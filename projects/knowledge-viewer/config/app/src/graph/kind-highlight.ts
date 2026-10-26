// 범례 종류 강조(순수). 범례의 한 종류에 마우스를 올리면(키보드 포커스도 같다) 그 종류의 노드만 본래 밝기로 두고,
// 나머지 노드·간선·제목은 노드 호버의 "나머지" 톤(HOVER_OTHER_ALPHA 0.25)으로 흐리게 한다. 강조된 종류의 노드는 제목을 전부 보인다 —
// 제목 선별(labels.ts 의 selectMajor·hoverNeighbors)과 겹침 제거·3D 앞쪽 규칙을 건너뛴다.
// 노드 호버가 겹치면 노드 호버가 이긴다 — 마우스가 가리키는 한 노드가 범례보다 구체적이다.
//
// 상태(지금 강조한 종류)도 여기 둔다. 범례는 둘이고(조절 패널 안, 캔버스 위) 조절 패널은 App 의 오른쪽 열이라 GraphView 와
// props 로 이어지지 않는다 — App 을 거치지 않게 모듈 하나의 작은 저장소로 잇는다. DOM·라이브러리를 부르지 않는다.
// 두 엔진·GraphView·GraphLegend 가 쓰고 tests/ui/graph-kind-highlight.test.ts 가 지킨다.
import type { Kind } from '../../shared/kind.ts';
import { HOVER_OTHER_ALPHA } from './interaction.ts';

/** 종류 강조에서 흐린 노드·간선·제목의 불투명도 배수. 노드 호버의 "나머지" 톤과 같다. */
export const KIND_OFF_ALPHA = HOVER_OTHER_ALPHA;

/** 노드(또는 간선)의 강조 상태 — 강조가 없으면 none, 강조한 종류면 on, 아니면 off(흐리게). */
export type KindMark = 'none' | 'on' | 'off';

/** 실제로 적용할 강조 종류. 노드를 호버하고 있으면 노드 호버가 이기므로 null 이다. */
export function activeKind(hoveredKind: Kind | null, hoveredNode: string | null): Kind | null {
  return hoveredNode !== null ? null : hoveredKind;
}

/** 노드 하나의 판정. hoveredNode 를 주면 노드 호버 우선 규칙까지 본다. */
export function kindHighlight(node: { kind: Kind }, hoveredKind: Kind | null, hoveredNode: string | null = null): KindMark {
  const k = activeKind(hoveredKind, hoveredNode);
  if (k === null) return 'none';
  return node.kind === k ? 'on' : 'off';
}

/** 간선의 판정. 두 끝이 모두 강조한 종류일 때만 본래 색이고, 한쪽이라도 다른 종류면 흐리게 한다. */
export function kindLinkHighlight(sourceKind: Kind | undefined, targetKind: Kind | undefined, kind: Kind | null): KindMark {
  if (kind === null) return 'none';
  return sourceKind === kind && targetKind === kind ? 'on' : 'off';
}

/** 노드 하나의 제목 자리 — force 는 겹침·앞쪽 규칙과 무관하게 늘 보이고, candidate 는 보통 후보(겹침 제거를 거친다), skip 은 안 그린다. */
export type LabelRole = 'force' | 'candidate' | 'skip';

/**
 * 제목 후보 합치기. base 는 부르는 쪽의 기본 후보 판정(표시 설정·주요 노드·호버 이웃)이다. 여기에 강조한 종류 전부를 force 로 더한다 —
 * 선별(selectMajor·hoverNeighbors)과 표시 설정(없음 포함)을 건너뛴다. 노드를 호버하고 있으면 기본 후보만이다(노드 호버 우선).
 */
export function labelRole(node: { kind: Kind }, base: boolean, hoveredKind: Kind | null, hoveredNode: string | null = null): LabelRole {
  if (kindHighlight(node, hoveredKind, hoveredNode) === 'on') return 'force';
  return base ? 'candidate' : 'skip';
}

/** 종류별 노드 수. 범례가 종류 옆에 적는다. */
export function kindCounts(nodes: Iterable<{ kind: Kind }>): Map<Kind, number> {
  const m = new Map<Kind, number>();
  for (const n of nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
  return m;
}

/** 지금 강조한 종류를 담는 작은 저장소. 범례가 쓰고 GraphView 가 듣는다. 같은 값이면 알리지 않는다. */
export type KindHoverStore = {
  get(): Kind | null;
  set(kind: Kind | null): void;
  /** 바뀔 때마다 부른다. 돌려준 함수로 끊는다. */
  subscribe(fn: (kind: Kind | null) => void): () => void;
};

export function createKindHoverStore(): KindHoverStore {
  let current: Kind | null = null;
  const listeners = new Set<(kind: Kind | null) => void>();
  return {
    get: () => current,
    set(kind) {
      if (kind === current) return;
      current = kind;
      for (const fn of [...listeners]) fn(kind);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** 앱 하나에 하나 — 조절 패널의 범례와 캔버스 위 범례가 같은 저장소를 쓴다. */
export const kindHover: KindHoverStore = createKindHoverStore();
