// 검색 상자의 질의를 트리에 건네는 작은 저장소. 상단바를 거치지 않고(TopBar 는 다른 PR 이 만진다) App 이 읽어 Tree 에 준다.
import { useSyncExternalStore } from 'react';

let current = '';
const listeners = new Set<() => void>();

export const getSearchFilter = (): string => current;

export function setSearchFilter(q: string): void {
  const next = q.trim();
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

export function subscribeSearchFilter(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 지금 질의(앞뒤 공백 뗀 것). 비면 필터가 없다. */
export const useSearchFilter = (): string => useSyncExternalStore(subscribeSearchFilter, getSearchFilter, getSearchFilter);
