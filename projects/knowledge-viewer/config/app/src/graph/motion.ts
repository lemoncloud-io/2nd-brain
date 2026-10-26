// 카메라 움직임의 순수 규칙 — 관성 감쇠·스프링 보간·로그 공간 확대·설정 값. DOM·three·d3 를 만지지 않는다.
// 설정 패널(index 청크)과 두 엔진(지도 청크)이 같이 쓴다.
//
// 왜 관성인가: 손을 놓는 순간 멈추는 지도는 입력마다 끊긴 점프로 느껴진다. 속도를 남기고 감쇠하면 손이 지도를 "던지는" 느낌이 되고,
// 목표로 가는 전환은 가감속 곡선이어야 눈이 따라간다(사용자 요청 2026-10-23 "물리의 관성 법칙을 활용하면 될 듯").
// 왜 dt 로 보정하는가: 전체 보기(2천여 노드)는 30 fps 로 떨어진다. 프레임마다 같은 값을 곱하면 느린 화면에서 두 배 오래 미끄러진다.
// 감쇠 계수는 "FRAME_MS(60 Hz 한 프레임)마다 곱하는 값"으로 정의하고 실제 dt 만큼 거듭제곱한다 — 같은 시간 뒤 같은 값이다.
// 왜 스프링인가: 임계 감쇠 스프링은 오버슈트가 없고 닫힌 해가 있어 dt 가 들쭉날쭉해도 적분 오차 없이 같은 궤적이다.
// 왜 로그 공간 확대인가: 배율 k 에 더하면 가까울 때(k 가 클 때) 같은 입력이 훨씬 크게 움직인다. ln k 에 속도를 두면 어느 배율에서든 같은 비율로 간다.

/** 움직임 설정 — 부드럽게(관성·전환) 또는 바로(즉시). */
export type MotionMode = 'smooth' | 'instant';
export const MOTION_MODES: readonly { mode: MotionMode; label: string }[] = [
  { mode: 'smooth', label: '부드럽게' },
  { mode: 'instant', label: '바로' },
];
export const DEFAULT_MOTION_MODE: MotionMode = 'smooth';
export function isMotionMode(v: unknown): v is MotionMode {
  return v === 'smooth' || v === 'instant';
}

/** 감쇠 강도 — 약할수록 오래 미끄러진다. 값은 FRAME_MS 마다 속도에 곱하는 계수다. */
export type DampingLevel = 'weak' | 'medium' | 'strong';
export const DAMPING_LEVELS: readonly { level: DampingLevel; label: string; damping: number }[] = [
  { level: 'weak', label: '약', damping: 0.95 },
  { level: 'medium', label: '중', damping: 0.92 },
  { level: 'strong', label: '강', damping: 0.85 },
];
export const DEFAULT_DAMPING_LEVEL: DampingLevel = 'medium';
export function isDampingLevel(v: unknown): v is DampingLevel {
  return v === 'weak' || v === 'medium' || v === 'strong';
}
export function dampingOf(level: DampingLevel): number {
  return DAMPING_LEVELS.find((d) => d.level === level)?.damping ?? 0.92;
}

/** 기준 프레임(60 Hz). 감쇠 계수는 이 시간마다 곱하는 값이다. */
export const FRAME_MS = 1000 / 60;
/** 전환(중심 바꾸기·집 보기·맞춤)이 목표에 닿는 시간. 400~700 ms 사이에서 가운데다. */
export const TRANSITION_MS = 600;
/** 처음 그릴 때·모드를 바꿀 때 카메라가 출발하는 거리 배수 — 먼 데서 집 보기로 날아든다. */
export const FLY_IN_FROM = 1.6;
/** 한 프레임으로 치는 dt 의 상한. 탭이 숨었다 돌아오면 dt 가 수 초라 한 프레임에 다 건너뛴다. */
export const MAX_DT_MS = 100;

/** 엔진이 받는 실제 설정. reduced-motion 이면 smooth 가 거짓이다. */
export type MotionSettings = { smooth: boolean; damping: number; transitionMs: number };

/** 설정(모드·강도)과 OS 의 prefers-reduced-motion 을 합친다. 바로 모드나 reduced-motion 이면 관성도 전환도 없다. */
export function resolveMotion(mode: MotionMode, level: DampingLevel, reducedMotion: boolean): MotionSettings {
  const smooth = mode === 'smooth' && !reducedMotion;
  return { smooth, damping: dampingOf(level), transitionMs: smooth ? TRANSITION_MS : 0 };
}

