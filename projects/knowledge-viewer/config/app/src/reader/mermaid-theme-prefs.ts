// 다이어그램 테마 고르기. 저장은 localStorage(src/app/prefs.ts 패턴), 알림은 작은 구독 저장소다 —
// 테마를 바꾸면 열린 문서의 모든 Mermaid 그릇이 useMermaidTheme 로 알아채 다시 그린다.
// storage 를 인자로 받아 시험에서 바꿔 끼운다(src/panels/prefs.ts 패턴).
import { useSyncExternalStore } from 'react';

import { DEFAULT_MERMAID_THEME, findMermaidTheme } from './mermaid-themes/registry.ts';

export const MERMAID_THEME_KEY = 'knowledge-viewer.mermaid-theme';

const defaultStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** 저장된 테마 id. 없거나 모르는 id 거나 저장소가 막혀 있으면 기본이다. */
export function readMermaidTheme(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): string {
  if (!storage) return DEFAULT_MERMAID_THEME;
  try {
    return findMermaidTheme(storage.getItem(MERMAID_THEME_KEY)).id;
  } catch {
    return DEFAULT_MERMAID_THEME;
  }
}

/** 테마 id 를 저장하고 구독자에게 알린다. 모르는 id 는 기본 테마로 적는다. */
export function writeMermaidTheme(id: string, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  const next = findMermaidTheme(id).id;
  try {
    storage?.setItem(MERMAID_THEME_KEY, next);
  } catch {
    // 저장 못 해도 화면은 바뀐다
  }
  if (current !== next) {
    current = next;
    listeners.forEach((fn) => fn());
  }
}

let current: string | null = null;
const listeners = new Set<() => void>();

const snapshot = (): string => (current ??= readMermaidTheme());
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** 지금 테마 id. 바뀌면 다시 그린다. SSR 에서는 기본이다. */
export function useMermaidTheme(): string {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_MERMAID_THEME);
}
