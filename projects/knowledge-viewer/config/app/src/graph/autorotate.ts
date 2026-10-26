// 자동 회전 — 손을 놓고 있으면 지도가 천천히 돈다(3D). 순수 규칙이다; three 에 붙이는 층은 camera3d.ts 다.
// 돌지 않는 때: 꺼짐 · 마지막 입력(드래그·휠) 뒤 IDLE_MS 안 · 전환(집 보기·초기 보기) 중 · 노드 호버 중 · 움직임 줄이기(바로 모드).

export type RotateMode = 'auto' | 'off';
export const ROTATE_MODES: readonly { mode: RotateMode; label: string }[] = [
  { mode: 'auto', label: '자동' },
  { mode: 'off', label: '끔' },
];
export const DEFAULT_ROTATE_MODE: RotateMode = 'off';
export function isRotateMode(v: unknown): v is RotateMode {
  return v === 'auto' || v === 'off';
}

/** 입력이 끝난 뒤 이만큼 지나야 돈다 — 관성으로 미끄러지는 동안 돌지 않게. */
export const IDLE_MS = 1500;
/** 각속도(rad/s). 한 바퀴 약 50초 — 읽으면서 보는 속도. */
export const ROTATE_SPEED = 0.125;
/** 처음 돌기 시작할 때 이 시간에 걸쳐 속도를 올린다(툭 튀지 않게). */
export const RAMP_MS = 1200;

export type RotateState = {
  enabled: boolean;
  /** 마지막 입력 시각(ms). null 이면 입력이 없었다. */
  lastInputAt: number | null;
  /** 돌기 시작한 시각(ms). 돌고 있지 않으면 null. */
  spinningSince: number | null;
};

export const INITIAL_ROTATE: RotateState = { enabled: false, lastInputAt: null, spinningSince: null };

/** 지금 돌아도 되는가(외부 조건은 호출자가 준다). */
export function canSpin(s: RotateState, now: number, blocked: boolean): boolean {
  if (!s.enabled || blocked) return false;
  return s.lastInputAt === null || now - s.lastInputAt >= IDLE_MS;
}

/**
 * 한 프레임의 회전각(rad). 돌 수 없으면 0 을 주고 spinningSince 를 비운다. 돌기 시작하면 RAMP_MS 동안 속도를 선형으로 올린다.
 * dt 는 ms. 큰 dt(탭이 멈췄다 깨어남)는 호출자가 clampDt 로 자른다.
 */
export function rotateStep(s: RotateState, now: number, dtMs: number, blocked: boolean): { angle: number; state: RotateState } {
  if (!canSpin(s, now, blocked)) return { angle: 0, state: s.spinningSince === null ? s : { ...s, spinningSince: null } };
  const since = s.spinningSince ?? now;
  const ramp = Math.min(1, (now - since) / RAMP_MS);
  const angle = ROTATE_SPEED * ramp * (dtMs / 1000);
  return { angle, state: since === s.spinningSince ? s : { ...s, spinningSince: since } };
}

/** 입력이 왔다 — 회전을 멈추고 유휴 시계를 다시 센다. */
export function markInput(s: RotateState, now: number): RotateState {
  return { ...s, lastInputAt: now, spinningSince: null };
}
