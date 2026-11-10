// 소스 바꾸기(PR·메인·로컬) 진행 상태의 순수 규칙. PR 로 바꾸면 gh 호출·문서 읽기에 몇 초가 걸려 화면이 멈춘 듯 보였다(오너 요청 2026-10-27).
// 시작 → 주소가 새 소스에 닿음(arrived) → 새 소스의 내용이 옴 → 끝. 더 새 시작은 옛 것을 갈아 끼운다. 끝 요청은 id 가 같을 때만 듣는다.
// 저장소·타이머·React 는 useSourceSwitch.ts 가 갖는다.
import { sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';

/** 이 시간이 지나면 무엇이 와도 끝낸다 — 덮개가 남아 있는 일이 없게. */
export const SWITCH_TIMEOUT_MS = 20_000;
/** 이보다 빨리 끝나면 아무것도 보이지 않는다(빠른 전환의 깜빡임 방지). */
export const SWITCH_SHOW_DELAY_MS = 250;

export type Switching = {
  id: number;
  /** 바꾸기 전 소스 키. 모르면 null. */
  from: string | null;
  /** 바꿀 소스 키(sourceKey). */
  to: string;
  label: string;
  /** 주소가 새 소스에 닿았는가. 닿은 뒤부터 내용 도착을 본다. */
  arrived: boolean;
  startedAt: number;
};

export type SwitchState = { seq: number; active: Switching | null };

export const IDLE_SWITCH: SwitchState = { seq: 0, active: null };

export function switchLabel(to: Source): string {
  if (to.kind === 'pr') return `PR #${to.number} 불러오는 중…`;
  return to.kind === 'main' ? '메인 불러오는 중…' : '로컬 불러오는 중…';
}

/**
 * 바꾸기 시작. 지금 소스와 같으면 바꿀 것이 없다. 같은 곳으로 가는 중이면 그 전환을 둔다(arrived 만 올린다).
 * 다른 곳으로 가는 중이면 새 전환이 갈아 끼운다(새 id, 새 글).
 */
export function startSwitch(s: SwitchState, from: string | null, to: Source, now: number, arrived = false): SwitchState {
  const key = sourceKey(to);
  if (from === key) return s;
  const a = s.active;
  if (a !== null && a.to === key) return arrived && !a.arrived ? { ...s, active: { ...a, arrived: true } } : s;
  const id = s.seq + 1;
  return { seq: id, active: { id, from, to: key, label: switchLabel(to), arrived, startedAt: now } };
}

/** 끝. 이미 갈아 끼워진 옛 전환의 끝 요청은 버린다. */
export function finishSwitch(s: SwitchState, id: number): SwitchState {
  if (s.active === null || s.active.id !== id) return s;
  return { seq: s.seq, active: null };
}

/** 안전 시간이 지났으면 끝낸다. */
export function expireSwitch(s: SwitchState, now: number, limit = SWITCH_TIMEOUT_MS): SwitchState {
  if (s.active === null || now - s.active.startedAt < limit) return s;
  return { seq: s.seq, active: null };
}

/** 리더가 보이는 내용. doc 은 지금 소스의 것만 넣는다. */
export type ContentSnap = { doc: unknown; folder: unknown; error: string | null };

export const EMPTY_SNAP: ContentSnap = { doc: null, folder: null, error: null };

export const isEmptySnap = (c: ContentSnap): boolean => c.doc === null && c.folder === null && c.error === null;

/**
 * 새 내용이 왔는가. stale 은 주소가 닿을 때 화면에 남아 있던 옛 내용이다(비워진 것을 보면 EMPTY_SNAP 으로 바꾼다).
 * 문서·폴더 목록·오류 중 하나라도 옛 것과 다른 값으로 차 있으면 왔다.
 */
export function contentArrived(stale: ContentSnap, cur: ContentSnap): boolean {
  return (
    (cur.doc !== null && cur.doc !== stale.doc) ||
    (cur.folder !== null && cur.folder !== stale.folder) ||
    (cur.error !== null && cur.error !== stale.error)
  );
}
