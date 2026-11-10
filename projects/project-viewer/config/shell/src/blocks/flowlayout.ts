// 단계 묶음(parent)과 선후(after)의 순수 계산. 띠(StageStrip)와 흐름 그림(StageFlow)이 함께 쓴다.
// DOM을 건드리지 않으므로 node --test로 그대로 돌린다. 좌표는 계산하지 않는다 — 흐름 그림은
// 최상위 단계를 가로 한 줄 파이프라인으로, 하위 단계를 그 아래 부모 묶음 칸에 CSS 그리드로 흘려 놓으므로
// 폭에 따라 칸이 줄어들고(파이프라인) 줄이 바뀐다(묶음 칸).
// parent·after를 하나도 쓰지 않은 블록은 여기의 어떤 결과도 화면에 쓰지 않는다(옛 화면 그대로).

import type { Stage, StagesBlock, StatusView, Tone } from '../../model/types.ts';

export type FlowState = 'done' | 'doing' | 'blocked' | 'todo';

/** parent나 after를 쓴 단계가 하나라도 있는가 — 묶음 띠와 흐름 보기를 켜는 유일한 조건이다. */
export function hasStageLinks(block: StagesBlock): boolean {
  return block.stages.some((s) => s.parent !== undefined || (s.after?.length ?? 0) > 0);
}

export function toneOf(view: StatusView | undefined): Tone {
  return view?.origin === 'none' ? 'muted' : view?.tone ?? 'muted';
}

/** 상태 어휘는 프로젝트마다 다르므로 done 플래그와 tone으로만 판정한다. */
export function stageState(view: StatusView | undefined): FlowState {
  if (view?.done === true) return 'done';
  const tone = toneOf(view);
  if (tone === 'blue' || tone === 'amber') return 'doing';
  if (tone === 'red') return 'blocked';
  return 'todo';
}

export interface StageGroup {
  stage: Stage;
  children: Stage[];
}

/** 최상위 단계를 원래 순서로 두고, 하위 단계를 그 부모 아래에 원래 순서로 모은다. */
export function groupStages(stages: Stage[]): StageGroup[] {
  const ids = new Set(stages.map((s) => s.id));
  // 끊긴 parent는 check가 막는다. 그래도 들어오면 최상위로 둬서 사라지지 않게 한다.
  const isTop = (s: Stage) => s.parent === undefined || !ids.has(s.parent) || s.parent === s.id;
  return stages
    .filter(isTop)
    .map((stage) => ({ stage, children: stages.filter((c) => !isTop(c) && c.parent === stage.id) }));
}

export interface Progress {
  done: number;
  total: number;
  from: 'items' | 'children' | 'none';
}

/** 자기 항목이 있으면 항목 통과 수, 없고 하위 단계가 있으면 끝난 하위 단계 수. */
export function stageProgress(stage: Stage, children: Stage[], status: Record<string, StatusView>): Progress {
  const items = stage.items ?? [];
  if (items.length > 0) {
    return { done: items.filter((i) => status[i.id]?.done === true).length, total: items.length, from: 'items' };
  }
  if (children.length > 0) {
    return { done: children.filter((c) => status[c.id]?.done === true).length, total: children.length, from: 'children' };
  }
  return { done: 0, total: 0, from: 'none' };
}

// ── 흐름 모형 ────────────────────────────────────────────────────────────────

export type RailState = 'done' | 'doing' | 'todo';

/** 먼저 끝나야 하는 단계 하나. 끝났으면 done(초록), 아니면 blocking(호박). */
export interface FlowDep {
  id: string;
  short: string;
  state: 'done' | 'blocking';
}

export interface FlowNode {
  id: string;
  stage: Stage;
  level: 0 | 1;
  parent?: string;
  state: FlowState;
  tone: Tone;
  progress: Progress;
  current: boolean;
  order: number; // 보이는 순서 = 초점 순서 = 엇갈린 등장의 지연
  deps: FlowDep[]; // 이 단계의 after
  dependents: string[]; // 이 단계를 after로 둔 단계
}

/** 가로 파이프라인의 한 정거장: 최상위 단계 하나, 다음 정거장으로 가는 선, 그리고 그 아래 묶음 칸의 하위 단계. */
export interface FlowStop {
  node: FlowNode;
  kids: FlowNode[];
  label?: string; // 하위 단계 묶음 칸 이름("M4 묶음")
  rail?: { id: string; to: string; state: RailState };
}

export interface FlowModel {
  stops: FlowStop[]; // 파이프라인 순서
  groups: FlowStop[]; // 하위 단계가 있는 정거장만 = 파이프라인 아래 묶음 칸, 같은 순서
  nodes: FlowNode[]; // 보이는 순서 = 초점 순서
  currentId: string | null;
}

/** 선 한 구간의 상태. 들어가는 쪽 단계가 끝났으면 채우고, 진행 중이면 움직이고, 아니면 점선이다. */
export function segmentState(to: FlowState): RailState {
  if (to === 'done') return 'done';
  if (to === 'doing') return 'doing';
  return 'todo';
}

/** 묶음 이름. 부모의 짧은 이름 뒤에 "묶음"을 붙인다. */
export function laneLabel(parent: Stage): string {
  return `${parent.short ?? parent.title} 묶음`;
}

