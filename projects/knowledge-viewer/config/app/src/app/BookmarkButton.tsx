import { isBookmarked } from './bookmarks.ts';
import { IconStar } from './icons.tsx';
import { useBookmarks } from './useBookmarks.ts';

type Props = { path: string; title: string };

/** 현재 문서의 북마크 토글. 아이콘만 보이고, 마우스를 올리면 할 수 있는 일이 말풍선으로 뜬다. */
export function BookmarkButton({ path, title }: Props) {
  const { items, toggle } = useBookmarks();
  const on = isBookmarked(items, path);
  const hint = on ? '북마크 됨 — 누르면 해제' : '북마크에 추가 — 누르면 오른쪽 "북마크" 패널에 담긴다';
  return (
    <span className="bm-wrap">
      <button
        type="button"
        className={on ? 'bm-btn bm-on' : 'bm-btn'}
        aria-pressed={on}
        aria-label={on ? '북마크 해제' : '북마크 추가'}
        title={hint}
        onClick={() => toggle(path, title)}
      >
        <IconStar on={on} />
      </button>
      <span className="bm-tip" role="tooltip">
        {hint}
      </span>
    </span>
  );
}