/** dt 를 [0, MAX_DT_MS] 로 자른다. 음수(시계 역행)도 0 이다. */
export function clampDt(dtMs: number): number {
  return Math.min(MAX_DT_MS, Math.max(0, dtMs));
}

/** dt 가 지나는 동안 속도에 곱할 감쇠 — damping^(dt/FRAME_MS). dt 가 달라도 같은 시간 뒤 같은 값이다. */
export function decayOver(damping: number, dtMs: number): number {
  return Math.pow(damping, dtMs / FRAME_MS);
}

/** 속도를 dt 만큼 감쇠한다. 절댓값이 stop 보다 작아지면 0 — 영원히 기어가지 않는다. */
export function decayVelocity(v: number, damping: number, dtMs: number, stop: number): number {
  const next = v * decayOver(damping, dtMs);
  return Math.abs(next) < stop ? 0 : next;
}

/**
 * 속도 v 로 출발해 감쇠가 다할 때까지 가는 거리. 프레임마다 v·FRAME_MS 를 가고 damping 을 곱하면 등비급수 v·FRAME_MS/(1−damping) 이다.
 * (연속 시간으로 적분해도 FRAME_MS/(−ln damping) 으로 거의 같다 — 설정 셋 모두 8 % 안쪽.)
 */
export function glideDistance(v: number, damping: number): number {
  return (v * FRAME_MS) / (1 - damping);
}

/** 거리를 초기 속도(단위/ms)로 — glideDistance 의 역. 휠 한 번이 바로 모드와 같은 곳에 닿게 한다. */
export function impulseFor(distance: number, damping: number): number {
  return (distance * (1 - damping)) / FRAME_MS;
}

/**
 * three.js TrackballControls 의 `dynamicDampingFactor`. 회전 잔여 각은 프레임마다 √(1−f) 로 줄므로 f = 1 − decay² 이면
 * 한 프레임에 decay 만큼 준다. 패닝·확대는 (1−f) = decay² 로 좀 더 빨리 준다 — 회전이 가장 긴 움직임이라 회전에 맞춘다.
 * dt 를 주면 그 프레임 길이에 맞는 값이다(느린 프레임일수록 f 가 크다).
 */
export function trackballDampingFactor(damping: number, dtMs = FRAME_MS): number {
  const d = decayOver(damping, dtMs);
  return Math.min(1, Math.max(0, 1 - d * d));
}

/** TrackballControls 의 기본 zoomSpeed. */
export const TRACKBALL_ZOOM_SPEED = 1.2;

/**
 * TrackballControls 의 `zoomSpeed`. 관성이 켜진 트랙볼은 휠 한 번(잔여량 d)에 프레임마다 (1 + 잔여·zoomSpeed) 를 곱하며 잔여를 (1−f) 로
 * 줄이므로 다 합치면 ln 거리 ≈ zoomSpeed·d/f 다. 바로 모드(staticMoving)는 한 프레임에 zoomSpeed·d 만 간다. 같은 휠 한 번이 두 모드에서
 * 같은 곳에 닿도록 바로 모드의 zoomSpeed 를 1/f 배 한다(기준 프레임의 f).
 */
export function trackballZoomSpeed(smooth: boolean, damping: number): number {
  return smooth ? TRACKBALL_ZOOM_SPEED : TRACKBALL_ZOOM_SPEED / trackballDampingFactor(damping);
}

/**
 * 휠 한 번의 확대 거리(자연로그). d3-zoom 기본 wheelDelta(2^(−deltaY·0.002), 줄 단위 0.05, 페이지 단위 1, Ctrl 이면 10 배)와 같은
 * 거리다 — 부드럽게 모드가 바로 모드와 같은 배율에 닿는다.
 */
export function wheelLogDelta(deltaY: number, deltaMode: number, ctrlKey = false): number {
  const unit = deltaMode === 1 ? 0.05 : deltaMode === 0 ? 0.002 : 1;
  return -deltaY * unit * (ctrlKey ? 10 : 1) * Math.LN2;
}

/** 로그 공간 확대: 배율 k 에 exp(속도·dt) 를 곱한다. 속도 단위는 ln k / ms. */
export function zoomBy(k: number, vLog: number, dtMs: number): number {
  return k * Math.exp(vLog * dtMs);
}

export type Point = { x: number; y: number };