export function buildFlow(block: StagesBlock, status: Record<string, StatusView>): FlowModel {
  const groups = groupStages(block.stages);
  const byId = new Map(block.stages.map((s) => [s.id, s]));
  const dependents = new Map<string, string[]>();
  for (const s of block.stages) {
    for (const a of s.after ?? []) {
      if (byId.has(a)) dependents.set(a, [...(dependents.get(a) ?? []), s.id]);
    }
  }
  const nodes: FlowNode[] = [];
  const make = (stage: Stage, children: Stage[], level: 0 | 1, parent?: string): FlowNode => {
    const view = status[stage.id];
    const node: FlowNode = {
      id: stage.id,
      stage,
      level,
      state: stageState(view),
      tone: toneOf(view),
      progress: stageProgress(stage, children, status),
      current: false,
      order: nodes.length,
      deps: (stage.after ?? [])
        .filter((a) => byId.has(a) && a !== stage.id)
        .map((a) => ({
          id: a,
          short: plain(byId.get(a)!.short ?? a),
          state: status[a]?.done === true ? 'done' : 'blocking',
        })),
      dependents: dependents.get(stage.id) ?? [],
    };
    if (parent !== undefined) node.parent = parent;
    nodes.push(node);
    return node;
  };

  // 보이는 순서: 파이프라인의 최상위 단계 전부, 그다음 아래 묶음 칸의 하위 단계(부모 순서 → 원래 순서)
  const stops: FlowStop[] = groups.map((g) => ({ node: make(g.stage, g.children, 0), kids: [] }));
  groups.forEach((g, i) => {
    const stop = stops[i]!;
    stop.kids = g.children.map((c) => make(c, [], 1, g.stage.id));
    if (stop.kids.length > 0) stop.label = laneLabel(g.stage);
  });
  stops.forEach((stop, i) => {
    const next = stops[i + 1];
    if (next) stop.rail = { id: `rail:${stop.node.id}>${next.node.id}`, to: next.node.id, state: segmentState(next.node.state) };
  });
  const current = stops.map((r) => r.node).find((n) => n.state !== 'done') ?? null;
  if (current) current.current = true;
  return { stops, groups: stops.filter((s) => s.kids.length > 0), nodes, currentId: current?.id ?? null };
}

/** 한 단계에 걸린 것: 부모, 하위 단계, after로 이어진 단계(앞·뒤), 이웃 최상위 단계로 가는 파이프라인 선. */
export function relatedTo(model: FlowModel, id: string): { nodes: Set<string>; rails: Set<string> } {
  const nodes = new Set<string>([id]);
  const rails = new Set<string>();
  const self = model.nodes.find((n) => n.id === id);
  if (!self) return { nodes, rails };
  if (self.parent !== undefined) nodes.add(self.parent);
  for (const n of model.nodes) if (n.parent === id) nodes.add(n.id);
  for (const d of self.deps) nodes.add(d.id);
  for (const d of self.dependents) nodes.add(d);
  for (const stop of model.stops) {
    if (stop.rail && (stop.node.id === id || stop.rail.to === id)) {
      rails.add(stop.rail.id);
      nodes.add(stop.node.id);
      nodes.add(stop.rail.to);
    }
  }
  return { nodes, rails };
}

/**
 * 파이프라인이 넘쳐 가로로 굴러갈 때 처음 보일 위치: 지금 단계 칸을 가운데에 두되 양 끝을 넘지 않는다.
 * 넘치지 않으면 0. 값은 모두 px(칸의 왼쪽·폭, 보이는 폭, 전체 폭).
 */
export function centerScroll(left: number, width: number, viewport: number, total: number): number {
  const max = Math.max(0, total - viewport);
  if (max === 0) return 0;
  const want = Math.round(left + width / 2 - viewport / 2);
  return Math.min(max, Math.max(0, want));
}

/** 화면 글자는 인라인 표기를 해석하지 않으므로 `코드`·**굵게** 표지를 떼어 평문으로 쓴다. */
export function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
}

/** 제목이 짧은 이름으로 시작하면 그 머리를 떼어 둘째 줄로 쓴다(「M2」 + 「설계」). */
export function subtitle(stage: Stage): string {
  const short = stage.short;
  if (short && stage.title.startsWith(short)) return plain(stage.title.slice(short.length).replace(/^[\s—–-]+/, ''));
  return short ? plain(stage.title) : '';
}

/** 화면 낭독기용 한 줄: 이름 · 상태 · 진행 · 먼저 끝나야 하는 단계. */
export function describeNode(node: FlowNode, label: string): string {
  const parts = [plain(node.stage.title), label];
  if (node.progress.total > 0) {
    parts.push(`${node.progress.from === 'children' ? '하위 단계' : '항목'} ${node.progress.done}/${node.progress.total}`);
  }
  if (node.current) parts.push('지금 단계');
  if (node.deps.length > 0) {
    parts.push(`먼저: ${node.deps.map((d) => `${d.short}(${d.state === 'done' ? '끝남' : '남음'})`).join(', ')}`);
  }
  return parts.join(' · ');
}
