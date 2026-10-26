// 3D 지도의 깊이감(순수). 깊이 = 카메라까지의 거리다. 매 프레임 노드마다 거리를 재고 가까운 쪽 0 ~ 먼 쪽 1 로 정규화한
// `t` 에서 크기·불투명도를 뽑는다 — 앞 노드는 크고 진하게, 뒤 노드는 작고 흐리게. 2D 지도에는 깊이가 없어 쓰지 않는다.
//
// 왜 거리의 절대값이 아니라 정규화인가: 지도마다 카메라 거리(노드 수의 세제곱근에 비례)와 구 반지름이 다르다.
// 어느 지도에서든 "맨 앞"과 "맨 뒤"가 같은 대비로 보여야 하므로 그 지도의 거리 분포 안에서 자리를 잰다.
// 왜 최소·최대가 아니라 5·95 백분위인가: 전체 보기의 고립 노드 궤도(3R)와 멀리 튄 노드 몇 개가 범위를 늘려 가운데 덩어리의
// 대비가 사라진다. 바깥 5 % 는 끝값으로 몰아 둔다.

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 맨 앞 노드의 크기 배수. 뒤로 갈수록 SCALE_NEAR − SCALE_SPAN·t. */
export const SCALE_NEAR = 1.25;
export const SCALE_SPAN = 0.5;
/** 맨 뒤 노드의 불투명도는 1 − OPACITY_SPAN 이다. */
export const OPACITY_SPAN = 0.65;
/** 이보다 앞(t 가 작다)에 있는 주요 노드만 제목을 그린다. */
export const LABEL_FRONT = 0.6;
/** 불투명도 단계 수. 재질을 단계마다 하나씩 나눠 쓰므로(노드 2천여 개가 재질 몇 개를 공유) 연속값 대신 양자화한다. */
export const DEPTH_LEVELS = 6;
/** 안개가 맨 뒤(t = 1)에서 배경에 섞이는 비율. 간선·고리처럼 안개를 받는 물체가 뒤로 갈수록 이만큼 흐려진다. */
export const FOG_FAR_FADE = 0.65;
/** 거리 분포에서 앞·뒤 끝으로 삼는 백분위. */
export const DEPTH_PERCENTILE = 0.05;

/** 거리 분포의 앞·뒤 끝. 비어 있으면 [0, 1]. 둘이 같으면 far 를 1 만큼 띄워 0 으로 나누지 않는다. 입력은 바꾸지 않는다. */
export function depthRange(distances: ArrayLike<number>): { near: number; far: number } {
  const n = distances.length;
  if (n === 0) return { near: 0, far: 1 };
  const sorted = Float64Array.from(distances).sort();
  const lo = sorted[Math.min(n - 1, Math.floor(n * DEPTH_PERCENTILE))];
  const hi = sorted[Math.max(0, Math.ceil(n * (1 - DEPTH_PERCENTILE)) - 1)];
  return hi > lo ? { near: lo, far: hi } : { near: lo, far: lo + 1 };
}

/** 거리를 [near, far] 안에서 0(앞)~1(뒤)로. 범위 밖은 끝값이다. */
export function depthOf(dist: number, near: number, far: number): number {
  return clamp01((dist - near) / (far - near));
}

/** t 를 DEPTH_LEVELS 단계 가운데 하나로 — 0, 1/(L−1), …, 1. */
export function quantize(t: number, levels = DEPTH_LEVELS): number {
  const steps = levels - 1;
  return Math.round(clamp01(t) * steps) / steps;
}

/** 깊이 t 의 크기 배수. 앞 1.25, 뒤 0.75. */
export function scaleAt(t: number): number {
  return SCALE_NEAR - SCALE_SPAN * clamp01(t);
}

/** 깊이 t 의 불투명도 배수. 앞 1, 뒤 0.35. */
export function opacityAt(t: number): number {
  return 1 - OPACITY_SPAN * clamp01(t);
}

/** 주요 노드의 제목을 그릴 만큼 앞에 있는가. */
export function isFront(t: number): boolean {
  return t < LABEL_FRONT;
}

/**
 * 안개(three.js 선형 Fog)의 near·far. near 는 앞 끝 그대로이고, far 는 뒤 끝(t = 1)에서 FOG_FAR_FADE 만큼 섞이도록 더 멀리 둔다
 * — far 를 뒤 끝에 두면 뒤쪽 간선이 통째로 사라진다.
 */
export function fogRange(near: number, far: number): { near: number; far: number } {
  return { near, far: near + (far - near) / FOG_FAR_FADE };
}
