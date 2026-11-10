// 전역 단축키를 앱 동작에 잇고 도움말 오버레이를 띄운다. App 은 이 컴포넌트 하나만 그린다(공용 파일을 적게 건드리려고).
import { useCallback, useEffect, useMemo, useState } from 'react';

import { readShortcutPlatform, writeShortcutPlatform, type ShortcutPlatformChoice } from './prefs/shortcuts.ts';
import { isFolderPath } from './route.ts';
import { emitShortcutEvent, onShortcutEvent } from './shortcut-events.ts';
import { ShortcutHelp } from './ShortcutHelp.tsx';
import { detectPlatform, extViewShortcutId, isTypingTarget, shortcutTable } from './shortcuts.ts';
import type { CenterViewExtension } from '../ext/define.ts';
import { treeMove, treeSide } from './tree-nav.ts';
import { useBookmarks } from './useBookmarks.ts';
import { useGestureNav } from './useGestureNav.ts';
import { useShortcuts } from './useShortcuts.ts';

type Props = {
  path: string;
  docTitle?: string;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleView: () => void;
  onSearchAll: (on: boolean) => void;
  /** 확장 화면(단축키 행·열기 알림). 없으면 코어 표만. */
  views?: readonly CenterViewExtension[];
};

/** 확장 화면이 없을 때(기본값). */
const NO_VIEWS: readonly CenterViewExtension[] = [];

const searchInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('.topbar .search-input');

function focusSearch(): boolean {
  const el = searchInput();
  if (el === null) return false;
  emitShortcutEvent('search');
  return true;
}

export function GlobalShortcuts({ path, docTitle, onToggleLeft, onToggleRight, onToggleView, onSearchAll, views = NO_VIEWS }: Props) {
  // 마우스 옆 단추·가로 스와이프 → 뒤로·앞으로. 이 컴포넌트는 에이전트 모드에서 안 그려지니 거기엔 걸리지 않는다.
  useGestureNav(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [choice, setChoiceState] = useState<ShortcutPlatformChoice>(readShortcutPlatform);
  const [detected] = useState(() => detectPlatform());
  const { toggle: toggleBookmark } = useBookmarks();
  const setChoice = useCallback((c: ShortcutPlatformChoice) => {
    writeShortcutPlatform(c);
    setChoiceState(c);
  }, []);

  // 코어 표 + 확장 화면 행. 도움말도 같은 표를 그린다.
  const table = useMemo(() => shortcutTable(views), [views]);

  // ⚙ 메뉴의 "단축키 도움말" 도 같은 알림으로 연다.
  useEffect(() => onShortcutEvent('help', () => setHelpOpen(true)), []);

  useShortcuts(
    {
      help: () => emitShortcutEvent('help'),
      // 입력 상자에서 Esc: 검색 상자가 먼저 질의를 지우고(자체 처리), 여기서 포커스를 뺀다. 그 밖에는 각 팝오버가 스스로 닫힌다.
      escape: (e) => {
        const t = e.target as HTMLElement | null;
        if (!isTypingTarget(t)) return false;
        t?.blur();
      },
      'view.graph': () => (path.endsWith('.md') ? onToggleView() : false),
      // 확장 화면 열기: 상단바가 알림을 듣고 연다.
      ...Object.fromEntries(views.map((v) => [extViewShortcutId(v.id), () => emitShortcutEvent(`view:${v.id}`)])),
      'tree.next': (e) => treeMove(1, e.key === 'ArrowDown'),
      'tree.prev': (e) => treeMove(-1, e.key === 'ArrowUp'),
      'tree.expand': () => treeSide(1),
      'tree.collapse': () => treeSide(-1),
      'search.focus': () => focusSearch(),
      'search.all': () => {
        onSearchAll(true);
        return focusSearch();
      },
      // 질의를 `#` 으로 채우는 일은 검색 상자 자신이 한다(상태가 그 안에 있다).
      'search.pr': () => {
        if (searchInput() === null) return false;
        emitShortcutEvent('pr-search');
      },
      'panel.left': () => onToggleLeft(),
      'panel.right': () => onToggleRight(),
      settings: () => emitShortcutEvent('settings'),
      bookmark: () => {
        if (isFolderPath(path)) return false;
        toggleBookmark(path, docTitle ?? path.split('/').pop() ?? path);
      },
      'doc.top': () => {
        const el = document.querySelector<HTMLElement>('.col-center');
        if (el === null) return false;
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      },
    },
    { platform: detected, table },
  );

  if (!helpOpen) return null;
  return (
    <ShortcutHelp
      platform={choice === 'auto' ? detected : choice}
      choice={choice}
      detected={detected}
      onChoice={setChoice}
      onClose={() => setHelpOpen(false)}
      table={table}
    />
  );
}
