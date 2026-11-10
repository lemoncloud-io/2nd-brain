// 소스 바꾸기 진행 상태의 저장소와 App 쪽 훅. 규칙은 source-switch.ts(순수)에 있다.
// 시작은 두 길이다: (1) 기다림이 앞에 있는 PR 진입(enter-pr.ts·PR 패널)이 beginSourceSwitch 를 부른다.
// (2) 주소의 소스가 바뀌면(⚙ 소스 선택·뒤로가기 등) 훅이 스스로 시작한다. 끝은 훅이 리더 상태에서 읽는다 —
// 문서·폴더 effect 를 고치지 않으려고 따로 본다.
import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { Source } from '../../shared/source.ts';
import {
  contentArrived,
  EMPTY_SNAP,
  expireSwitch,
  finishSwitch,
  IDLE_SWITCH,
  isEmptySnap,
  startSwitch,
  SWITCH_TIMEOUT_MS,
  type ContentSnap,
  type Switching,
  type SwitchState,
} from './source-switch.ts';

let state: SwitchState = IDLE_SWITCH;
/** 화면이 지금 보는 소스 키. 훅이 적는다. */
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function arm(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const a = state.active;
  if (a === null) return;
  timer = setTimeout(() => set(expireSwitch(state, Date.now())), Math.max(0, a.startedAt + SWITCH_TIMEOUT_MS - Date.now()));
  // 시험(node)에서 타이머가 프로세스를 붙잡지 않게.
  (timer as { unref?: () => void }).unref?.();
}

function set(next: SwitchState): void {
  if (next === state) return;
  const rearm = next.active?.id !== state.active?.id;
  state = next;
  if (rearm) arm();
  for (const l of [...listeners]) l();
}

export const getSourceSwitch = (): SwitchState => state;

export function subscribeSourceSwitch(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 기다림이 앞에 있는 전환(PR 변경 목록 읽기)의 시작. 지금 소스와 같으면 아무것도 하지 않는다. */
export function beginSourceSwitch(to: Source): void {
  set(startSwitch(state, current, to, Date.now()));
}

export type SwitchView = {
  srcKey: string;
  src: Source;
  /** 리더가 문서·폴더 목록을 읽어 그리는 경로인가. 아니면(지도·html·텍스트 파일) 주소가 닿으면 끝낸다. */
  needsContent: boolean;
  doc: { source: string } | null;
  folder: unknown;
  error: string | null;
};

/** 지금 진행 중인 전환(없으면 null). App 이 한 번 부른다. */
export function useSourceSwitch(v: SwitchView): Switching | null {
  const s = useSyncExternalStore(subscribeSourceSwitch, getSourceSwitch, getSourceSwitch);
  const prevKey = useRef<string | null>(null);
  const stale = useRef<ContentSnap>(EMPTY_SNAP);
  const { srcKey, src, needsContent, error, folder } = v;
  const doc = v.doc !== null && v.doc.source === srcKey ? v.doc : null;
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = srcKey;
    current = srcKey;
    const snap: ContentSnap = { doc, folder, error };
    if (prev !== null && prev !== srcKey) {
      set(startSwitch(state, prev, src, Date.now(), true));
      // 이 차례의 내용은 옛 소스 것이다. 다음 차례부터 새 내용을 본다.
      stale.current = snap;
      if (needsContent) return;
    }
    const a = state.active;
    if (a === null || a.to !== srcKey || !a.arrived) return;
    if (!needsContent) {
      set(finishSwitch(state, a.id));
      return;
    }
    if (isEmptySnap(snap)) {
      stale.current = EMPTY_SNAP;
      return;
    }
    if (contentArrived(stale.current, snap)) set(finishSwitch(state, a.id));
  }, [srcKey, src, needsContent, doc, folder, error]);
  return s.active;
}
