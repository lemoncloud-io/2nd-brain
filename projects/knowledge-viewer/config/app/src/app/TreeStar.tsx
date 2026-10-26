import type { MouseEvent } from 'react';

import { isBookmarked } from './bookmarks.ts';
import { IconStar } from './icons.tsx';
import { useBookmarks } from './useBookmarks.ts';

type Props = { path: string; title: string };

/**
 * 트리 행 오른쪽 끝의 ★ 북마크 토글. 행(링크) 옆에 따로 서는 단추라 누르면 문서를 열지 않고 북마크만 바꾼다.
 * 북마크된 행은 늘 보이고, 아닌 행은 마우스를 올리거나 포커스가 올 때만 빈 별이 보인다(CSS).
 */
export function TreeStar({ path, title }: Props) {
  const { items, toggle } = useBookmarks();
  const on = isBookmarked(items, path);
  const onClick = (ev: MouseEvent<HTMLButtonElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggle(path, title);
  };
  return (
    <button
      type="button"
      className={on ? 'tree-star tree-star-on' : 'tree-star'}
      aria-pressed={on}
      aria-label={on ? '북마크 해제' : '북마크 추가'}
      title={on ? '북마크 됨 — 누르면 해제' : '북마크에 추가'}
      onClick={onClick}
    >
      <IconStar on={on} size={14} />
    </button>
  );
}
