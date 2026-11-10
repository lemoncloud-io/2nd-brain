// archify 그림 배율 상태. 저장은 src/app/prefs/archify.ts, 알림은 작은 구독 저장소다 —
// ⚙ 에서 단계를 바꾸면 열린 ArchifyFrame 이 useArchifyZoom 으로 알아채 iframe 에 메시지로 보낸다(다시 열지 않는다).
import { useSyncExternalStore } from 'react';

import { DEFAULT_ARCHIFY_ZOOM, isArchifyZoom, type ArchifyZoom } from '../../shared/archify-fit.ts';
import { readArchifyZoom, writeArchifyZoom } from '../app/prefs.ts';

let current: ArchifyZoom | null = null;
const listeners = new Set<() => void>();

// 지금 값(처음 한 번만 저장소에서 읽는다).
const snapshot = (): ArchifyZoom => (current ??= readArchifyZoom());
// 구독자를 더하고 떼는 함수를 돌려준다.
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** 배율을 저장하고 바뀌었으면 구독자에게 알린다. 단계 밖 값은 무시한다. */
export function setArchifyZoom(zoom: number): void {
  if (!isArchifyZoom(zoom)) return;
  writeArchifyZoom(zoom);
  if (snapshot() !== zoom) {
    current = zoom;
    listeners.forEach((fn) => fn());
  }
}

/** 지금 배율. 바뀌면 다시 그린다. SSR 에서는 기본(100)이다. */
export function useArchifyZoom(): ArchifyZoom {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_ARCHIFY_ZOOM);
}