/** 배율 k→k2 뒤에도 포인터 아래 그래프 좌표가 그대로이게 하는 새 중심(2D). 중심은 화면 가운데가 보는 그래프 좌표다. */
export function zoomAbout(center: Point, pointer: Point, k: number, k2: number): Point {
  const r = k / k2;
  return { x: pointer.x + (center.x - pointer.x) * r, y: pointer.y + (center.y - pointer.y) * r };
}

/** 드래그 속도 측정용 표본 — 시각(ms)·중심 좌표·배율. */
export type Sample = { t: number; x: number; y: number; k: number };
/** 마지막 표본이 이보다 오래됐으면 손을 멈춘 뒤 놓은 것이다 — 미끄러지지 않는다. */
export const RELEASE_MAX_AGE_MS = 80;
/** 속도는 이 시간 안의 표본으로 잰다. */
export const VELOCITY_WINDOW_MS = 120;
/** 속도 표본은 이만큼만 둔다. */
export const MAX_SAMPLES = 8;

/**
 * 최근 표본으로 속도(단위/ms)를 잰다. 표본이 둘 미만이거나, 마지막 표본이 RELEASE_MAX_AGE_MS 보다 오래됐거나(멈췄다 놓음),
 * 배율이 바뀌었으면(확대 중) 0 이다. 창 안의 첫 표본과 마지막 표본의 기울기다.
 */
export function velocityOf(samples: readonly Sample[], now: number): Point {
  const zero = { x: 0, y: 0 };
  if (samples.length < 2) return zero;
  const last = samples[samples.length - 1]!;
  if (now - last.t > RELEASE_MAX_AGE_MS) return zero;
  let first = samples[0]!;
  for (const s of samples) {
    if (last.t - s.t <= VELOCITY_WINDOW_MS) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt <= 0 || first.k !== last.k) return zero;
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

/** 표본을 끝에 더하고 MAX_SAMPLES 로 자른다. 입력 배열은 바꾸지 않는다. */
export function pushSample(samples: readonly Sample[], s: Sample): Sample[] {
  const next = [...samples, s];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

/** 스프링 한 축의 상태 — 위치와 속도(단위/ms). */
export type Spring = { x: number; v: number };

/** 임계 감쇠에서 남은 거리가 1 % 가 되는 ω·t — (1 + x)·e^(−x) = 0.01 의 해. */
export const SETTLE = 6.638;

/** 전환 시간(ms)에 맞는 ω(1/ms). 그 시간 뒤 남은 거리가 1 % 다. */
export function omegaFor(durationMs: number): number {
  return SETTLE / durationMs;
}

/**
 * 임계 감쇠 스프링의 닫힌 해로 dt 만큼 나아간다 — x(t) = target + (A + B·t)·e^(−ω·t), A = x0 − target, B = v0 + ω·A.
 * 정지에서 출발하면 오버슈트가 없고, 출발 속도가 커도 한 번 지나친 뒤 돌아올 뿐 진동하지 않는다(임계 감쇠).
 * dt 를 어떻게 쪼개도 같은 시간 뒤 같은 값이다(해석해).
 */
export function springStep(s: Spring, target: number, dtMs: number, omega: number): Spring {
  const a = s.x - target;
  const b = s.v + omega * a;
  const e = Math.exp(-omega * dtMs);
  return { x: target + (a + b * dtMs) * e, v: (s.v - omega * b * dtMs) * e };
}

/** 목표에 닿았는가 — 남은 거리와 속도가 남길 거리(|v|/ω)가 모두 eps 안이다. */
export function settled(s: Spring, target: number, omega: number, eps: number): boolean {
  return Math.abs(s.x - target) <= eps && Math.abs(s.v) / omega <= eps;
}

/** 3d-force-graph 가 처음 그릴 때 두는 카메라 거리 — ∛(노드 수) × 170. 집 보기의 거리로 같은 값을 쓴다. */
export const CAMERA_DISTANCE_PER_CBRT = 170;
export function homeDistance(nodeCount: number): number {
  return Math.cbrt(Math.max(1, nodeCount)) * CAMERA_DISTANCE_PER_CBRT;
}

/** force-graph(2D) 가 처음 그릴 때 두는 배율 — 4 / ∛(노드 수). 날아들기의 목표 배율로 같은 값을 쓴다. */
export const ZOOM_PER_CBRT = 4;
export function homeZoom(nodeCount: number): number {
  return ZOOM_PER_CBRT / Math.cbrt(Math.max(1, nodeCount));
}
