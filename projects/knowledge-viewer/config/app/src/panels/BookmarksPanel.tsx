import { isPlainClick } from '../app/links.ts';
import { hrefFor } from '../app/route.ts';
import type { Source } from '../app/types.ts';
import { useBookmarks } from '../app/useBookmarks.ts';

// 북마크는 경로만 담는다. 열면 지금 소스를 유지한다.
type Props = { current: string; agent: boolean; src: Source; onNavigate: (path: string) => void };

/** 북마크 목록 패널. 최근 것이 위. 행에 마우스를 올리면 해제 단추가 보인다. */
export function BookmarksPanel({ current, agent, src, onNavigate }: Props) {
  const { items, remove } = useBookmarks();
  if (items.length === 0) return <p className="notice">북마크 없음 — 경로 표시줄 옆 ☆ 를 누르면 여기 담긴다.</p>;
  return (
    <ul className="bm-list">
      {items.map((b) => (
        <li key={b.path} className={b.path === current ? 'bm-row bm-current' : 'bm-row'}>
          <a
            className="bm-link"
            href={hrefFor(b.path, undefined, agent, src)}
            title={b.path}
            onClick={(e) => {
              if (!isPlainClick(e)) return;
              e.preventDefault();
              onNavigate(b.path);
            }}
          >
            <span className="bm-star">★</span>
            <span className="bm-title">{b.title}</span>
            <span className="bm-path">{b.path}</span>
          </a>
          {agent ? null : (
            <button type="button" className="bm-remove" title="북마크 해제" aria-label={`${b.title} 북마크 해제`} onClick={() => remove(b.path)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
