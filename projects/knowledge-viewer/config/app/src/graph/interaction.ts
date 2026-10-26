// 지도 입력의 순수 규칙 — Shift(카메라만 움직이기)·Space(초기 보기) 키 상태, 호버 노드에 닿은 간선 판정, 초기 보기 목표.
// DOM 을 만지지 않는다. 두 엔진·GraphView 가 쓰고 tests/ui/graph-interaction.test.ts 가 지킨다.
//
// 왜 Shift 인가: 지도가 빽빽하면 빈 곳을 잡기 어려워 드래그가 노드 드래그가 되고 휠·클릭이 노드를 고른다. Shift 를 누른 동안은
// 노드를 없는 셈 치고(선택·호버·드래그 없음) 카메라만 움직인다. 왜 Space 인가: 어디로 갔든 한 키로 처음 보기로 돌아온다 — 전환은
// 관성 스프링이라 점프하지 않는다. 왜 호버 간선 강조인가: 노드 하나의 연결을 눈으로 따라가게 — 닿은 간선은 굵고 또렷하게,
// 나머지는 살짝 흐리게.
import { homeDistance, homeZoom } from './motion.ts';

/** 키 상태 — Shift 를 누르고 있는가. Space 는 상태가 아니라 한 번의 동작이다. */
export type KeyState = { shift: boolean };
export const INITIAL_KEYS: KeyState = { shift: false };

/** 키 입력 하나. type 은 keydown·keyup·blur(창이 포커스를 잃음)·pointer(마우스 이벤트가 전하는 shiftKey — 켜기만 한다). */
export type KeyInput =
  | { type: 'keydown' | 'keyup'; key: string; typing: boolean }
  | { type: 'blur' }
  | { type: 'pointer'; shiftKey: boolean };

/** 입력 뒤의 키 상태와 그 입력이 시키는 동작. reset 은 Space 를 입력 상자 밖에서 눌렀을 때만 참이다. */
export type KeyStep = { state: KeyState; reset: boolean };

/**
 * 키 상태 머신. Shift 는 keydown 에 켜고 keyup·blur 에 끈다. 마우스 이벤트의 shiftKey 가 참이면 켠다(다른 창에서 누른 채
 * 들어와 keydown 을 못 받은 경우) — 거짓이라고 끄지는 않는다: 끄는 것은 keyup·blur 의 몫이고, 마우스 이벤트로 끄면 Shift 를
 * 누른 채 하는 드래그가 pointer 이벤트의 shiftKey 를 안 싣는 환경(자동화·일부 입력기)에서 첫 pointerdown 에 풀린다.
 * Space 는 입력 상자(typing)에서는 글자다. Shift 도 입력 상자에서는 무시한다.
 */
export function keyStep(state: KeyState, input: KeyInput): KeyStep {
  switch (input.type) {
    case 'keydown':
      if (input.typing) return { state, reset: false };
      if (input.key === 'Shift') return { state: { shift: true }, reset: false };
      if (input.key === ' ' || input.key === 'Spacebar') return { state, reset: true };
      return { state, reset: false };
    case 'keyup':
      if (input.key === 'Shift') return { state: { shift: false }, reset: false };
      return { state, reset: false };
    case 'blur':
      return { state: { shift: false }, reset: false };
    case 'pointer':
      return { state: input.shiftKey && !state.shift ? { shift: true } : state, reset: false };
  }
}

/** 글자를 치는 곳인가 — 거기서는 Space·Shift 가 글자다. tagName 은 대문자, contentEditable 은 요소의 isContentEditable. */
export function isTypingTarget(tagName: string | null | undefined, contentEditable = false): boolean {
  if (contentEditable) return true;
  const t = (tagName ?? '').toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

type End = string | { path: string };
const endPath = (end: End): string => (typeof end === 'string' ? end : end.path);

/** 간선이 그 노드에 닿는가. 라이브러리가 간선 끝을 노드 객체로 바꿔 두므로 어느 쪽이든 경로로 본다. */
export function touches(link: { source: End; target: End }, path: string): boolean {
  return endPath(link.source) === path || endPath(link.target) === path;
}

/** 노드별로 닿은 간선 목록 — 데이터를 받을 때 한 번 만든다. 호버가 바뀔 때 그 노드의 간선만 O(차수)로 본다. */
export function linksByNode<L extends { source: End; target: End }>(links: readonly L[]): Map<string, L[]> {
  const m = new Map<string, L[]>();
  const add = (p: string, l: L) => {
    const list = m.get(p);
    if (list === undefined) m.set(p, [l]);
    else list.push(l);
  };
  for (const l of links) {
    const s = endPath(l.source);
    const t = endPath(l.target);
    add(s, l);
    if (t !== s) add(t, l);
  }
  return m;
}

/** 호버 강조 수치. 닿은 간선은 굵기 ×2·불투명도 1·강조색, 나머지는 불투명도 0.25. */
export const HOVER_LINK_WIDTH_SCALE = 2;
export const HOVER_LINK_ALPHA = 1;
export const HOVER_OTHER_ALPHA = 0.25;

/** 간선의 호버 상태 — 호버가 없으면 none, 닿으면 on, 아니면 off(흐리게). */
export type LinkHover = 'none' | 'on' | 'off';
export function linkHover(link: { source: End; target: End }, hovered: string | null): LinkHover {
  if (hovered === null) return 'none';
  return touches(link, hovered) ? 'on' : 'off';
}

/** 3D 초기 보기 — 카메라는 +z 축 위 집 거리, 원점을 보고, 위쪽은 +y. 라이브러리가 처음 두는 자리와 같다. */
export function resetView3d(nodeCount: number): { position: [number, number, number]; lookAt: [number, number, number]; up: [number, number, number] } {
  return { position: [0, 0, homeDistance(nodeCount)], lookAt: [0, 0, 0], up: [0, 1, 0] };
}

/** 2D 초기 보기 — 중심 (0,0)·노드 수에 맞는 배율. */
export function resetView2d(nodeCount: number): { center: [number, number]; zoom: number } {
  return { center: [0, 0], zoom: homeZoom(nodeCount) };
}
