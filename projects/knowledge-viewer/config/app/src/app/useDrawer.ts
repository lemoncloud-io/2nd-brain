// 좁은 폭(≤ 900px)의 서랍: 왼쪽 트리·오른쪽 패널을 가운데 위에 덮어 연다. 열림은 저장하지 않는다(새로 열면 닫힌 채).
// 넓은 폭의 열 펴기(leftOpen·rightOpen, localStorage)와는 따로 논다. 경계는 mobile.css 의 미디어 쿼리와 같다.
import { useCallback, useEffect, useReducer, useState } from 'react';

export type Drawer = 'left' | 'right' | null;
export type DrawerAction = { type: 'toggle'; side: 'left' | 'right' } | { type: 'close' };

/** 서랍은 한 번에 하나. 같은 쪽을 다시 누르면 닫고, 다른 쪽을 누르면 그쪽으로 바꾼다. 순수 함수. */
export function drawerReducer(state: Drawer, action: DrawerAction): Drawer {
  if (action.type === 'close') return null;
  return state === action.side ? null : action.side;
}

/** 서랍이 되는 폭. mobile.css 의 `@media (max-width: 900px)` 와 같다. */
export const NARROW_QUERY = '(max-width: 900px)';

/** 앱 루트 class. 넓은 폭의 접힘과 좁은 폭의 서랍 열림을 같이 싣는다 — CSS 가 폭에 맞는 쪽만 읽는다. 순수 함수. */
export function appClassName(s: { agent: boolean; leftOpen: boolean; rightOpen: boolean; drawer: Drawer }): string {
  return [
    'app',
    s.agent ? 'app-agent' : '',
    s.rightOpen ? '' : 'app-right-collapsed',
    s.leftOpen ? '' : 'app-left-collapsed',
    s.drawer === null ? '' : `app-drawer-${s.drawer}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return on;
}

/**
 * 서랍 상태와 좁은 폭 여부. 넓어지면 서랍을 닫고, 열려 있는 동안 Esc 로 닫는다.
 * Esc 는 window 버블 단계에서 듣는다 — 단축키 도움말은 캡처 단계에서 먼저 먹으므로 도움말이 열려 있으면 그것만 닫힌다.
 */
export function useDrawer(): { narrow: boolean; drawer: Drawer; toggle: (side: 'left' | 'right') => void; close: () => void } {
  const narrow = useMedia(NARROW_QUERY);
  const [drawer, dispatch] = useReducer(drawerReducer, null);
  const toggle = useCallback((side: 'left' | 'right') => dispatch({ type: 'toggle', side }), []);
  const close = useCallback(() => dispatch({ type: 'close' }), []);
  useEffect(() => {
    if (!narrow) close();
  }, [narrow, close]);
  useEffect(() => {
    if (drawer === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, close]);
  return { narrow, drawer: narrow ? drawer : null, toggle, close };
}
