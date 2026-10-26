// 화면 테마 적용: 저장값(prefs/theme.ts)을 <html data-theme data-scheme> 로 옮기고, 바뀌면 구독자에게 알린다.
// 고르는 곳(ThemeSelect)은 setTheme·setScheme 만 부르고, 적용은 App 의 useApplyTheme 한 곳이 맡는다.
// 다른 탭에서 바꾼 값도 storage 이벤트로 따라간다.
import { useLayoutEffect, useSyncExternalStore } from 'react';

import { readScheme, readTheme, writeScheme, writeTheme } from './prefs/theme.ts';
import { DEFAULT_SCHEME, DEFAULT_THEME, themeAttrs, type Scheme } from './themes.ts';

export type ThemePrefs = { theme: string; scheme: Scheme };

/** 요소에 테마 속성을 둔다. auto 면 data-scheme 를 빼서 OS 설정을 따르게 한다. */
export function applyTheme(root: HTMLElement, theme: unknown, scheme: unknown): void {
  const a = themeAttrs(theme, scheme);
  if (root.dataset['theme'] !== a.theme) root.dataset['theme'] = a.theme;
  if (a.scheme === null) delete root.dataset['scheme'];
  else if (root.dataset['scheme'] !== a.scheme) root.dataset['scheme'] = a.scheme;
}

/** 저장값을 <html> 에 바로 둔다. 첫 그리기 전에 불러 깜빡임을 막는다(main.tsx). */
export function applyStoredTheme(): void {
  if (typeof document === 'undefined') return;
  applyTheme(document.documentElement, readTheme(), readScheme());
}

let current: ThemePrefs | null = null;
const listeners = new Set<() => void>();
const SSR: ThemePrefs = { theme: DEFAULT_THEME, scheme: DEFAULT_SCHEME };

const snapshot = (): ThemePrefs => (current ??= { theme: readTheme(), scheme: readScheme() });

function update(next: ThemePrefs): void {
  const cur = snapshot();
  if (cur.theme === next.theme && cur.scheme === next.scheme) return;
  current = next;
  listeners.forEach((fn) => fn());
}

const onStorage = (e: StorageEvent): void => {
  if (e.key === null || e.key.startsWith('knowledge-viewer.theme') || e.key.startsWith('knowledge-viewer.scheme')) {
    update({ theme: readTheme(), scheme: readScheme() });
  }
};

const subscribe = (fn: () => void): (() => void) => {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

export function setTheme(id: string): void {
  writeTheme(id);
  update({ ...snapshot(), theme: readTheme() });
}

export function setScheme(s: Scheme): void {
  writeScheme(s);
  update({ ...snapshot(), scheme: readScheme() });
}

/** 지금 테마·밝기. 바뀌면 다시 그린다. SSR 에서는 기본값이다. */
export function useThemePrefs(): ThemePrefs {
  return useSyncExternalStore(subscribe, snapshot, () => SSR);
}

/** App 이 한 번 부른다: 마운트 때와 값이 바뀔 때 <html> 속성을 맞춘다. 에이전트 모드도 같다(UI 만 없다). */
export function useApplyTheme(): void {
  const { theme, scheme } = useThemePrefs();
  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme, scheme);
  }, [theme, scheme]);
}
