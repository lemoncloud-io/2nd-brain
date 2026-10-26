// 전역 단축키 훅. 단축키 표(shortcuts.ts)의 scope 'app' 항목을 window keydown 하나로 묶는다.
import { useEffect, useRef } from 'react';

import { SHORTCUTS, detectPlatform, findShortcut, isTypingTarget, type Platform } from './shortcuts.ts';

/** 처리했으면 아무것도 돌려주지 않거나 true, 이번엔 처리하지 않을 거면 false(기본 동작을 막지 않는다). */
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;
export type ShortcutBindings = Partial<Record<string, ShortcutHandler>>;

/**
 * bindings 의 id 로 단축키를 건다. 매번 새 객체를 줘도 리스너는 한 번만 붙는다(최신 bindings 를 ref 로 읽는다).
 * 건너뛰는 경우: 한글 조합 중(isComposing), 이미 누가 막은 이벤트(defaultPrevented), 반복 입력(repeat 를 허락한 항목만 받는다),
 * 입력 상자 안의 글자 조합(Esc·수식어 조합만 받는다). 처리하면 preventDefault 한다 — 표에 브라우저 예약 조합은 없다(시험이 지킨다).
 */
export function useShortcuts(bindings: ShortcutBindings, opts: { enabled?: boolean; platform?: Platform } = {}): void {
  const ref = useRef(bindings);
  ref.current = bindings;
  const enabled = opts.enabled ?? true;
  const platform = opts.platform;
  useEffect(() => {
    if (!enabled) return;
    const plat = platform ?? detectPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      const typing = isTypingTarget(e.target as HTMLElement | null);
      const hit = findShortcut(e, plat, typing);
      if (hit === null) return;
      const def = SHORTCUTS.find((s) => s.id === hit.id);
      if (e.repeat && def?.repeat !== true) return;
      const run = ref.current[hit.id];
      if (run === undefined) return;
      if (run(e) === false) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, platform]);
}
