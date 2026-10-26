import { useState } from 'react';

import { bookmarkLabel, sortBookmarks, type Bookmark } from './bookmarks.ts';
import { isPlainClick } from './links.ts';
import { readBookmarksOpen, writeBookmarksOpen } from './prefs/layout.ts';
import { hrefFor } from './route.ts';
import { TreeStar } from './TreeStar.tsx';
import type { Source } from './types.ts';

type Props = {
  items: Bookmark[];
  current: string;
  agent: boolean;
  src: Source;
  onOpen: (path: string) => void;
};

/**
 * 왼쪽 열 맨 위의 ★ 북마크 섹션. 북마크가 없으면 아무것도 그리지 않는다.
 * 접힘은 브라우저(localStorage)에 남고, 행은 트리의 파일 행과 같은 핸들러·같은 소스로 연다.
 */
export function BookmarkSection({ items, current, agent, src, onOpen }: Props) {
  const [open, setOpen] = useState<boolean>(() => readBookmarksOpen());
  if (items.length === 0) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeBookmarksOpen(next);
  };
  const sorted = sortBookmarks(items);
  return (
    <section className="tree-bms" aria-label="북마크">
      <button type="button" className="tree-row tree-dir tree-bms-head" aria-expanded={open} onClick={toggle}>
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-bms-star">★</span>
        <span className="tree-name">북마크</span>
        <span className="tree-bms-count">{sorted.length}</span>
      </button>
      {open ? (
        <ul className="tree-list tree-bms-list" role="list">
          {sorted.map((b) => (
            <li key={b.path} className="tree-item-file">
              <a
                href={hrefFor(b.path, undefined, agent, src)}
                className={b.path === current ? 'tree-row tree-file tree-bms-row tree-current' : 'tree-row tree-file tree-bms-row'}
                title={b.path}
                onClick={(ev) => {
                  if (!isPlainClick(ev)) return;
                  ev.preventDefault();
                  onOpen(b.path);
                }}
              >
                <span className="tree-caret" />
                <span className="tree-bms-text">
                  <span className="tree-name">{bookmarkLabel(b)}</span>
                  <span className="tree-bms-path">{b.path}</span>
                </span>
              </a>
              <TreeStar path={b.path} title={b.title} />
            </li>
          ))}
        </ul>
      ) : null}
      <hr className="tree-sep" />
    </section>
  );
}
