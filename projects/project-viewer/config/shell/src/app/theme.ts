// 테마는 시스템 설정을 따르고, 사용자가 고르면 그 선택을 기억한다.
// localStorage는 file://·시크릿 창·차단된 사이트 데이터에서 던질 수 있어 전부 try/catch로 감싼다.

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'viewer.theme';

function read(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // 저장소를 못 읽어도 화면은 떠야 한다
  }
  return 'system';
}

function write(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // 기억하지 못할 뿐 동작에는 지장이 없다
  }
}

export function useTheme(): { theme: ThemeChoice; cycle: () => void } {
  const [theme, setTheme] = useState<ThemeChoice>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeChoice = prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system';
      write(next);
      return next;
    });
  }, []);

  return { theme, cycle };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: '시스템',
  light: '밝게',
  dark: '어둡게',
};
